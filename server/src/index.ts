import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { ActivityStore, type ActivityCategory, type ActivitySeverity } from './activity-store.js'
import { DashboardAuth } from './auth.js'
import { terminalCapabilityStatus, workersCapabilityStatus } from './capability-status.js'
import { BOARD_RUN_MODES, MANUAL_CARD_ACTIONS, BoardError, BoardService, type BoardRunMode, type ManualCardAction } from './board-service.js'
import { CronError, CronService, type CronJob, type CronRun } from './cron-service.js'
import { FileAccessError, FileService } from './file-service.js'
import { GitService } from './git-service.js'
import { OnboardingError, OnboardingService } from './onboarding-service.js'
import { PiRpcProcess } from './pi-rpc.js'
import { pluginAssetContentSecurityPolicy } from './plugin-asset-policy.js'
import { PluginRuntimeError, proxyPluginRuntime } from './plugin-runtime-proxy.js'
import { PluginError, PluginService } from './plugin-service.js'
import { NativeTerminalSession } from './terminal-session.js'
import { ProviderLoginSession } from './provider-login-session.js'
import { safePreviewHeaders } from './preview-policy.js'
import { dashboardProfile, type DashboardFeature } from './profile.js'
import { SessionArchiveService } from './session-archive.js'
import { SessionCatalog } from './session-catalog.js'
import { SkillError, SkillService } from './skill-service.js'
import { SystemError, SystemService, THINKING_LEVELS } from './system-service.js'
import { ToolService } from './tool-service.js'
import { SubPiWorkerAdapter } from './sub-pi-worker.js'
import { WorkerCoordinator, WorkerError } from './worker-coordinator.js'
import type { BrowserCommand, RpcEvent, ServerMessage } from './types.js'

const port = Number(process.env.PORT ?? 4317)
const host = process.env.HOST ?? '0.0.0.0'
const defaultHomeAgentDir = resolve(homedir(), '.pi/agent')
const defaultWorkspace = resolve(homedir(), 'Documents/PiWorkspace')
const workspace = process.env.PI_DASHBOARD_WORKSPACE ?? defaultWorkspace

// Auto-initialize clean workspace folder with starter MEMORY.md
try {
  mkdirSync(workspace, { recursive: true })
  const memoryFile = resolve(workspace, 'MEMORY.md')
  if (!existsSync(memoryFile)) {
    const templatePath = resolve(import.meta.dirname ?? process.cwd(), '../templates/MEMORY.md')
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf8')
      : '# Project Memory\n\nThis file is the local memory bank for this project workspace.\n'
    writeFileSync(memoryFile, template, 'utf8')
  }
} catch {}
const sessionRoot = process.env.PI_SESSION_ROOT ?? resolve(defaultHomeAgentDir, 'sessions')
const agentDir = process.env.PI_AGENT_DIR ?? defaultHomeAgentDir
const rpcSessionDir = process.env.PI_RPC_SESSION_DIR
const activityPath = process.env.PI_DASHBOARD_ACTIVITY_PATH ?? resolve(defaultHomeAgentDir, 'dashboard/activity.jsonl')
const workspaceKey = createHash('sha256').update(workspace).digest('hex').slice(0, 16)
const boardPath = process.env.PI_DASHBOARD_BOARD_PATH ?? resolve(defaultHomeAgentDir, `dashboard/boards/${workspaceKey}.json`)
const cronPath = process.env.PI_DASHBOARD_CRON_PATH ?? resolve(defaultHomeAgentDir, `dashboard/cron/${workspaceKey}.json`)
const sessionArchivePath = process.env.PI_DASHBOARD_SESSION_ARCHIVE_PATH ?? resolve(defaultHomeAgentDir, `dashboard/sessions/${workspaceKey}.json`)
const runtimeInfoPath = process.env.PI_DASHBOARD_RUNTIME_INFO_PATH ?? resolve(defaultHomeAgentDir, 'dashboard/runtime-tools.json')
const runtimeInfoExtension = process.env.PI_DASHBOARD_RUNTIME_INFO_EXTENSION ?? resolve(process.cwd(), 'extensions/dashboard-runtime-info.ts')
const curatedMemoryExtension = process.env.PI_DASHBOARD_CURATED_MEMORY_EXTENSION ?? resolve(process.cwd(), 'extensions/curated-memory.ts')
const memoryCheckpointExtension = process.env.PI_DASHBOARD_MEMORY_CHECKPOINT_EXTENSION ?? resolve(process.cwd(), 'extensions/memory-checkpoint.ts')
const pluginToolsExtension = process.env.PI_DASHBOARD_PLUGIN_TOOLS_EXTENSION ?? resolve(process.cwd(), 'extensions/dashboard-plugin-tools.ts')
const workersExtension = process.env.PI_DASHBOARD_WORKERS_EXTENSION ?? resolve(process.cwd(), 'extensions/dashboard-workers.ts')
const dashboardPluginAuthoringSkill = process.env.PI_DASHBOARD_PLUGIN_AUTHORING_SKILL_PATH ?? resolve(process.cwd(), 'skills/dashboard-plugin-authoring')
const dashboardReferenceSkill = process.env.PI_DASHBOARD_REFERENCE_SKILL_PATH ?? resolve(process.cwd(), 'skills/dashboard-reference')
const pluginCodeRoot = process.env.PI_DASHBOARD_PLUGIN_CODE_ROOT ?? resolve(process.cwd(), '../plugins')
const pluginStateRoot = process.env.PI_DASHBOARD_PLUGIN_STATE_ROOT ?? resolve(defaultHomeAgentDir, 'dashboard/plugins')
const pluginRuntimeSocketRoot = process.env.PI_DASHBOARD_PLUGIN_RUNTIME_SOCKET_ROOT ?? resolve(tmpdir(), 'pi-dashboard-plugins')
const pluginLocalRepositoryRoot = process.env.PI_DASHBOARD_PLUGIN_LOCAL_REPOSITORY_ROOT
const terminalSocketPath = process.env.PI_DASHBOARD_TERMINAL_SOCKET ?? resolve(tmpdir(), 'pi-dashboard-terminal/terminal.sock')
const workerStorePath = process.env.PI_DASHBOARD_WORKER_STORE_PATH ?? resolve(defaultHomeAgentDir, `dashboard/workers/${workspaceKey}.json`)
const previewPort = Number(process.env.PI_DASHBOARD_PREVIEW_PORT ?? 4318)
const previewPublicPort = Number(process.env.PI_DASHBOARD_PREVIEW_PUBLIC_PORT ?? 4174)
const previewAllowedOrigins = new Set(
  (process.env.PI_DASHBOARD_PREVIEW_ALLOWED_ORIGINS ?? `http://localhost:${previewPublicPort},http://127.0.0.1:${previewPublicPort}`)
    .split(',').map((origin) => origin.trim()).filter(Boolean),
)
const allowedOrigins = new Set(
  (process.env.PI_DASHBOARD_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5190,http://127.0.0.1:5190,http://localhost:5184,http://127.0.0.1:5184')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const originsLimitedToLocalhost = [...allowedOrigins].every((origin) => {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(origin).hostname) } catch { return false }
})

const auth = new DashboardAuth()
const pluginAssetCapability = randomBytes(32).toString('base64url')
const workerInternalToken = randomBytes(32).toString('base64url')
const profile = dashboardProfile()
const enabledFeatures = new Set<DashboardFeature>(profile.features)
const rpcArgs = ['--mode', 'rpc', '--continue', '--name', 'Pi Dashboard', '--extension', runtimeInfoExtension, '--extension', curatedMemoryExtension, '--extension', memoryCheckpointExtension, '--extension', pluginToolsExtension, ...(enabledFeatures.has('workers') ? ['--extension', workersExtension] : []), ...(rpcSessionDir ? ['--session-dir', rpcSessionDir] : [])]
const rpc = new PiRpcProcess({ cwd: workspace, args: rpcArgs, env: { PI_DASHBOARD_WORKER_INTERNAL_TOKEN: workerInternalToken } })
const sessions = new SessionCatalog(sessionRoot, workspace)
const sessionArchive = new SessionArchiveService(sessionArchivePath)
const board = new BoardService(boardPath, workspace)
const cron = new CronService(cronPath, workspace)
const files = new FileService(workspace)
const git = new GitService(workspace)
const skills = new SkillService(workspace, agentDir)
const system = new SystemService(workspace, agentDir)
const onboarding = new OnboardingService(workspace, agentDir)
const tools = new ToolService(runtimeInfoPath)
const plugins = new PluginService({ bundledRoot: pluginCodeRoot, stateRoot: pluginStateRoot, workspaceRoot: workspace, runtimeSocketRoot: pluginRuntimeSocketRoot, assetCapability: pluginAssetCapability, ...(pluginLocalRepositoryRoot ? { localRepositoryRoot: pluginLocalRepositoryRoot } : {}) })
const activity = new ActivityStore(activityPath)
const providerLogin = new ProviderLoginSession()
const workerBounds = {
  turnLimit: positiveLimit(process.env.PI_DASHBOARD_WORKER_TURN_LIMIT, 8, 1),
  timeoutMs: positiveLimit(process.env.PI_DASHBOARD_WORKER_TIMEOUT_MS, 10 * 60_000, 60_000),
  resultLimitBytes: positiveLimit(process.env.PI_DASHBOARD_WORKER_RESULT_LIMIT_BYTES, 12 * 1024, 1024),
}
const subPi = new SubPiWorkerAdapter({ workspace, sessionDir: rpcSessionDir, pluginToolsExtension, git, enabled: enabledFeatures.has('workers') })
const workers = new WorkerCoordinator({
  storePath: workerStorePath,
  adapter: subPi,
  bounds: workerBounds,
  primaryDefaults: async () => {
    const snapshot = await state()
    const model = snapshot.model && typeof snapshot.model === 'object' ? snapshot.model as Record<string, unknown> : undefined
    return {
      ...(model && typeof model.provider === 'string' && typeof model.id === 'string' ? { model: { provider: model.provider, id: model.id } } : {}),
      ...(typeof snapshot.thinkingLevel === 'string' ? { thinkingLevel: snapshot.thinkingLevel } : {}),
    }
  },
})
await Promise.all([
  activity.initialize(),
  sessionArchive.initialize(),
  system.initialize(),
  ...(enabledFeatures.has('plugins') ? [plugins.initialize()] : []),
  ...(enabledFeatures.has('board') ? [board.initialize()] : []),
  ...(enabledFeatures.has('cron') ? [cron.initialize()] : []),
  ...(enabledFeatures.has('workers') ? [workers.initialize()] : []),
])

const clients = new Set<WebSocket>()
const toolStartTimes = new Map<string, number>()
const boardToolInputs = new Map<string, Record<string, unknown>>()
let currentSessionId: string | undefined
let currentSessionFile: string | undefined
let currentRunId: string | undefined
let managementChain = Promise.resolve()
let boardEventChain = Promise.resolve()
function positiveLimit(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}
const boardTurnLimit = positiveLimit(process.env.PI_DASHBOARD_BOARD_TURN_LIMIT, 12, 1)
const boardRunTimeoutMs = positiveLimit(process.env.PI_DASHBOARD_BOARD_RUN_TIMEOUT_MS, 30 * 60_000, 60_000)
interface ActiveBoardRun { cardId: string; sessionId: string; turns: number; timer: NodeJS.Timeout; rpc: PiRpcProcess }
let activeBoardRun: ActiveBoardRun | undefined

function encode(message: ServerMessage): string {
  return JSON.stringify(message)
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(encode(message))
}

function broadcast(message: ServerMessage): void {
  const payload = encode(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload)
  }
}

if (enabledFeatures.has('cron')) cron.on('changed', () => broadcast({ type: 'cron_changed' }))
if (enabledFeatures.has('cron')) cron.on('schedulerError', (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  record({ category: 'error', type: 'cron_scheduler_error', severity: 'error', summary: message, sessionId: currentSessionId })
  broadcast({ type: 'error', message: `Scheduled job failed: ${message}` })
})
if (enabledFeatures.has('cron')) cron.on('runFinished', ({ job, run }: { job: CronJob; run: CronRun }) => {
  const failed = run.status === 'error' || run.status === 'timed-out'
  record({
    category: failed ? 'error' : 'cron', type: 'cron_run_finished', severity: failed ? 'error' : 'info',
    summary: `${run.status === 'success' ? 'Completed' : 'Finished'} scheduled job ${job.name}: ${run.status}`,
    sessionId: run.sessionId, data: { jobId: job.id, runId: run.id, status: run.status },
  })
  broadcast({ type: 'sessions_changed' })
  if (job.access === 'workspace-write') broadcast({ type: 'workspace_changed' })
})

function record(input: Parameters<ActivityStore['record']>[0]): void {
  activity.record(input)
}

function rememberState(data: unknown): void {
  if (!data || typeof data !== 'object') return
  const state = data as Record<string, unknown>
  currentSessionId = typeof state.sessionId === 'string' ? state.sessionId : undefined
  currentSessionFile = typeof state.sessionFile === 'string' ? state.sessionFile : undefined
}

async function state(): Promise<Record<string, unknown>> {
  const response = await rpc.request({ type: 'get_state' })
  rememberState(response.data)
  return (response.data ?? {}) as Record<string, unknown>
}

async function ensureIdle(): Promise<Record<string, unknown>> {
  const current = await state()
  if (current.isStreaming) throw new Error('Wait for Pi to finish or stop the active response before changing sessions')
  return current
}

async function chatStateSnapshot(): Promise<Record<string, unknown>> {
  const [stateResponse, statsResponse] = await Promise.all([
    rpc.request({ type: 'get_state' }),
    rpc.request({ type: 'get_session_stats' }),
  ])
  const rawState = (stateResponse.data ?? {}) as Record<string, unknown>
  const rawStats = statsResponse.data && typeof statsResponse.data === 'object' ? statsResponse.data as Record<string, unknown> : {}
  const rawContext = rawStats.contextUsage && typeof rawStats.contextUsage === 'object' ? rawStats.contextUsage as Record<string, unknown> : undefined
  const contextUsage = rawContext ? {
    ...(typeof rawContext.tokens === 'number' || rawContext.tokens === null ? { tokens: rawContext.tokens } : {}),
    ...(typeof rawContext.contextWindow === 'number' ? { contextWindow: rawContext.contextWindow } : {}),
    ...(typeof rawContext.percent === 'number' || rawContext.percent === null ? { percent: rawContext.percent } : {}),
  } : undefined
  return { ...rawState, ...(contextUsage ? { contextUsage } : {}) }
}

async function runtimeSkillPaths(): Promise<string[]> {
  const paths = [dashboardPluginAuthoringSkill, dashboardReferenceSkill]
  try {
    const response = await rpc.request({ type: 'get_commands' })
    const data = response.data as { commands?: Array<{ source?: string; path?: string }> } | undefined
    paths.push(...(data?.commands ?? []).filter((command) => command.source === 'skill' && typeof command.path === 'string').map((command) => command.path as string))
  } catch {
    // Keep bundled Dashboard reference skills visible even if Pi is restarting.
  }
  return [...new Set(paths)]
}

async function reloadRpcResources(): Promise<void> {
  await ensureIdle()
  await rpc.stop()
  await rpc.start()
  await sendSnapshot()
  broadcast({ type: 'skills_changed' })
}

function requireFeature(feature: DashboardFeature): void {
  if (!enabledFeatures.has(feature)) throw new SystemError('This capability is not enabled in the current dashboard profile', 404)
}

function expectedUpdatedAt(request: IncomingMessage, error: (message: string, status: number) => Error): string {
  const header = request.headers['if-match']
  if (typeof header !== 'string') throw error('This operation requires the item version. Refresh and try again.', 428)
  const match = header.match(/^(?:W\/)?"([^"]+)"$/)
  if (!match) throw error('The item version is invalid. Refresh and try again.', 400)
  return match[1]
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes = 64 * 1024,
  error: (message: string, status?: number) => Error = (message, status) => new SkillError(message, status),
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw error('Request body is too large', 413)
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
    return parsed as Record<string, unknown>
  } catch {
    throw error('Invalid JSON request body')
  }
}

interface AvailableModel {
  id: string
  provider: string
  name: string
  reasoning: boolean
  contextWindow?: number
}

async function availableModels(): Promise<AvailableModel[]> {
  const response = await rpc.request({ type: 'get_available_models' })
  const data = response.data as { models?: unknown[] } | undefined
  return (data?.models ?? []).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const model = value as Record<string, unknown>
    if (typeof model.id !== 'string' || typeof model.provider !== 'string') return []
    return [{
      id: model.id,
      provider: model.provider,
      name: typeof model.name === 'string' ? model.name : model.id,
      reasoning: model.reasoning === true,
      ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
    }]
  }).sort((left, right) => `${left.provider}/${left.name}`.localeCompare(`${right.provider}/${right.name}`))
}

async function systemSnapshot(): Promise<Record<string, unknown>> {
  const [systemInfo, rpcState, modelResult, statsResult, gitStatus, sessionList, terminalSocketReady] = await Promise.all([
    system.get(),
    rpc.request({ type: 'get_state' }).then((response) => response.data as Record<string, unknown>).catch((error: Error) => ({ error: error.message })),
    availableModels().then((models) => ({ models })).catch((error: Error) => ({ models: [] as AvailableModel[], error: error.message })),
    rpc.request({ type: 'get_session_stats' }).then((response) => response.data).catch((error: Error) => ({ error: error.message })),
    git.status(),
    sessions.list(),
    stat(terminalSocketPath).then((info) => info.isSocket()).catch(() => false),
  ])
  const boardSnapshot = board.get()
  const cronSnapshot = cron.get()
  const rawState = rpcState as Record<string, unknown>
  const rpcError = typeof rawState.error === 'string' ? rawState.error : ('error' in modelResult ? modelResult.error : undefined)
  const rawModel = rawState.model && typeof rawState.model === 'object' ? rawState.model as Record<string, unknown> : undefined
  const rawStats = statsResult && typeof statsResult === 'object' ? statsResult as Record<string, unknown> : {}
  const rawContext = rawStats.contextUsage && typeof rawStats.contextUsage === 'object' ? rawStats.contextUsage as Record<string, unknown> : undefined
  const safeState = rpcError ? { error: rpcError } : {
    model: rawModel ? {
      ...(typeof rawModel.id === 'string' ? { id: rawModel.id } : {}),
      ...(typeof rawModel.provider === 'string' ? { provider: rawModel.provider } : {}),
      ...(typeof rawModel.name === 'string' ? { name: rawModel.name } : {}),
    } : null,
    ...(typeof rawState.thinkingLevel === 'string' ? { thinkingLevel: rawState.thinkingLevel } : {}),
    ...(typeof rawState.isStreaming === 'boolean' ? { isStreaming: rawState.isStreaming } : {}),
    ...(typeof rawState.sessionId === 'string' ? { sessionId: rawState.sessionId } : {}),
    ...(typeof rawState.sessionName === 'string' ? { sessionName: rawState.sessionName } : {}),
    ...(typeof rawState.messageCount === 'number' ? { messageCount: rawState.messageCount } : {}),
  }
  const safeStats = typeof rawStats.error === 'string' ? { error: rawStats.error } : {
    ...(typeof rawStats.cost === 'number' ? { cost: rawStats.cost } : {}),
    ...(typeof rawStats.totalMessages === 'number' ? { totalMessages: rawStats.totalMessages } : {}),
    ...(typeof rawStats.toolCalls === 'number' ? { toolCalls: rawStats.toolCalls } : {}),
    ...(rawContext ? { contextUsage: {
      ...(typeof rawContext.tokens === 'number' || rawContext.tokens === null ? { tokens: rawContext.tokens } : {}),
      ...(typeof rawContext.contextWindow === 'number' ? { contextWindow: rawContext.contextWindow } : {}),
      ...(typeof rawContext.percent === 'number' || rawContext.percent === null ? { percent: rawContext.percent } : {}),
    } } : {}),
  }
  return {
    generatedAt: new Date().toISOString(),
    backend: {
      status: rpc.running && !rpcError ? 'online' : 'degraded',
      profile: profile.name,
      enabledFeatures: profile.features,
      optionalCapabilities: [
        terminalCapabilityStatus(profile.name, enabledFeatures.has('terminal'), terminalSocketReady),
        workersCapabilityStatus(profile.name, enabledFeatures.has('workers'), rpc.running && !rpcError),
      ],
      connectedClients: clients.size,
      ...systemInfo,
    },
    pi: {
      rpcConnected: rpc.running && !rpcError,
      ...(rpcError ? { error: rpcError } : {}),
      state: safeState,
      sessionStats: safeStats,
      availableModels: modelResult.models,
      thinkingLevels: THINKING_LEVELS,
    },
    workspace: {
      path: workspace,
      git: { available: gitStatus.available, clean: gitStatus.clean, branch: gitStatus.branch, commit: gitStatus.commit },
    },
    persistence: {
      sessionRoot, activityPath, boardPath, cronPath,
      sessions: sessionList.length,
      boardCards: boardSnapshot.cards.length,
      cronJobs: cronSnapshot.jobs.length,
      cronRuns: cronSnapshot.runs.length,
    },
    recentErrors: activity.query({ category: 'error', limit: 5 }),
    security: {
      authenticationEnabled: auth.enabled,
      frontendExpectedOnLocalhost: originsLimitedToLocalhost,
      backendNetworkScope: 'Compose internal network',
      processIsolation: 'Shared dashboard container',
      workspaceIsolationEnforced: false,
      allowedOrigins: [...allowedOrigins],
    },
  }
}

async function sendSnapshot(socket?: WebSocket): Promise<void> {
  const target = socket ? (message: ServerMessage) => send(socket, message) : broadcast
  const [stateResponse, messagesResponse] = await Promise.all([
    chatStateSnapshot(),
    rpc.request({ type: 'get_messages' }),
  ])
  rememberState(stateResponse)
  target({ type: 'state', state: stateResponse })
  const data = messagesResponse.data as { messages?: unknown[] } | undefined
  target({ type: 'history', messages: data?.messages ?? [] })
}

function queueManagement(task: () => Promise<void>): Promise<void> {
  const result = managementChain.then(task, task)
  managementChain = result.catch(() => undefined)
  return result
}

async function finishBoardRun(run = activeBoardRun): Promise<void> {
  if (!run) return
  clearTimeout(run.timer)
  if (activeBoardRun === run) activeBoardRun = undefined
  boardToolInputs.clear()
  await run.rpc.stop()
}

async function updateBoardRun(cardId: string, status: Parameters<BoardService['setPiState']>[1]['status'], message: string, sessionId: string, turns?: number): Promise<void> {
  await board.setPiState(cardId, { status, message, sessionId, ...(turns === undefined ? {} : { turnCount: turns }) }, sessionId)
  broadcast({ type: 'board_changed' })
  record({
    category: status === 'failed' || status === 'blocked' ? 'error' : 'board',
    type: `board_project_${status.replaceAll('-', '_')}`,
    severity: status === 'failed' || status === 'blocked' ? 'warning' : 'info',
    summary: message, sessionId, data: { cardId, status },
  })
}

function beginBoardRun(runner: PiRpcProcess, cardId: string, sessionId: string): void {
  if (activeBoardRun) throw new BoardError('Pi is already working on another Project Board card', 409)
  const timer = setTimeout(() => {
    const run = activeBoardRun
    if (!run || run.cardId !== cardId || run.sessionId !== sessionId) return
    void run.rpc.request({ type: 'abort' }).catch(() => undefined)
    boardEventChain = boardEventChain.then(async () => {
      await updateBoardRun(cardId, 'paused', 'Pi reached the project runtime limit. Review its progress and resume when ready.', sessionId, run.turns)
      await finishBoardRun(run)
    }).catch((error: Error) => broadcast({ type: 'error', message: error.message }))
  }, boardRunTimeoutMs)
  activeBoardRun = { cardId, sessionId, turns: 0, timer, rpc: runner }
}

function projectPrompt(card: NonNullable<ReturnType<BoardService['getCard']>>, mode: BoardRunMode): string {
  const details = card.description || '(No additional description was provided.)'
  const tags = card.tags.length ? card.tags.join(', ') : '(none)'
  const instruction = mode === 'user-plan'
    ? `THE USER OWNS IMPLEMENTATION. Inspect the project and write a detailed, practical step-by-step plan the user can follow. Do not modify files. When ready, call dashboard_project_status with status "plan-ready" and put the complete plan in its message. Then stop.`
    : mode === 'plan-approval'
      ? `PLAN APPROVAL IS REQUIRED. Inspect the project and develop a concrete implementation plan, but do not modify files. When ready, call dashboard_project_status with status "awaiting-approval" and put the complete plan in its message. Then stop.`
      : `Implement this card autonomously. Work carefully and run appropriate checks. If you need a decision or permission, call dashboard_project_status with status "awaiting-approval" and a specific question, then stop. If blocked, report "blocked". Only report "completed" after checks pass; include the result and changed-file summary.`
  return `Project Board card ${card.id}.\n\nTitle: ${card.title}\nDescription:\n${details}\nTags: ${tags}\n\n${instruction}\n\nUse dashboard_project_status for structured project state. This run is bounded to ${boardTurnLimit} model turns.`
}

function createBoardRunner(): PiRpcProcess {
  const args = ['--mode', 'rpc', '--extension', runtimeInfoExtension, ...(rpcSessionDir ? ['--session-dir', rpcSessionDir] : [])]
  const runner = new PiRpcProcess({ cwd: workspace, args })
  runner.on('event', (event: RpcEvent) => {
    if (activeBoardRun && event.type === 'tool_execution_start' && event.toolName === 'dashboard_project_status' && typeof event.toolCallId === 'string' && event.args && typeof event.args === 'object') {
      boardToolInputs.set(event.toolCallId, event.args as Record<string, unknown>)
    }
    boardEventChain = boardEventChain.then(async () => {
      await handleBoardEvent(event)
      if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string') boardToolInputs.delete(event.toolCallId)
    }).catch((error: Error) => {
      record({ category: 'error', type: 'board_project_event_error', severity: 'error', summary: error.message, sessionId: activeBoardRun?.sessionId })
      broadcast({ type: 'error', message: `Project Board automation failed: ${error.message}` })
    })
  })
  runner.on('exit', (error: Error) => {
    const run = activeBoardRun
    if (!run || run.rpc !== runner) return
    boardEventChain = boardEventChain.then(async () => {
      await updateBoardRun(run.cardId, 'failed', error.message, run.sessionId, run.turns)
      await finishBoardRun(run)
    }).catch(() => undefined)
  })
  runner.on('protocolError', (error: Error) => broadcast({ type: 'error', message: `Project Board Pi protocol error: ${error.message}` }))
  return runner
}

async function startBoardProject(cardId: string, expectedVersion: string, mode: BoardRunMode): Promise<void> {
  if (activeBoardRun) throw new BoardError('Pi is already working on another Project Board card', 409)
  await board.prepareRun(cardId, expectedVersion, mode)
  const card = board.getCard(cardId)
  if (!card) throw new BoardError('Card not found', 404)
  const runner = createBoardRunner()
  try {
    await runner.start()
    await runner.request({ type: 'set_session_name', name: card.title.slice(0, 100) })
    const response = await runner.request({ type: 'get_state' })
    const current = (response.data ?? {}) as Record<string, unknown>
    const sessionId = typeof current.sessionId === 'string' ? current.sessionId : undefined
    if (!sessionId) throw new Error('Pi did not provide a session ID')
    const message = mode === 'execute' ? 'Pi is working on this card.' : mode === 'user-plan' ? 'Pi is drafting step-by-step instructions for the user.' : 'Pi is preparing a plan for approval.'
    await updateBoardRun(cardId, mode === 'execute' ? 'working' : 'planning', message, sessionId, 0)
    beginBoardRun(runner, cardId, sessionId)
    broadcast({ type: 'sessions_changed' })
    await runner.request({ type: 'prompt', message: projectPrompt(board.getCard(cardId)!, mode) })
  } catch (error) {
    await runner.stop().catch(() => undefined)
    const failedRun = activeBoardRun as ActiveBoardRun | undefined
    if (failedRun?.rpc === runner) await finishBoardRun(failedRun)
    const message = error instanceof Error ? error.message : 'Unable to start Pi'
    const linked = board.getCard(cardId)?.piSessionId
    if (linked) await updateBoardRun(cardId, 'failed', message, linked).catch(() => undefined)
    else { await board.setPiState(cardId, { status: 'failed', message }).catch(() => undefined); broadcast({ type: 'board_changed' }) }
    throw error
  }
}

async function resumeBoardProject(cardId: string, expectedVersion: string, approval: boolean): Promise<void> {
  if (activeBoardRun) throw new BoardError('Pi is already working on another Project Board card', 409)
  const card = board.getCard(cardId)
  if (!card) throw new BoardError('Card not found', 404)
  if (card.updatedAt !== expectedVersion) throw new BoardError('This card changed in another browser. Refresh and try again.', 409)
  if (!card.piSessionId) throw new BoardError('This card does not have a linked Pi session', 409)
  if (approval && card.piStatus !== 'awaiting-approval') throw new BoardError('This card is not awaiting approval', 409)
  if (!approval && !['paused', 'blocked', 'failed'].includes(card.piStatus)) throw new BoardError('This card is not ready to resume', 409)
  const path = await sessions.pathFor(card.piSessionId)
  if (!path) throw new BoardError('The linked Pi session could not be found', 404)
  const runner = createBoardRunner()
  try {
    await runner.start()
    const switched = await runner.request({ type: 'switch_session', sessionPath: path })
    if (switched.data && typeof switched.data === 'object' && (switched.data as Record<string, unknown>).cancelled) throw new BoardError('A Pi extension cancelled opening the linked session', 409)
    const response = await runner.request({ type: 'get_state' })
    const current = (response.data ?? {}) as Record<string, unknown>
    if (current.sessionId !== card.piSessionId) throw new BoardError('Pi did not open the linked session', 409)
    const message = approval
      ? 'The user approved your latest plan or request. Continue the task accordingly. Use dashboard_project_status for further approval requests, blockers, or verified completion.'
      : 'Resume this Project Board task. Review prior progress and use dashboard_project_status for approval requests, blockers, or verified completion.'
    await updateBoardRun(cardId, 'working', approval ? 'Approved. Pi resumed work on this card.' : 'Pi resumed work on this card.', card.piSessionId, 0)
    beginBoardRun(runner, cardId, card.piSessionId)
    await runner.request({ type: 'prompt', message })
  } catch (error) {
    await runner.stop().catch(() => undefined)
    const failedRun = activeBoardRun as ActiveBoardRun | undefined
    if (failedRun?.rpc === runner) await finishBoardRun(failedRun)
    throw error
  }
}

async function takeoverBoardProject(cardId: string, expectedVersion: string): Promise<void> {
  if (activeBoardRun) throw new BoardError('Pi is already working on another Project Board card', 409)
  const before = board.getCard(cardId)
  if (!before) throw new BoardError('Card not found', 404)
  if (!before.piSessionId) throw new BoardError('This card does not have a linked Pi session', 409)
  const path = await sessions.pathFor(before.piSessionId)
  if (!path) throw new BoardError('The linked Pi session could not be found', 404)
  await board.prepareTakeover(cardId, expectedVersion)
  const card = board.getCard(cardId)!
  const runner = createBoardRunner()
  try {
    await runner.start()
    const switched = await runner.request({ type: 'switch_session', sessionPath: path })
    if (switched.data && typeof switched.data === 'object' && (switched.data as Record<string, unknown>).cancelled) throw new BoardError('A Pi extension cancelled opening the linked session', 409)
    const response = await runner.request({ type: 'get_state' })
    const current = (response.data ?? {}) as Record<string, unknown>
    if (current.sessionId !== card.piSessionId) throw new BoardError('Pi did not open the linked session', 409)
    await updateBoardRun(cardId, 'working', 'Pi took ownership of the existing plan and is implementing it.', card.piSessionId!, 0)
    beginBoardRun(runner, cardId, card.piSessionId!)
    await runner.request({ type: 'prompt', message: 'The user has reassigned the remaining Project Board plan to Pi. Continue in this same session, treat the user’s latest Chat instructions as authoritative, implement the remaining work autonomously, and use dashboard_project_status for approval requests, blockers, or whole-card completion. Do not mark the card completed after only one partial step.' })
  } catch (error) {
    await runner.stop().catch(() => undefined)
    const failedRun = activeBoardRun as ActiveBoardRun | undefined
    if (failedRun?.rpc === runner) await finishBoardRun(failedRun)
    const message = error instanceof Error ? error.message : 'Unable to hand the plan to Pi'
    await board.setPiState(cardId, { status: 'failed', message }, card.piSessionId ?? undefined).catch(() => undefined)
    broadcast({ type: 'board_changed' })
    throw error
  }
}

async function handleBoardEvent(event: RpcEvent): Promise<void> {
  const run = activeBoardRun
  if (!run) return
  if (event.type === 'turn_start') {
    run.turns += 1
    if (run.turns > boardTurnLimit) {
      await run.rpc.request({ type: 'abort' }).catch(() => undefined)
      await updateBoardRun(run.cardId, 'paused', `Pi reached the ${boardTurnLimit}-turn project limit. Review progress and resume when ready.`, run.sessionId, run.turns - 1)
      await finishBoardRun(run)
    }
    return
  }
  if (event.type === 'tool_execution_end' && event.toolName === 'dashboard_project_status' && !event.isError) {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    const result = event.result && typeof event.result === 'object' ? event.result as Record<string, unknown> : undefined
    const details = result?.details && typeof result.details === 'object' ? result.details as Record<string, unknown> : undefined
    const args = (event.args as Record<string, unknown> | undefined) ?? boardToolInputs.get(toolCallId) ?? details
    if (!args || args.cardId !== run.cardId || typeof args.message !== 'string') return
    const allowed = ['working', 'plan-ready', 'awaiting-approval', 'blocked', 'completed'] as const
    if (!allowed.includes(args.status as (typeof allowed)[number])) return
    await updateBoardRun(run.cardId, args.status as (typeof allowed)[number], args.message, run.sessionId, run.turns)
    if (args.status !== 'working') await finishBoardRun(run)
    return
  }
  if (event.type === 'message_update') {
    const delta = event.assistantMessageEvent as Record<string, unknown> | undefined
    if (delta?.type === 'error' && delta.reason !== 'aborted') {
      await updateBoardRun(run.cardId, 'failed', `Pi’s response failed: ${String(delta.reason ?? 'unknown error')}. Review the linked session and retry when ready.`, run.sessionId, run.turns)
      await finishBoardRun(run)
      return
    }
  }
  if (event.type === 'extension_error') {
    await updateBoardRun(run.cardId, 'failed', `A Pi extension failed: ${String(event.error ?? 'unknown error')}`, run.sessionId, run.turns)
    await finishBoardRun(run)
    return
  }
  if (event.type === 'agent_settled' && activeBoardRun === run) {
    await updateBoardRun(run.cardId, 'paused', 'Pi stopped without reporting completion. Review the linked session, then resume or provide guidance.', run.sessionId, run.turns)
    await finishBoardRun(run)
  }
}

async function handleLinkedChatBoardEvent(event: RpcEvent): Promise<void> {
  if (!currentSessionId || activeBoardRun) return
  const card = board.get().cards.find((candidate) => candidate.piSessionId === currentSessionId && !candidate.archivedAt)
  if (!card) return
  if (event.type === 'tool_execution_end' && event.toolName === 'dashboard_project_status' && !event.isError) {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : ''
    const result = event.result && typeof event.result === 'object' ? event.result as Record<string, unknown> : undefined
    const details = result?.details && typeof result.details === 'object' ? result.details as Record<string, unknown> : undefined
    const args = (event.args as Record<string, unknown> | undefined) ?? boardToolInputs.get(toolCallId) ?? details
    if (!args || args.cardId !== card.id || typeof args.message !== 'string') return
    const allowed = ['working', 'plan-ready', 'awaiting-approval', 'blocked', 'completed'] as const
    if (!allowed.includes(args.status as (typeof allowed)[number])) return
    await updateBoardRun(card.id, args.status as (typeof allowed)[number], args.message, currentSessionId)
  } else if (event.type === 'agent_settled') {
    const latest = board.getCard(card.id)
    if (latest?.piStatus === 'working') {
      await updateBoardRun(card.id, 'paused', 'Interactive Pi work paused at the end of this Chat turn. Continue chatting or update the card status.', currentSessionId)
    }
  }
}

rpc.on('event', (event: RpcEvent) => {
  broadcast({ type: 'event', event })
  if (!activeBoardRun && event.type === 'tool_execution_start' && event.toolName === 'dashboard_project_status' && typeof event.toolCallId === 'string' && event.args && typeof event.args === 'object') {
    boardToolInputs.set(event.toolCallId, event.args as Record<string, unknown>)
  }
  boardEventChain = boardEventChain.then(async () => {
    await handleLinkedChatBoardEvent(event)
    if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string') boardToolInputs.delete(event.toolCallId)
  }).catch((error: Error) => broadcast({ type: 'error', message: `Linked Project Board update failed: ${error.message}` }))

  if (event.type === 'agent_start') {
    currentRunId = randomUUID()
    record({ category: 'session', type: 'run_start', severity: 'info', summary: 'Pi started a run', sessionId: currentSessionId, runId: currentRunId })
  } else if (event.type === 'agent_settled') {
    record({ category: 'session', type: 'run_settled', severity: 'info', summary: 'Pi run settled', sessionId: currentSessionId, runId: currentRunId })
    currentRunId = undefined
    void chatStateSnapshot()
      .then((snapshot) => {
        rememberState(snapshot)
        broadcast({ type: 'state', state: snapshot })
        broadcast({ type: 'sessions_changed' })
        broadcast({ type: 'workspace_changed' })
      })
      .catch((error: Error) => {
        record({ category: 'error', type: 'state_refresh_failed', severity: 'error', summary: error.message, sessionId: currentSessionId })
        broadcast({ type: 'error', message: error.message })
      })
  } else if (event.type === 'tool_execution_start') {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : randomUUID()
    toolStartTimes.set(toolCallId, Date.now())
    record({
      category: 'tool', type: 'tool_start', severity: 'info', summary: `Started ${String(event.toolName ?? 'tool')}`,
      sessionId: currentSessionId, runId: currentRunId, correlationId: toolCallId,
      data: { toolName: String(event.toolName ?? 'tool') },
    })
  } else if (event.type === 'tool_execution_end') {
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined
    const started = toolCallId ? toolStartTimes.get(toolCallId) : undefined
    if (toolCallId) toolStartTimes.delete(toolCallId)
    const failed = Boolean(event.isError)
    record({
      category: failed ? 'error' : 'tool', type: 'tool_end', severity: failed ? 'error' : 'info',
      summary: `${failed ? 'Failed' : 'Completed'} ${String(event.toolName ?? 'tool')}`,
      sessionId: currentSessionId, runId: currentRunId, correlationId: toolCallId,
      data: { toolName: String(event.toolName ?? 'tool'), ...(started ? { durationMs: Date.now() - started } : {}) },
    })
  } else if (event.type === 'extension_error') {
    record({ category: 'error', type: 'extension_error', severity: 'error', summary: String(event.error ?? 'Extension failed'), sessionId: currentSessionId, runId: currentRunId })
  }
})

rpc.on('ready', () => {
  record({ category: 'system', type: 'rpc_ready', severity: 'info', summary: 'Pi RPC started' })
  broadcast({ type: 'connection', status: 'connected' })
})
rpc.on('exit', (error: Error) => {
  record({ category: 'error', type: 'rpc_exit', severity: 'error', summary: error.message, sessionId: currentSessionId })
  broadcast({ type: 'connection', status: 'error', message: error.message })
})
rpc.on('protocolError', (error: Error) => {
  record({ category: 'error', type: 'rpc_protocol_error', severity: 'error', summary: error.message, sessionId: currentSessionId })
  broadcast({ type: 'error', message: error.message })
})

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(JSON.stringify(body))
}

function hostedPluginResponse(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const contentType = headers['content-type'] ?? headers['Content-Type']
  const baseHeaders = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  }
  if (body === undefined) {
    response.writeHead(status, baseHeaders)
    response.end()
    return
  }
  if (Buffer.isBuffer(body)) {
    response.writeHead(status, { ...baseHeaders, ...(contentType ? {} : { 'content-type': 'application/octet-stream' }) })
    response.end(body)
    return
  }
  if (typeof body === 'string' && contentType && !contentType.toLowerCase().includes('json')) {
    response.writeHead(status, baseHeaders)
    response.end(body)
    return
  }
  response.writeHead(status, { ...baseHeaders, ...(contentType ? {} : { 'content-type': 'application/json; charset=utf-8' }) })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

function sendPluginAsset(response: ServerResponse, asset: { body: Buffer; contentType: string }, head = false): void {
  response.writeHead(200, {
    'content-type': asset.contentType,
    'content-length': asset.body.length,
    'cache-control': 'no-store',
    'content-security-policy': pluginAssetContentSecurityPolicy(allowedOrigins),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(head ? undefined : asset.body)
}

async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')

  const pluginCapabilityMatch = url.pathname.match(/^\/plugin-assets\/([A-Za-z0-9_-]{43})\/([^/]+)\/?(.*)$/)
  if ((request.method === 'GET' || request.method === 'HEAD') && pluginCapabilityMatch) {
    requireFeature('plugins')
    const asset = await plugins.capabilityAsset(pluginCapabilityMatch[1], decodeURIComponent(pluginCapabilityMatch[2]), decodeURIComponent(pluginCapabilityMatch[3]))
    sendPluginAsset(response, asset, request.method === 'HEAD')
    return
  }

  if (url.pathname.startsWith('/internal/workers/')) {
    const supplied = request.headers['x-pi-dashboard-worker-token']
    const suppliedBuffer = Buffer.from(typeof supplied === 'string' ? supplied : '')
    const expectedBuffer = Buffer.from(workerInternalToken)
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      json(response, 404, { error: 'Not found' })
      return
    }
    requireFeature('workers')
    if (request.method === 'POST' && url.pathname === '/internal/workers/tasks') {
      const body = await readJsonBody(request)
      json(response, 202, await workers.start({
        providerId: 'sub-pi',
        mode: typeof body.mode === 'string' ? body.mode : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      }))
      return
    }
    const internalTaskMatch = url.pathname.match(/^\/internal\/workers\/tasks\/([^/]+)$/)
    if (request.method === 'GET' && internalTaskMatch) {
      const task = workers.get(decodeURIComponent(internalTaskMatch[1]))
      json(response, task ? 200 : 404, task ?? { error: 'Worker task not found' })
      return
    }
    json(response, 404, { error: 'Not found' })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/status') {
    json(response, 200, { enabled: auth.enabled, authenticated: auth.authenticate(request) })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJsonBody(request)
    if (!auth.login(request, response, body.token)) {
      record({ category: 'system', type: 'auth_login_failed', severity: 'warning', summary: 'Dashboard authentication failed' })
      json(response, 401, { error: 'Invalid dashboard token' })
      return
    }
    record({ category: 'system', type: 'auth_login', severity: 'info', summary: 'Dashboard authentication succeeded' })
    json(response, 200, { authenticated: true })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (auth.enabled && !auth.authenticate(request)) {
      json(response, 401, { error: 'Authentication required' })
      return
    }
    auth.logout(request, response)
    record({ category: 'system', type: 'auth_logout', severity: 'info', summary: 'Dashboard session ended' })
    json(response, 200, { authenticated: false })
    return
  }
  if (auth.enabled && !auth.authenticate(request)) {
    json(response, 401, { error: 'Authentication required' })
    return
  }
  const mutating = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS'
  if (mutating && !auth.originAllowed(request, allowedOrigins)) {
    json(response, 403, { error: 'Request origin is not allowed' })
    return
  }

  if (url.pathname.startsWith('/api/cron')) requireFeature('cron')
  if (url.pathname.startsWith('/api/board')) requireFeature('board')
  if (url.pathname.startsWith('/api/skills') || url.pathname === '/api/tools') requireFeature('skills')
  if (url.pathname.startsWith('/api/plugins')) requireFeature('plugins')
  if (url.pathname.startsWith('/api/workers')) requireFeature('workers')

  if (request.method === 'GET' && url.pathname === '/api/provider-login/status') {
    const models = await availableModels().catch(() => [])
    json(response, 200, { active: providerLogin.active, providers: [...new Set(models.map((model) => model.provider))].sort(), modelCount: models.length })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/provider-login/complete') {
    await providerLogin.stop()
    await rpc.stop()
    await rpc.start()
    const models = await availableModels()
    const providers = [...new Set(models.map((model) => model.provider))].sort()
    record({ category: 'system', type: 'provider_login_refreshed', severity: 'info', summary: providers.length ? `Refreshed Pi login for ${providers.join(', ')}` : 'Refreshed Pi after provider login' })
    await sendSnapshot()
    json(response, 200, { active: false, providers, modelCount: models.length })
    return
  }

  const pluginRuntimeMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)\/runtime(?:\/(.*))?$/)
  if (pluginRuntimeMatch) {
    const pluginId = decodeURIComponent(pluginRuntimeMatch[1])
    const runtime = plugins.runtime(pluginId)
    const runtimePath = `/${pluginRuntimeMatch[2] ?? ''}`
    if (runtime.protocol === 'host-module') {
      let body: unknown = undefined
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await readJsonBody(request).catch(() => undefined)
      }
      const result = await plugins.pluginHost.handleRequest(pluginId, {
        method: (request.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: runtimePath,
        query: url.searchParams,
        headers: request.headers as Record<string, string | string[] | undefined>,
        body,
      })
      hostedPluginResponse(response, result.status ?? 200, result.body, result.headers)
    } else {
      await proxyPluginRuntime(request, response, { pluginId, socketPath: runtime.socketPath, path: `${runtimePath}${url.search}` })
    }
    record({ category: 'system', type: 'plugin_runtime_request', severity: 'info', summary: `${request.method ?? 'GET'} request to plugin ${pluginId}`, sessionId: currentSessionId, data: { pluginId, method: request.method ?? 'GET' } })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/onboarding') {
    const body = await readJsonBody(request)
    const action = typeof body.action === 'string' ? body.action : ''
    const result = action === 'skip'
      ? await onboarding.skip()
      : action === 'resume'
        ? await onboarding.resume()
        : action === 'complete'
          ? await (async () => {
              if (typeof body.authToken === 'string' && body.authToken.trim()) {
                auth.setToken(body.authToken.trim())
                auth.login(request, response, body.authToken.trim())
              }
              return await onboarding.complete({
                appName: typeof body.appName === 'string' ? body.appName : undefined,
                importedUserProfile: typeof body.importedUserProfile === 'string' ? body.importedUserProfile : undefined,
                importedGlobalMemory: typeof body.importedGlobalMemory === 'string' ? body.importedGlobalMemory : undefined,
                profileItems: body.profileItems,
                profileApproved: body.profileApproved,
                features: typeof body.features === 'object' && body.features !== null ? body.features as any : undefined,
              })
            })()
          : (() => { throw new OnboardingError('Onboarding action must be skip, resume, or complete') })()
    record({ category: 'system', type: `onboarding_${action}`, severity: 'info', summary: `${action === 'complete' ? 'Completed' : action === 'skip' ? 'Skipped' : 'Resumed'} Dashboard onboarding`, sessionId: currentSessionId })
    json(response, 200, result)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/plugins/review') {
    const body = await readJsonBody(request)
    if (typeof body.url !== 'string') throw new PluginError('Repository URL is required')
    const review = await plugins.reviewRepository(body.url)
    record({ category: 'system', type: 'plugin_repository_reviewed', severity: 'info', summary: `Reviewed plugin repository for ${review.plugin.name}`, sessionId: currentSessionId, data: { pluginId: review.plugin.id, repository: review.repository, commit: review.commit } })
    json(response, 200, review)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/plugins/install') {
    const body = await readJsonBody(request)
    if (typeof body.reviewId !== 'string' || typeof body.digest !== 'string') throw new PluginError('A completed plugin review is required')
    const plugin = await plugins.install(body.reviewId, body.digest)
    record({ category: 'system', type: 'plugin_installed', severity: 'warning', summary: `Installed plugin ${plugin.name}`, sessionId: currentSessionId, data: { pluginId: plugin.id, version: plugin.version, ...(plugin.repository ? { repository: plugin.repository } : {}), ...(plugin.commit ? { commit: plugin.commit } : {}) } })
    json(response, 201, plugin)
    return
  }
  const pluginToggleMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)\/enable$/)
  if (request.method === 'POST' && pluginToggleMatch) {
    const body = await readJsonBody(request)
    if (typeof body.enabled !== 'boolean') throw new PluginError('Enabled must be true or false')
    await queueManagement(async () => {
      const id = decodeURIComponent(pluginToggleMatch[1])
      if (plugins.list().find((candidate) => candidate.id === id)?.agentTools.length) await ensureIdle()
      const plugin = await plugins.setEnabled(id, body.enabled as boolean)
      if (plugin.agentTools.length) await reloadRpcResources()
      record({ category: 'system', type: body.enabled ? 'plugin_enabled' : 'plugin_disabled', severity: 'info', summary: `${body.enabled ? 'Enabled' : 'Disabled'} plugin ${plugin.name}`, sessionId: currentSessionId, data: { pluginId: plugin.id, version: plugin.version } })
      json(response, 200, plugin)
    })
    return
  }
  const pluginAgentAccessMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)\/agent-access$/)
  if (request.method === 'POST' && pluginAgentAccessMatch) {
    const body = await readJsonBody(request)
    if (typeof body.read !== 'boolean' || typeof body.write !== 'boolean') throw new PluginError('Pi read and write access must be true or false')
    await queueManagement(async () => {
      await ensureIdle()
      const plugin = await plugins.setAgentAccess(decodeURIComponent(pluginAgentAccessMatch[1]), { read: body.read as boolean, write: body.write as boolean })
      await reloadRpcResources()
      record({ category: 'system', type: 'plugin_agent_access_updated', severity: body.write ? 'warning' : 'info', summary: `Updated Pi access for ${plugin.name}`, sessionId: currentSessionId, data: { pluginId: plugin.id, read: body.read as boolean, write: body.write as boolean } })
      json(response, 200, plugin)
    })
    return
  }
  const pluginRollbackMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)\/rollback$/)
  if (request.method === 'POST' && pluginRollbackMatch) {
    const plugin = await plugins.rollback(decodeURIComponent(pluginRollbackMatch[1]))
    record({ category: 'system', type: 'plugin_rolled_back', severity: 'warning', summary: `Rolled plugin ${plugin.name} to ${plugin.version}`, sessionId: currentSessionId, data: { pluginId: plugin.id, version: plugin.version } })
    json(response, 200, plugin)
    return
  }
  const pluginRemoveMatch = url.pathname.match(/^\/api\/plugins\/([^/]+)$/)
  if (request.method === 'DELETE' && pluginRemoveMatch) {
    const id = decodeURIComponent(pluginRemoveMatch[1])
    const deleteData = url.searchParams.get('deleteData') === 'true'
    await plugins.remove(id, deleteData)
    record({ category: 'system', type: 'plugin_removed', severity: 'warning', summary: `Removed plugin ${id}${deleteData ? ' and deleted its data' : ''}`, sessionId: currentSessionId, data: { pluginId: id, deleteData } })
    json(response, 200, { ok: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/files') {
    requireFeature('files-editor')
    const body = await readJsonBody(request, 7 * 1024 * 1024, (message, status) => new FileAccessError(message, status))
    if (typeof body.path !== 'string') throw new FileAccessError('Choose a file name')
    const result = await files.create(body.path, body.content ?? '')
    record({ category: 'system', type: 'workspace_file_created', severity: 'info', summary: `Created project file ${result.file.path}`, sessionId: currentSessionId })
    broadcast({ type: 'workspace_changed' })
    json(response, 201, result)
    return
  }
  if (request.method === 'PUT' && url.pathname === '/api/files/content') {
    requireFeature('files-editor')
    const body = await readJsonBody(request, 7 * 1024 * 1024, (message, status) => new FileAccessError(message, status))
    const result = await files.save(url.searchParams.get('path') ?? '', body.content, body.revision)
    record({ category: 'system', type: 'workspace_file_saved', severity: 'info', summary: `Saved project file ${result.file.path}`, sessionId: currentSessionId })
    broadcast({ type: 'workspace_changed' })
    json(response, 200, result)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/skills/review') {
    const body = await readJsonBody(request)
    if (typeof body.path !== 'string') throw new SkillError('Import path is required')
    json(response, 200, await skills.review(body.path))
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/skills/adopt') {
    const body = await readJsonBody(request)
    if (typeof body.path !== 'string' || typeof body.digest !== 'string') throw new SkillError('Reviewed path and digest are required')
    if (body.scope !== 'user' && body.scope !== 'project') throw new SkillError('Choose a personal or project skill destination')
    const scope = body.scope
    await queueManagement(async () => {
      const adopted = await skills.adopt(body.path as string, body.digest as string, scope)
      await reloadRpcResources()
      record({ category: 'skill', type: 'skill_adopted', severity: 'info', summary: `Adopted inactive ${scope} skill ${adopted.name}`, sessionId: currentSessionId, data: { skillName: adopted.name, scope } })
      json(response, 201, adopted)
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/curated-memory') {
    await queueManagement(async () => {
      await system.updateCuratedMemory(await readJsonBody(request))
      await reloadRpcResources()
    })
    record({ category: 'system', type: 'curated_memory_settings_updated', severity: 'info', summary: 'Updated curated memory settings', sessionId: currentSessionId })
    json(response, 200, await systemSnapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/memory-checkpoint') {
    await system.updateMemoryCheckpoint(await readJsonBody(request))
    record({ category: 'system', type: 'memory_checkpoint_settings_updated', severity: 'info', summary: 'Updated automatic memory checkpoint settings', sessionId: currentSessionId })
    json(response, 200, await systemSnapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/memory-checkpoint/run') {
    await queueManagement(async () => {
      await ensureIdle()
      await rpc.request({ type: 'prompt', message: '/dashboard-memory-checkpoint-now' })
    })
    record({ category: 'system', type: 'memory_checkpoint_requested', severity: 'info', summary: 'Requested a manual memory checkpoint', sessionId: currentSessionId })
    json(response, 202, await systemSnapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/memory-checkpoint/reset') {
    await queueManagement(async () => {
      await ensureIdle()
      await rpc.request({ type: 'prompt', message: '/dashboard-memory-checkpoint-reset' })
    })
    record({ category: 'system', type: 'memory_checkpoint_counters_reset', severity: 'info', summary: 'Reset memory checkpoint counters', sessionId: currentSessionId })
    json(response, 200, await systemSnapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/defaults') {
    const body = await readJsonBody(request)
    const provider = typeof body.provider === 'string' ? body.provider : ''
    const model = typeof body.model === 'string' ? body.model : ''
    const models = await availableModels()
    if (!models.some((candidate) => candidate.provider === provider && candidate.id === model)) throw new SystemError('Choose a model available to the running Pi process')
    await queueManagement(async () => { await system.updateDefaults(body) })
    record({ category: 'system', type: 'default_model_updated', severity: 'info', summary: `Updated default model to ${provider}/${model}`, sessionId: currentSessionId })
    json(response, 200, await systemSnapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/session') {
    const body = await readJsonBody(request)
    await queueManagement(async () => {
      const previous = await ensureIdle()
      const previousModel = previous.model && typeof previous.model === 'object' ? previous.model as Record<string, unknown> : undefined
      const previousThinking = typeof previous.thinkingLevel === 'string' ? previous.thinkingLevel : undefined
      try {
        if (body.provider !== undefined || body.model !== undefined) {
          if (typeof body.provider !== 'string' || typeof body.model !== 'string') throw new SystemError('Provider and model are required together')
          const models = await availableModels()
          if (!models.some((candidate) => candidate.provider === body.provider && candidate.id === body.model)) throw new SystemError('Choose a model available to the running Pi process')
          await rpc.request({ type: 'set_model', provider: body.provider, modelId: body.model })
        }
        if (body.thinkingLevel !== undefined) {
          if (typeof body.thinkingLevel !== 'string' || !THINKING_LEVELS.includes(body.thinkingLevel as (typeof THINKING_LEVELS)[number])) throw new SystemError('Thinking level is invalid')
          await rpc.request({ type: 'set_thinking_level', level: body.thinkingLevel })
        }
      } catch (error) {
        if (typeof previousModel?.provider === 'string' && typeof previousModel.id === 'string') {
          await rpc.request({ type: 'set_model', provider: previousModel.provider, modelId: previousModel.id }).catch(() => undefined)
        }
        if (previousThinking) await rpc.request({ type: 'set_thinking_level', level: previousThinking }).catch(() => undefined)
        throw error
      }
      await sendSnapshot()
    })
    record({ category: 'system', type: 'active_session_settings_updated', severity: 'info', summary: 'Updated active Pi session model settings', sessionId: currentSessionId })
    json(response, 200, await systemSnapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/restart-rpc') {
    await queueManagement(async () => {
      await ensureIdle()
      await rpc.stop()
      await rpc.start()
      await sendSnapshot()
    })
    record({ category: 'system', type: 'rpc_restarted', severity: 'warning', summary: 'Restarted Pi RPC from dashboard settings', sessionId: currentSessionId })
    json(response, 200, await systemSnapshot())
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/cron/jobs') {
    const snapshot = await cron.create(await readJsonBody(request))
    record({ category: 'cron', type: 'cron_job_created', severity: 'info', summary: 'Created a scheduled job', sessionId: currentSessionId })
    json(response, 201, snapshot)
    return
  }
  const cronActionMatch = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)\/(run|stop)$/)
  if (request.method === 'POST' && cronActionMatch) {
    const id = decodeURIComponent(cronActionMatch[1])
    const action = cronActionMatch[2]
    const snapshot = action === 'run' ? await cron.runNow(id) : await cron.stopRun(id)
    record({ category: 'cron', type: action === 'run' ? 'cron_run_started' : 'cron_run_stopped', severity: 'info', summary: action === 'run' ? 'Started a scheduled job manually' : 'Stopped a scheduled job run', sessionId: currentSessionId, data: { jobId: id } })
    json(response, 202, snapshot)
    return
  }
  const cronJobMatch = url.pathname.match(/^\/api\/cron\/jobs\/([^/]+)$/)
  if (request.method === 'PATCH' && cronJobMatch) {
    const id = decodeURIComponent(cronJobMatch[1])
    const version = expectedUpdatedAt(request, (message, status) => new CronError(message, status))
    const snapshot = await cron.update(id, await readJsonBody(request), version)
    record({ category: 'cron', type: 'cron_job_updated', severity: 'info', summary: 'Updated a scheduled job', sessionId: currentSessionId, data: { jobId: id } })
    json(response, 200, snapshot)
    return
  }
  if (request.method === 'DELETE' && cronJobMatch) {
    const id = decodeURIComponent(cronJobMatch[1])
    const version = expectedUpdatedAt(request, (message, status) => new CronError(message, status))
    const snapshot = await cron.remove(id, version)
    record({ category: 'cron', type: 'cron_job_deleted', severity: 'info', summary: 'Deleted a scheduled job', sessionId: currentSessionId, data: { jobId: id } })
    json(response, 200, snapshot)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/board/cards') {
    const body = await readJsonBody(request)
    const snapshot = await board.create(body)
    record({ category: 'board', type: 'board_card_created', severity: 'info', summary: 'Created a project board card', sessionId: currentSessionId })
    broadcast({ type: 'board_changed' })
    json(response, 201, snapshot)
    return
  }
  const boardActionMatch = url.pathname.match(/^\/api\/board\/cards\/([^/]+)\/(start|approve|resume|takeover|stop|archive|restore|status)$/)
  if (request.method === 'POST' && boardActionMatch) {
    const id = decodeURIComponent(boardActionMatch[1])
    const action = boardActionMatch[2]
    const version = expectedUpdatedAt(request, (message, status) => new BoardError(message, status))
    const body = await readJsonBody(request)
    await queueManagement(async () => {
      if (action === 'start') {
        const mode = typeof body.mode === 'string' && BOARD_RUN_MODES.includes(body.mode as BoardRunMode) ? body.mode as BoardRunMode : undefined
        if (!mode) throw new BoardError('Choose a valid Project Board run mode')
        await startBoardProject(id, version, mode)
      } else if (action === 'approve' || action === 'resume') {
        await resumeBoardProject(id, version, action === 'approve')
      } else if (action === 'takeover') {
        await takeoverBoardProject(id, version)
      } else if (action === 'stop') {
        const card = board.getCard(id)
        if (!card) throw new BoardError('Card not found', 404)
        if (card.updatedAt !== version) throw new BoardError('This card changed in another browser. Refresh and try again.', 409)
        const run = activeBoardRun
        if (!run || run.cardId !== id || !['working', 'planning'].includes(card.piStatus)) throw new BoardError('Pi is not actively working on this card', 409)
        await run.rpc.request({ type: 'abort' }).catch(() => undefined)
        await finishBoardRun(run)
        await board.setPiState(id, { status: 'paused', message: 'Stopped by the user.' }, card.piSessionId ?? undefined)
        broadcast({ type: 'board_changed' })
      } else if (action === 'archive' || action === 'restore') {
        await board.archive(id, action === 'archive', version)
        broadcast({ type: 'board_changed' })
      } else {
        const manualAction = typeof body.action === 'string' && MANUAL_CARD_ACTIONS.includes(body.action as ManualCardAction) ? body.action as ManualCardAction : undefined
        if (!manualAction) throw new BoardError('Choose a valid manual card status')
        await board.setManualStatus(id, manualAction, version)
        broadcast({ type: 'board_changed' })
      }
      record({ category: 'board', type: `board_project_${action}`, severity: action === 'stop' ? 'warning' : 'info', summary: `${action} Project Board card`, sessionId: board.getCard(id)?.piSessionId ?? currentSessionId, data: { cardId: id } })
      json(response, ['start', 'approve', 'resume', 'takeover'].includes(action) ? 202 : 200, board.get())
    })
    return
  }
  const boardCardMatch = url.pathname.match(/^\/api\/board\/cards\/([^/]+)$/)
  if (request.method === 'PATCH' && boardCardMatch) {
    const body = await readJsonBody(request)
    const id = decodeURIComponent(boardCardMatch[1])
    const version = expectedUpdatedAt(request, (message, status) => new BoardError(message, status))
    const snapshot = await board.update(id, body, version)
    record({ category: 'board', type: 'board_card_updated', severity: 'info', summary: 'Updated a project board card', sessionId: currentSessionId, data: { cardId: id } })
    broadcast({ type: 'board_changed' })
    json(response, 200, snapshot)
    return
  }
  if (request.method === 'DELETE' && boardCardMatch) {
    const id = decodeURIComponent(boardCardMatch[1])
    const version = expectedUpdatedAt(request, (message, status) => new BoardError(message, status))
    const snapshot = await board.remove(id, version)
    record({ category: 'board', type: 'board_card_deleted', severity: 'info', summary: 'Deleted a project board card', sessionId: currentSessionId, data: { cardId: id } })
    broadcast({ type: 'board_changed' })
    json(response, 200, snapshot)
    return
  }

  const toggleMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/toggle$/)
  if (request.method === 'POST' && toggleMatch) {
    const body = await readJsonBody(request)
    if (typeof body.enabled !== 'boolean') throw new SkillError('Enabled must be true or false')
    await queueManagement(async () => {
      const runtimePaths = await runtimeSkillPaths()
      const updated = await skills.setEnabled(decodeURIComponent(toggleMatch[1]), body.enabled as boolean, runtimePaths, plugins.skillCatalog())
      await reloadRpcResources()
      record({ category: 'skill', type: body.enabled ? 'skill_enabled' : 'skill_disabled', severity: 'info', summary: `${body.enabled ? 'Enabled' : 'Disabled'} skill ${updated.name}`, sessionId: currentSessionId, data: { skillName: updated.name } })
      json(response, 200, updated)
    })
    return
  }

  const sessionActionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(archive|restore)$/)
  if (request.method === 'POST' && sessionActionMatch) {
    const id = decodeURIComponent(sessionActionMatch[1])
    const action = sessionActionMatch[2]
    if (action === 'archive' && id === currentSessionId) throw new SystemError('Start or resume another session before archiving the active session')
    if (!await sessions.pathFor(id)) throw new SystemError('Session not found', 404)
    if (action === 'archive') await sessionArchive.archive(id)
    else await sessionArchive.restore(id)
    record({ category: 'session', type: `session_${action}`, severity: 'info', summary: `${action === 'archive' ? 'Archived' : 'Restored'} a session`, sessionId: id })
    broadcast({ type: 'sessions_changed' })
    json(response, 200, { ok: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/workers/tasks') {
    const body = await readJsonBody(request)
    const task = await workers.start({
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
    })
    record({ category: 'system', type: 'worker_task_started', severity: 'info', summary: `Started ${task.mode} task with ${task.providerName}`, sessionId: currentSessionId, data: { taskId: task.id, providerId: task.providerId, mode: task.mode } })
    json(response, 202, task)
    return
  }
  const workerCancelMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && workerCancelMatch) {
    const task = await workers.cancel(decodeURIComponent(workerCancelMatch[1]))
    record({ category: 'system', type: 'worker_task_cancelled', severity: 'warning', summary: `Cancelled ${task.providerName} task`, sessionId: task.sessionId, data: { taskId: task.id } })
    json(response, 200, task)
    return
  }

  if (request.method !== 'GET') {
    json(response, 405, { error: 'Method not allowed' })
    return
  }
  if (url.pathname === '/api/onboarding') {
    json(response, 200, await onboarding.get())
    return
  }
  if (url.pathname === '/api/config') {
    json(response, 200, { profile: profile.name, features: profile.features, ...(enabledFeatures.has('preview') ? { previewPort: previewPublicPort } : {}), ...(enabledFeatures.has('plugins') ? { pluginSources: pluginLocalRepositoryRoot ? ['github', 'workspace', 'local-preview'] : ['github', 'workspace'] } : {}) })
    return
  }
  if (url.pathname === '/api/workers') {
    json(response, 200, workers.snapshot())
    return
  }
  const workerTaskMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)$/)
  if (workerTaskMatch) {
    const task = workers.get(decodeURIComponent(workerTaskMatch[1]))
    json(response, task ? 200 : 404, task ?? { error: 'Worker task not found' })
    return
  }
  if (url.pathname === '/api/plugins') {
    json(response, 200, { plugins: await plugins.listDetailed() })
    return
  }
  if (url.pathname === '/api/health') {
    json(response, rpc.running ? 200 : 503, { ok: rpc.running, workspace })
    return
  }
  if (url.pathname === '/api/system') {
    json(response, 200, await systemSnapshot())
    return
  }
  if (url.pathname === '/api/cron') {
    json(response, 200, cron.get())
    return
  }
  if (url.pathname === '/api/board') {
    json(response, 200, board.get())
    return
  }
  if (url.pathname === '/api/files') {
    const path = url.searchParams.get('path') ?? ''
    const [entries, gitStatus] = await Promise.all([files.list(path), git.status()])
    json(response, 200, {
      path: files.validateRelative(path),
      entries: entries.map((entry) => ({ ...entry, gitState: git.statusFor(entry.path, entry.type, gitStatus.entries) })),
      git: { available: gitStatus.available, clean: gitStatus.clean, branch: gitStatus.branch, commit: gitStatus.commit },
    })
    return
  }
  if (url.pathname === '/api/files/content') {
    json(response, 200, await files.preview(url.searchParams.get('path') ?? ''))
    return
  }
  if (url.pathname === '/api/files/search') {
    json(response, 200, { results: await files.search(url.searchParams.get('q') ?? '') })
    return
  }
  if (url.pathname === '/api/git/status') {
    json(response, 200, await git.status())
    return
  }
  if (url.pathname === '/api/git/diff') {
    const path = files.validateRelative(url.searchParams.get('path') ?? '')
    if (!path) throw new FileAccessError('Select a changed file')
    json(response, 200, await git.diff(path))
    return
  }
  if (url.pathname === '/api/tools') {
    json(response, 200, await tools.get(enabledFeatures.has('plugins') ? plugins.list() : []))
    return
  }
  if (url.pathname === '/api/skills') {
    json(response, 200, { skills: await skills.list(await runtimeSkillPaths(), plugins.skillCatalog()) })
    return
  }
  const skillFileMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/file$/)
  if (skillFileMatch) {
    json(response, 200, await skills.readSkillFile(decodeURIComponent(skillFileMatch[1]), url.searchParams.get('path') ?? '', await runtimeSkillPaths(), plugins.skillCatalog()))
    return
  }
  const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/)
  if (skillMatch) {
    const detail = await skills.get(decodeURIComponent(skillMatch[1]), await runtimeSkillPaths(), plugins.skillCatalog())
    json(response, detail ? 200 : 404, detail ?? { error: 'Skill not found' })
    return
  }
  if (url.pathname === '/api/sessions') {
    const sessionList = await sessions.list()
    await sessionArchive.archiveInactive(sessionList, currentSessionId)
    json(response, 200, {
      sessions: sessionList.map((session) => ({ ...session, archived: sessionArchive.isArchived(session.id) })),
      currentSessionId,
      archiveAfterDays: 30,
    })
    return
  }
  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
  if (sessionMatch) {
    const detail = await sessions.get(decodeURIComponent(sessionMatch[1]))
    json(response, detail ? 200 : 404, detail ?? { error: 'Session not found' })
    return
  }
  if (url.pathname === '/api/activity') {
    const category = url.searchParams.get('category') as ActivityCategory | null
    const severity = url.searchParams.get('severity') as ActivitySeverity | null
    const sessionId = url.searchParams.get('sessionId') ?? undefined
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const validCategories: ActivityCategory[] = ['session', 'tool', 'skill', 'board', 'cron', 'error', 'system']
    const validSeverities: ActivitySeverity[] = ['info', 'warning', 'error']
    json(response, 200, { events: activity.query({
      ...(category && validCategories.includes(category) ? { category } : {}),
      ...(severity && validSeverities.includes(severity) ? { severity } : {}),
      ...(sessionId ? { sessionId } : {}),
      limit: Number.isFinite(limit) ? limit : 100,
    }) })
    return
  }
  json(response, 404, { error: 'Not found' })
}

function denyPreview(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(message)
}
function proxyPreviewHttp(request: IncomingMessage, response: ServerResponse): void {
  if (!enabledFeatures.has('preview')) { denyPreview(response, 404, 'Project Preview is not enabled.'); return }
  if (!auth.authenticate(request)) { denyPreview(response, 401, 'Dashboard sign-in is required.'); return }
  const upstream = httpRequest({ socketPath: terminalSocketPath, method: request.method, path: `/preview${request.url ?? '/'}`, headers: safePreviewHeaders(request.headers) }, (result) => {
    const headers = safePreviewHeaders(result.headers)
    delete headers.host
    delete headers['set-cookie']
    response.writeHead(result.statusCode ?? 502, headers)
    result.pipe(response)
  })
  request.pipe(upstream)
  upstream.on('error', () => {
    if (!response.headersSent) denyPreview(response, 502, 'Project Preview is unavailable. Start the Terminal service and try again.')
    else response.destroy()
  })
}

const previewServer = createServer(proxyPreviewHttp)
const previewWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
previewServer.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin
  if (!enabledFeatures.has('preview') || typeof origin !== 'string' || !previewAllowedOrigins.has(origin) || !auth.authenticate(request)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  previewWebSocketServer.handleUpgrade(request, socket, head, (client) => previewWebSocketServer.emit('connection', client, request))
})
previewWebSocketServer.on('connection', (browser, request: IncomingMessage) => {
  const upstream = new WebSocket(`ws://localhost/preview${request.url ?? '/'}`, {
    createConnection: () => connect(terminalSocketPath), headers: safePreviewHeaders(request.headers), handshakeTimeout: 10_000, maxPayload: 2 * 1024 * 1024,
  })
  const close = () => {
    if (browser.readyState === WebSocket.OPEN) browser.close()
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close()
  }
  upstream.on('message', (data, isBinary) => { if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary }) })
  upstream.on('open', () => browser.on('message', (data, isBinary) => { if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary }) }))
  upstream.on('error', close)
  upstream.on('close', close)
  browser.on('error', close)
  browser.on('close', close)
})

const server = createServer((request, response) => {
  void handleHttp(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : 'Request failed'
    const status = error instanceof FileAccessError || error instanceof SkillError || error instanceof BoardError || error instanceof CronError || error instanceof SystemError || error instanceof PluginError || error instanceof PluginRuntimeError || error instanceof OnboardingError || error instanceof WorkerError ? error.status : 500
    if (status >= 500) record({ category: 'error', type: 'http_error', severity: 'error', summary: message, sessionId: currentSessionId })
    if (!response.headersSent) json(response, status, { error: message })
    else response.end()
  })
})

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
const terminalWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
const providerLoginWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const allowedPath = path === '/ws' || path === '/ws/provider-login' || (path === '/ws/terminal' && enabledFeatures.has('terminal'))
  if (!allowedPath || typeof origin !== 'string' || !allowedOrigins.has(origin) || (auth.enabled && !auth.authenticate(request))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const target = path === '/ws/terminal' ? terminalWebSocketServer : path === '/ws/provider-login' ? providerLoginWebSocketServer : webSocketServer
  target.handleUpgrade(request, socket, head, (client) => target.emit('connection', client, request))
})

providerLoginWebSocketServer.on('connection', (browser) => {
  record({ category: 'system', type: 'provider_login_opened', severity: 'info', summary: 'Opened the embedded Pi provider login console' })
  providerLogin.attach(browser)
})

terminalWebSocketServer.on('connection', (browser) => {
  record({ category: 'system', type: 'terminal_opened', severity: 'info', summary: 'Opened native workspace terminal' })
  const session = new NativeTerminalSession(workspace)
  session.attach(browser)
})

webSocketServer.on('connection', (socket) => {
  clients.add(socket)
  send(socket, { type: 'connection', status: rpc.running ? 'connected' : 'starting' })

  void rpc.start()
    .then(() => sendSnapshot(socket))
    .catch((error: Error) => send(socket, { type: 'connection', status: 'error', message: error.message }))

  socket.on('message', (raw, isBinary) => {
    if (isBinary) {
      send(socket, { type: 'error', message: 'Binary messages are not supported' })
      return
    }
    let command: BrowserCommand
    try {
      command = JSON.parse(raw.toString('utf8')) as BrowserCommand
    } catch {
      send(socket, { type: 'error', message: 'Invalid JSON command' })
      return
    }
    void handleCommand(socket, command)
  })
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => clients.delete(socket))
})

async function handleCommand(socket: WebSocket, command: BrowserCommand): Promise<void> {
  try {
    switch (command.type) {
      case 'prompt': {
        const message = typeof command.message === 'string' ? command.message.trim() : ''
        if (!message || message.length > 100_000) throw new Error('Prompt must contain between 1 and 100,000 characters')
        const response = await rpc.request({ type: 'prompt', message })
        send(socket, { type: 'command_result', command: 'prompt', success: true, data: response.data })
        break
      }
      case 'abort': {
        const response = await rpc.request({ type: 'abort' })
        send(socket, { type: 'command_result', command: 'abort', success: true, data: response.data })
        break
      }
      case 'new_session':
        await queueManagement(async () => {
          await ensureIdle()
          const response = await rpc.request({ type: 'new_session' })
          await sendSnapshot()
          record({ category: 'session', type: 'session_new', severity: 'info', summary: 'Started a new session', sessionId: currentSessionId })
          broadcast({ type: 'sessions_changed' })
          send(socket, { type: 'command_result', command: 'new_session', success: true, data: response.data })
        })
        break
      case 'switch_session':
        await queueManagement(async () => {
          await ensureIdle()
          const path = await sessions.pathFor(command.sessionId)
          if (!path) throw new Error('Session not found')
          const response = await rpc.request({ type: 'switch_session', sessionPath: path })
          await sendSnapshot()
          record({ category: 'session', type: 'session_switch', severity: 'info', summary: 'Switched sessions', sessionId: currentSessionId })
          broadcast({ type: 'sessions_changed' })
          send(socket, { type: 'command_result', command: 'switch_session', success: true, data: response.data })
        })
        break
      case 'rename_session':
        await queueManagement(async () => {
          const name = command.name.trim()
          if (!name || name.length > 100) throw new Error('Session name must contain between 1 and 100 characters')
          await ensureIdle()
          if (command.sessionId === currentSessionId) await rpc.request({ type: 'set_session_name', name })
          else await sessions.renameInactive(command.sessionId, name)
          await sendSnapshot()
          record({ category: 'session', type: 'session_rename', severity: 'info', summary: 'Renamed a session', sessionId: command.sessionId })
          broadcast({ type: 'sessions_changed' })
          send(socket, { type: 'command_result', command: 'rename_session', success: true })
        })
        break
      case 'fork_session':
        await queueManagement(async () => {
          const current = await ensureIdle()
          if (current.sessionId !== command.sessionId) {
            const path = await sessions.pathFor(command.sessionId)
            if (!path) throw new Error('Session not found')
            await rpc.request({ type: 'switch_session', sessionPath: path })
          }
          const response = command.entryId
            ? await rpc.request({ type: 'fork', entryId: command.entryId })
            : await rpc.request({ type: 'clone' })
          await sendSnapshot()
          record({ category: 'session', type: 'session_fork', severity: 'info', summary: command.entryId ? 'Forked a session from a message' : 'Cloned a session', sessionId: currentSessionId })
          broadcast({ type: 'sessions_changed' })
          send(socket, { type: 'command_result', command: 'fork_session', success: true, data: response.data })
        })
        break
      case 'refresh':
        await sendSnapshot(socket)
        break
      case 'extension_ui_response':
        if (!command.id) throw new Error('Extension UI response requires an id')
        await rpc.start()
        rpc.send(command)
        break
      default:
        throw new Error('Unsupported command')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown backend error'
    record({ category: 'error', type: 'command_error', severity: 'error', summary: message, sessionId: currentSessionId, data: { command: command.type } })
    send(socket, { type: 'command_result', command: command.type, success: false })
    send(socket, { type: 'error', message })
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}; shutting down`)
  record({ category: 'system', type: 'server_stop', severity: 'info', summary: `Dashboard backend stopped (${signal})`, sessionId: currentSessionId })
  for (const client of clients) client.close(1001, 'Server shutting down')
  webSocketServer.close()
  previewWebSocketServer.close()
  providerLoginWebSocketServer.close()
  server.close()
  previewServer.close()
  await Promise.all([rpc.stop(), providerLogin.stop(), ...(activeBoardRun ? [finishBoardRun(activeBoardRun)] : []), ...(enabledFeatures.has('workers') ? [workers.shutdown()] : []), ...(enabledFeatures.has('cron') ? [cron.shutdown()] : [])])
  await activity.flush()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

server.requestTimeout = 120_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
previewServer.requestTimeout = 120_000
previewServer.headersTimeout = 10_000
previewServer.keepAliveTimeout = 5_000

previewServer.listen(previewPort, host, () => console.log(`Pi Dashboard preview listener on http://${host}:${previewPort}`))
server.listen(port, host, () => {
  console.log(`Pi Dashboard backend listening on http://${host}:${port}`)
  record({ category: 'system', type: 'server_start', severity: 'info', summary: 'Dashboard backend started' })
  void rpc.start().then(() => state()).catch((error: Error) => {
    record({ category: 'error', type: 'rpc_start_failed', severity: 'error', summary: error.message })
    console.error(`Unable to start Pi RPC: ${error.message}`)
  })
})
