import './load-env.js'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import { ActivityStore, type ActivityCategory, type ActivitySeverity } from './activity-store.js'
import { DashboardAuth } from './auth.js'
import { terminalCapabilityStatus, workersCapabilityStatus } from './capability-status.js'
import { FileAccessError, FileService } from './file-service.js'
import { GitService } from './git-service.js'
import { OnboardingError, OnboardingService } from './onboarding-service.js'
import { PiRpcProcess } from './pi-rpc.js'
import { GeminiAgentProcess, type GeminiWorkerDelegateInput, type GeminiWorkerDelegateResult } from './gemini-agent.js'
import { pluginAssetContentSecurityPolicy } from './plugin-asset-policy.js'
import { PluginHostError } from './plugin-host.js'
import { PluginError, PluginService } from './plugin-service.js'
import { NativeTerminalSession } from './terminal-session.js'
import { ProviderLoginSession } from './provider-login-session.js'
import { safePreviewHeaders } from './preview-policy.js'
import { dashboardProfile, type DashboardFeature, ALWAYS_ENABLED_FEATURES, OPTIONAL_FEATURES, STACK_PRESETS, DASHBOARD_FEATURES, type DashboardStackPreset } from './profile.js'
import { SessionArchiveService } from './session-archive.js'
import { SessionCatalog } from './session-catalog.js'
import { SkillError, SkillService } from './skill-service.js'
import { SystemError, SystemService, THINKING_LEVELS } from './system-service.js'
import { ToolService } from './tool-service.js'
import { SubPiWorkerAdapter } from './sub-pi-worker.js'
import { AntigravityWorkerAdapter } from './antigravity-worker.js'
import { CodexWorkerAdapter } from './codex-worker.js'
import { ClaudeWorkerAdapter } from './claude-worker.js'
import { GeminiWorkerAdapter } from './gemini-worker.js'
import { WorkerRulesService } from './worker-rules.js'
import { WorkerConsoleSession } from './worker-console-session.js'
import { WorkerCoordinator, WorkerError } from './worker-coordinator.js'
import { ProjectService } from './project-service.js'
import { ShortcutService } from './shortcut-service.js'
import { RemoteAccessService } from './remote-access-service.js'
import type { BrowserCommand, RpcEvent, ServerMessage } from './types.js'

const port = Number(process.env.PORT ?? 4317)
const host = process.env.HOST ?? '0.0.0.0'
const moduleDir = dirname(fileURLToPath(import.meta.url))
const staticUiDir = process.env.FOCI_STATIC_UI_DIR
  ?? [resolve(moduleDir, '../../ui/dist'), resolve(moduleDir, '../../../../ui/dist')].find((candidate) => existsSync(candidate))
  ?? resolve(moduleDir, '../../ui/dist')
const defaultHomeAgentDir = resolve(homedir(), '.pi/agent')
const defaultDashboardDataDir = resolve(homedir(), '.pi-dashboard')
try { mkdirSync(defaultDashboardDataDir, { recursive: true }) } catch {}

const defaultProjectsRoot = resolve(homedir(), 'Pi-Dashboards')
const defaultWorkspace = resolve(defaultProjectsRoot, 'Default')
let workspace = resolve(process.env.PI_DASHBOARD_WORKSPACE ?? defaultWorkspace)
let workspaceKey = createHash('sha256').update(workspace.toLowerCase()).digest('hex').slice(0, 12)
let projectSlug = basename(workspace).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'default'
let projectDataDir = resolve(defaultDashboardDataDir, 'projects', `${projectSlug}-${workspaceKey}`)

// Ensure project directories exist
try {
  mkdirSync(projectDataDir, { recursive: true })
  mkdirSync(resolve(projectDataDir, 'sessions'), { recursive: true })
  mkdirSync(resolve(projectDataDir, 'plugin-data'), { recursive: true })
} catch {}

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
const agentDir = process.env.PI_AGENT_DIR ?? defaultHomeAgentDir
let rpcSessionDir = process.env.PI_RPC_SESSION_DIR ?? resolve(projectDataDir, 'sessions')
let sessionRoot = process.env.PI_SESSION_ROOT ?? rpcSessionDir
let activityPath = process.env.PI_DASHBOARD_ACTIVITY_PATH ?? resolve(projectDataDir, 'activity.jsonl')
let sessionArchivePath = process.env.PI_DASHBOARD_SESSION_ARCHIVE_PATH ?? resolve(projectDataDir, 'sessions-archive.json')
let runtimeInfoPath = process.env.PI_DASHBOARD_RUNTIME_INFO_PATH ?? resolve(projectDataDir, 'runtime-tools.json')
const runtimeInfoExtension = process.env.PI_DASHBOARD_RUNTIME_INFO_EXTENSION ?? resolve(process.cwd(), 'extensions/dashboard-runtime-info.ts')
const curatedMemoryExtension = process.env.PI_DASHBOARD_CURATED_MEMORY_EXTENSION ?? resolve(process.cwd(), 'extensions/curated-memory.ts')
const memoryCheckpointExtension = process.env.PI_DASHBOARD_MEMORY_CHECKPOINT_EXTENSION ?? resolve(process.cwd(), 'extensions/memory-checkpoint.ts')
const pluginToolsExtension = process.env.PI_DASHBOARD_PLUGIN_TOOLS_EXTENSION ?? resolve(process.cwd(), 'extensions/dashboard-plugin-tools.ts')
const workersExtension = process.env.PI_DASHBOARD_WORKERS_EXTENSION ?? resolve(process.cwd(), 'extensions/dashboard-workers.ts')
const dashboardPluginAuthoringSkill = process.env.PI_DASHBOARD_PLUGIN_AUTHORING_SKILL_PATH ?? resolve(process.cwd(), 'skills/dashboard-plugin-authoring')
const dashboardReferenceSkill = process.env.PI_DASHBOARD_REFERENCE_SKILL_PATH ?? resolve(process.cwd(), 'skills/dashboard-reference')
const antigravityHome = process.env.PI_DASHBOARD_ANTIGRAVITY_HOME ?? process.env.ANTIGRAVITY_HOME
const repoPluginDir = resolve(import.meta.dirname ?? process.cwd(), '../../plugins')
const pluginCodeRoot = process.env.PI_DASHBOARD_PLUGIN_CODE_ROOT ?? (existsSync(repoPluginDir) ? repoPluginDir : resolve(process.cwd(), 'plugins'))
let pluginStateRoot = process.env.PI_DASHBOARD_PLUGIN_STATE_ROOT ?? resolve(projectDataDir, 'plugin-data')
let pluginRuntimeSocketRoot = process.env.PI_DASHBOARD_PLUGIN_RUNTIME_SOCKET_ROOT ?? resolve(tmpdir(), `pi-plugins-${workspaceKey}`)
const defaultCustomPluginRoot = resolve(defaultDashboardDataDir, 'plugins')
try { mkdirSync(defaultCustomPluginRoot, { recursive: true }) } catch {}
const pluginLocalRepositoryRoot = process.env.PI_DASHBOARD_PLUGIN_LOCAL_REPOSITORY_ROOT ?? defaultCustomPluginRoot
const terminalSocketPath = process.env.PI_DASHBOARD_TERMINAL_SOCKET ?? resolve(tmpdir(), `pi-terminal-${workspaceKey}/terminal.sock`)
let workerStorePath = process.env.PI_DASHBOARD_WORKER_STORE_PATH ?? resolve(projectDataDir, 'worker-tasks.json')
let workerArchivePath = process.env.PI_DASHBOARD_WORKER_ARCHIVE_PATH ?? resolve(projectDataDir, 'worker-tasks-archive.json')
const remoteAccess = new RemoteAccessService()
const allowedOrigins = new Set(
  (process.env.PI_DASHBOARD_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5190,http://127.0.0.1:5190,http://localhost:5184,http://127.0.0.1:5184')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
if (remoteAccess.getAllowedOrigin()) {
  allowedOrigins.add(remoteAccess.getAllowedOrigin()!)
}
const originsLimitedToLocalhost = [...allowedOrigins].every((origin) => {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(origin).hostname) } catch { return false }
})

const auth = new DashboardAuth(remoteAccess.getToken())
const pluginAssetCapability = randomBytes(32).toString('base64url')
const workerInternalToken = randomBytes(32).toString('base64url')
const profile = dashboardProfile()
const enabledFeatures = new Set<DashboardFeature>(profile.features)
let rpcArgs = ['--mode', 'rpc', '--continue', '--name', 'Pi Dashboard', '--extension', runtimeInfoExtension, '--extension', curatedMemoryExtension, '--extension', memoryCheckpointExtension, '--extension', pluginToolsExtension, ...(enabledFeatures.has('workers') ? ['--extension', workersExtension] : []), ...(rpcSessionDir ? ['--session-dir', rpcSessionDir] : [])]
const useGeminiAgent = (process.env.FOCI_AGENT_PROVIDER ?? process.env.PI_DASHBOARD_AGENT_PROVIDER ?? '').toLowerCase() === 'gemini'
let rpc = registerRpcListeners(useGeminiAgent
  ? new GeminiAgentProcess({ cwd: workspace, sessionDir: rpcSessionDir, workerDelegate: delegateWorker })
  : new PiRpcProcess({
    cwd: workspace,
    args: rpcArgs,
    env: {
      PI_DASHBOARD_WORKER_INTERNAL_TOKEN: workerInternalToken,
      PI_DASHBOARD_PLUGIN_STATE_ROOT: pluginStateRoot,
      PI_DASHBOARD_PLUGIN_CODE_ROOT: pluginCodeRoot,
      PI_DASHBOARD_PLUGIN_AUTHORING_SKILL_PATH: dashboardPluginAuthoringSkill,
      PI_DASHBOARD_REFERENCE_SKILL_PATH: dashboardReferenceSkill,
    },
  }))
let sessions = new SessionCatalog(sessionRoot, workspace)
let sessionArchive = new SessionArchiveService(sessionArchivePath)
let files = new FileService(workspace)
let git = new GitService(workspace)
let skills = new SkillService(workspace, agentDir)
let system = new SystemService(workspace, agentDir)
let onboarding = new OnboardingService(workspace, agentDir, defaultDashboardDataDir)
const projectService = new ProjectService()
const tools = new ToolService(runtimeInfoPath)
let plugins = new PluginService({ bundledRoot: pluginCodeRoot, stateRoot: pluginStateRoot, workspaceRoot: workspace, runtimeSocketRoot: pluginRuntimeSocketRoot, assetCapability: pluginAssetCapability, localRepositoryRoot: pluginLocalRepositoryRoot })
let activity = new ActivityStore(activityPath)
const providerLogin = new ProviderLoginSession()
const workerConsoleSession = new WorkerConsoleSession()
const workerRules = new WorkerRulesService()
const workerBounds = {
  turnLimit: positiveLimit(process.env.PI_DASHBOARD_WORKER_TURN_LIMIT, 8, 1),
  timeoutMs: positiveLimit(process.env.PI_DASHBOARD_WORKER_TIMEOUT_MS, 10 * 60_000, 60_000),
  resultLimitBytes: positiveLimit(process.env.PI_DASHBOARD_WORKER_RESULT_LIMIT_BYTES, 12 * 1024, 1024),
}
let subPi = new SubPiWorkerAdapter({
  workspace,
  sessionDir: rpcSessionDir,
  pluginToolsExtension,
  pluginStateRoot,
  pluginCodeRoot,
  authoringSkillPath: dashboardPluginAuthoringSkill,
  referenceSkillPath: dashboardReferenceSkill,
  git,
  enabled: enabledFeatures.has('workers'),
})
let antigravityWorker = new AntigravityWorkerAdapter({
  workspace,
  git,
  enabled: enabledFeatures.has('workers'),
  antigravityHome,
})
let codexWorker = new CodexWorkerAdapter({
  workspace,
  git,
  enabled: enabledFeatures.has('workers'),
})
let claudeWorker = new ClaudeWorkerAdapter({
  workspace,
  git,
  enabled: enabledFeatures.has('workers'),
})
let geminiWorker = new GeminiWorkerAdapter({
  workspace,
  enabled: enabledFeatures.has('workers'),
})
let workers = new WorkerCoordinator({
  storePath: workerStorePath,
  archivePath: workerArchivePath,
  adapters: [geminiWorker, subPi, antigravityWorker, codexWorker, claudeWorker],
  rulesService: workerRules,
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
  ...(enabledFeatures.has('workers') ? [workers.initialize()] : []),
])

const clients = new Set<WebSocket>()
const toolStartTimes = new Map<string, number>()
let currentSessionId: string | undefined
let currentSessionFile: string | undefined
let currentRunId: string | undefined
let managementChain = Promise.resolve()
function positiveLimit(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}

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

async function delegateWorker(input: GeminiWorkerDelegateInput): Promise<GeminiWorkerDelegateResult> {
  const started = await workers.start(input)
  const deadline = Date.now() + started.bounds.timeoutMs + 10_000
  let task = started
  while ((task.status === 'queued' || task.status === 'running') && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    task = workers.get(started.id) ?? task
  }
  return task
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

async function switchActiveWorkspace(targetWorkspace: string): Promise<{ workspace: string; projectSlug: string }> {
  targetWorkspace = resolve(targetWorkspace)
  if (!existsSync(targetWorkspace)) {
    throw new Error(`Workspace path does not exist: ${targetWorkspace}`)
  }

  // Auto-initialize MEMORY.md if missing
  const memoryFile = resolve(targetWorkspace, 'MEMORY.md')
  if (!existsSync(memoryFile)) {
    const templatePath = resolve(import.meta.dirname ?? process.cwd(), '../templates/MEMORY.md')
    const template = existsSync(templatePath)
      ? readFileSync(templatePath, 'utf8')
      : '# Project Memory\n\nThis file is the local memory bank for this project workspace.\n'
    writeFileSync(memoryFile, template, 'utf8')
  }

  await ensureIdle()
  await rpc.stop()

  workspace = targetWorkspace
  workspaceKey = createHash('sha256').update(workspace.toLowerCase()).digest('hex').slice(0, 12)
  projectSlug = basename(workspace).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'workspace'
  projectDataDir = resolve(defaultDashboardDataDir, 'projects', `${projectSlug}-${workspaceKey}`)

  try {
    mkdirSync(projectDataDir, { recursive: true })
    mkdirSync(resolve(projectDataDir, 'sessions'), { recursive: true })
    mkdirSync(resolve(projectDataDir, 'plugin-data'), { recursive: true })
  } catch {}

  const currentRpcSessionDir = resolve(projectDataDir, 'sessions')
  rpcSessionDir = currentRpcSessionDir
  sessionRoot = currentRpcSessionDir
  activityPath = resolve(projectDataDir, 'activity.jsonl')
  sessionArchivePath = resolve(projectDataDir, 'sessions-archive.json')
  pluginStateRoot = resolve(projectDataDir, 'plugin-data')
  workerStorePath = resolve(projectDataDir, 'worker-tasks.json')
  workerArchivePath = resolve(projectDataDir, 'worker-tasks-archive.json')
  pluginRuntimeSocketRoot = resolve(tmpdir(), `pi-plugins-${workspaceKey}`)

  sessions = new SessionCatalog(sessionRoot, workspace)
  sessionArchive = new SessionArchiveService(sessionArchivePath)
  files = new FileService(workspace)
  git = new GitService(workspace)
  skills = new SkillService(workspace, agentDir)
  system = new SystemService(workspace, agentDir)
  onboarding = new OnboardingService(workspace, agentDir, defaultDashboardDataDir)
  plugins = new PluginService({ bundledRoot: pluginCodeRoot, stateRoot: pluginStateRoot, workspaceRoot: workspace, runtimeSocketRoot: pluginRuntimeSocketRoot, assetCapability: pluginAssetCapability, localRepositoryRoot: pluginLocalRepositoryRoot })
  activity = new ActivityStore(activityPath)
  subPi = new SubPiWorkerAdapter({
    workspace,
    sessionDir: currentRpcSessionDir,
    pluginToolsExtension,
    pluginStateRoot,
    pluginCodeRoot,
    authoringSkillPath: dashboardPluginAuthoringSkill,
    referenceSkillPath: dashboardReferenceSkill,
    git,
    enabled: enabledFeatures.has('workers'),
  })
  antigravityWorker = new AntigravityWorkerAdapter({
    workspace,
    git,
    enabled: enabledFeatures.has('workers'),
    antigravityHome,
  })
  codexWorker = new CodexWorkerAdapter({
    workspace,
    git,
    enabled: enabledFeatures.has('workers'),
  })
  claudeWorker = new ClaudeWorkerAdapter({
    workspace,
    git,
    enabled: enabledFeatures.has('workers'),
  })
  geminiWorker = new GeminiWorkerAdapter({
    workspace,
    enabled: enabledFeatures.has('workers'),
  })
  workers = new WorkerCoordinator({
    storePath: workerStorePath,
    archivePath: workerArchivePath,
    adapters: [geminiWorker, subPi, antigravityWorker, codexWorker, claudeWorker],
    rulesService: workerRules,
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

  rpcArgs = ['--mode', 'rpc', '--continue', '--name', 'Pi Dashboard', '--extension', runtimeInfoExtension, '--extension', curatedMemoryExtension, '--extension', memoryCheckpointExtension, '--extension', pluginToolsExtension, ...(enabledFeatures.has('workers') ? ['--extension', workersExtension] : []), '--session-dir', currentRpcSessionDir]
  rpc = registerRpcListeners(useGeminiAgent
    ? new GeminiAgentProcess({ cwd: workspace, sessionDir: rpcSessionDir, workerDelegate: delegateWorker })
    : new PiRpcProcess({
      cwd: workspace,
      args: rpcArgs,
      env: {
        PI_DASHBOARD_WORKER_INTERNAL_TOKEN: workerInternalToken,
        PI_DASHBOARD_PLUGIN_STATE_ROOT: pluginStateRoot,
        PI_DASHBOARD_PLUGIN_CODE_ROOT: pluginCodeRoot,
        PI_DASHBOARD_PLUGIN_AUTHORING_SKILL_PATH: dashboardPluginAuthoringSkill,
        PI_DASHBOARD_REFERENCE_SKILL_PATH: dashboardReferenceSkill,
      },
    }))

  await Promise.all([
    activity.initialize(),
    sessionArchive.initialize(),
    system.initialize(),
    ...(enabledFeatures.has('plugins') ? [plugins.initialize()] : []),
    ...(enabledFeatures.has('workers') ? [workers.initialize()] : []),
  ])

  await rpc.start()
  await sendSnapshot()
  broadcast({ type: 'workspace_changed' })
  broadcast({ type: 'sessions_changed' })
  broadcast({ type: 'skills_changed' })
  record({ category: 'system', type: 'workspace_switched', severity: 'info', summary: `Switched active workspace to "${projectSlug}"` })

  return { workspace, projectSlug }
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
      sessionRoot, activityPath,
      sessions: sessionList.length,
    },
    recentErrors: activity.query({ category: 'error', limit: 5 }),
    security: {
      authenticationEnabled: auth.enabled,
      frontendExpectedOnLocalhost: originsLimitedToLocalhost,
      backendNetworkScope: 'Bound strictly to 127.0.0.1 (Localhost)',
      processIsolation: 'Electron local-process isolation',
      workspaceIsolationEnforced: true,
      allowedOrigins: [...allowedOrigins],
      remoteAccess: remoteAccess.get(),
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

type DashboardRpcProcess = PiRpcProcess | GeminiAgentProcess

function registerRpcListeners(instance: DashboardRpcProcess): DashboardRpcProcess {
  instance.on('event', (event: RpcEvent) => {
    broadcast({ type: 'event', event })

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

  instance.on('ready', () => {
    record({ category: 'system', type: 'rpc_ready', severity: 'info', summary: 'Pi RPC started' })
    broadcast({ type: 'connection', status: 'connected' })
  })
  instance.on('exit', (error: Error) => {
    record({ category: 'error', type: 'rpc_exit', severity: 'error', summary: error.message, sessionId: currentSessionId })
    broadcast({ type: 'connection', status: 'error', message: error.message })
  })
  instance.on('protocolError', (error: Error) => {
    record({ category: 'error', type: 'rpc_protocol_error', severity: 'error', summary: error.message, sessionId: currentSessionId })
    broadcast({ type: 'error', message: error.message })
  })

  return instance
}

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
        providerId: typeof body.providerId === 'string' ? body.providerId : 'sub-pi',
        mode: typeof body.mode === 'string' ? body.mode : undefined,
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        bounds: body.bounds && typeof body.bounds === 'object' ? body.bounds as any : undefined,
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
    plugins.runtime(pluginId)
    const runtimePath = `/${pluginRuntimeMatch[2] ?? ''}`
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
  const sessionRenameMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/rename$/)
  if (request.method === 'POST' && sessionRenameMatch) {
    const id = decodeURIComponent(sessionRenameMatch[1])
    const body = (await readJsonBody(request)) as { name?: string }
    const name = String(body.name ?? '').trim()
    if (!name || name.length > 100) throw new SystemError('Session name must contain between 1 and 100 characters', 400)
    if (!await sessions.pathFor(id)) throw new SystemError('Session not found', 404)
    if (id === currentSessionId) {
      await rpc.request({ type: 'set_session_name', name })
    } else {
      await sessions.renameInactive(id, name)
    }
    await sendSnapshot()
    record({ category: 'session', type: 'session_rename', severity: 'info', summary: `Renamed session to "${name}"`, sessionId: id })
    broadcast({ type: 'sessions_changed' })
    json(response, 200, { ok: true, id, name })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/workers/tasks') {
    const body = await readJsonBody(request)
    const task = await workers.start({
      providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      bounds: body.bounds && typeof body.bounds === 'object' ? body.bounds as any : undefined,
      model: body.model && typeof body.model === 'object' && typeof (body.model as any).provider === 'string' && typeof (body.model as any).id === 'string'
        ? { provider: String((body.model as any).provider), id: String((body.model as any).id) }
        : undefined,
      thinkingLevel: typeof body.thinkingLevel === 'string' ? body.thinkingLevel : undefined,
    })
    record({ category: 'system', type: 'worker_task_started', severity: 'info', summary: `Started ${task.mode} task with ${task.providerName}`, sessionId: currentSessionId, data: { taskId: task.id, providerId: task.providerId, mode: task.mode } })
    json(response, 202, task)
    return
  }
  if (request.method === 'GET' && url.pathname === '/api/system/features') {
    const config = await workerRules.loadConfig()
    json(response, 200, {
      stackPreset: config.stackPreset ?? 'developer',
      enabledFeatures: Array.from(enabledFeatures),
      allFeatures: DASHBOARD_FEATURES,
      alwaysEnabledFeatures: ALWAYS_ENABLED_FEATURES,
      optionalFeatures: OPTIONAL_FEATURES,
      stackPresets: STACK_PRESETS,
      providersEnabled: config.providersEnabled,
      showRulesEditor: config.showRulesEditor ?? true,
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/system/features') {
    const body = (await readJsonBody(request)) as {
      stackPreset?: DashboardStackPreset
      features?: DashboardFeature[]
      providersEnabled?: Record<string, boolean>
      showRulesEditor?: boolean
    }
    const nextFeatures = new Set<DashboardFeature>(ALWAYS_ENABLED_FEATURES)
    if (Array.isArray(body.features)) {
      for (const f of body.features) {
        if ((DASHBOARD_FEATURES as readonly string[]).includes(f)) nextFeatures.add(f as DashboardFeature)
      }
    }
    enabledFeatures.clear()
    for (const f of nextFeatures) enabledFeatures.add(f)
    profile.features = Array.from(enabledFeatures)

    const updatedConfig = await workerRules.updateConfig({
      stackPreset: body.stackPreset,
      enabledFeatures: Array.from(enabledFeatures),
      providersEnabled: body.providersEnabled,
      showRulesEditor: body.showRulesEditor,
    })

    record({
      category: 'system',
      type: 'system_features_updated',
      severity: 'info',
      summary: `Updated dashboard stack to ${body.stackPreset ?? 'custom'} (${profile.features.length} features active)`,
      sessionId: currentSessionId,
    })
    broadcast({ type: 'workspace_changed' })
    json(response, 200, {
      stackPreset: updatedConfig.stackPreset,
      enabledFeatures: Array.from(enabledFeatures),
      providersEnabled: updatedConfig.providersEnabled,
      showRulesEditor: updatedConfig.showRulesEditor,
    })
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/workers/config') {
    const body = await readJsonBody(request)
    await workerRules.updateConfig(body)
    record({ category: 'system', type: 'worker_config_updated', severity: 'info', summary: 'Updated global worker configuration', sessionId: currentSessionId })
    json(response, 200, await workers.snapshot())
    return
  }
  const workerRulePostMatch = url.pathname.match(/^\/api\/workers\/rules\/([^/]+)$/)
  if (request.method === 'POST' && workerRulePostMatch) {
    const ruleId = decodeURIComponent(workerRulePostMatch[1])
    const body = await readJsonBody(request)
    const saved = await workerRules.saveRule(ruleId, String(body.content ?? ''))
    record({ category: 'system', type: 'worker_rule_saved', severity: 'info', summary: `Updated worker rule "${saved.title}"`, sessionId: currentSessionId })
    json(response, 200, saved)
    return
  }
  const workerCancelMatch = url.pathname.match(/^\/api\/workers\/tasks\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && workerCancelMatch) {
    const task = await workers.cancel(decodeURIComponent(workerCancelMatch[1]))
    record({ category: 'system', type: 'worker_task_cancelled', severity: 'warning', summary: `Cancelled ${task.providerName} task`, sessionId: task.sessionId, data: { taskId: task.id } })
    json(response, 200, task)
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/workers/archive') {
    const body = (await readJsonBody(request)) as { taskId?: string; allCompleted?: boolean }
    if (body.allCompleted) {
      const count = await workers.archiveAllCompleted()
      record({ category: 'system', type: 'worker_tasks_archived', severity: 'info', summary: `Archived ${count} completed worker tasks`, sessionId: currentSessionId })
    } else if (body.taskId) {
      await workers.archiveTask(body.taskId)
      record({ category: 'system', type: 'worker_task_archived', severity: 'info', summary: `Archived worker task`, sessionId: currentSessionId, data: { taskId: body.taskId } })
    }
    json(response, 200, await workers.snapshot())
    return
  }
  if (request.method === 'POST' && url.pathname === '/api/workers/archive/restore') {
    const body = (await readJsonBody(request)) as { taskId?: string }
    if (body.taskId) {
      await workers.restoreTask(body.taskId)
      record({ category: 'system', type: 'worker_task_restored', severity: 'info', summary: `Restored worker task from archive`, sessionId: currentSessionId, data: { taskId: body.taskId } })
    }
    json(response, 200, await workers.snapshot())
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/projects/create') {
    const body = await readJsonBody(request)
    const name = typeof body.name === 'string' ? body.name : ''
    const template = typeof body.template === 'string' ? body.template : 'standard'
    try {
      const created = projectService.create(name, template)
      record({ category: 'system', type: 'project_created', severity: 'info', summary: `Created new project "${created.name}"`, data: { path: created.path } })
      json(response, 201, created)
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : 'Unable to create project' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/projects/switch') {
    const body = await readJsonBody(request)
    const targetPath = typeof body.projectPath === 'string' ? body.projectPath : ''
    try {
      const switched = await switchActiveWorkspace(targetPath)
      json(response, 200, switched)
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : 'Unable to switch workspace' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/projects/open-window') {
    const body = await readJsonBody(request)
    const targetPath = typeof body.projectPath === 'string' ? resolve(body.projectPath) : ''
    if (!targetPath || !existsSync(targetPath)) {
      json(response, 400, { error: 'Invalid project path' })
      return
    }
    const isWindows = process.platform === 'win32'
    const npxCmd = isWindows ? 'npx.cmd' : 'npx'
    const repoRoot = resolve(import.meta.dirname ?? process.cwd(), '../../')

    const child = spawn(npxCmd, ['electron', 'electron/main.cjs'], {
      detached: true,
      stdio: 'ignore',
      cwd: repoRoot,
      windowsHide: true,
      env: {
        ...process.env,
        PI_DASHBOARD_WORKSPACE: targetPath,
      },
      shell: isWindows,
    })
    child.unref()
    json(response, 200, { success: true, message: 'Launching new project window...' })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/system/create-shortcut') {
    const result = await ShortcutService.createDesktopShortcut()
    record({ category: 'system', type: 'shortcut_created', severity: result.success ? 'info' : 'warning', summary: result.message })
    json(response, result.success ? 200 : 500, result)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/system/remote-access') {
    const body = await readJsonBody(request)
    const updated = remoteAccess.update({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      tailnetHost: typeof body.tailnetHost === 'string' ? body.tailnetHost : undefined,
      httpsPort: typeof body.httpsPort === 'number' ? body.httpsPort : undefined,
      password: typeof body.password === 'string' ? body.password : undefined,
    })
    if (remoteAccess.getToken()) {
      auth.setToken(remoteAccess.getToken())
    } else {
      auth.setToken(undefined)
    }
    if (remoteAccess.getAllowedOrigin()) {
      allowedOrigins.add(remoteAccess.getAllowedOrigin()!)
    }
    record({ category: 'system', type: 'remote_access_updated', severity: 'info', summary: `Remote access configuration updated (Auth: ${auth.enabled ? 'Enabled' : 'Disabled'})` })
    json(response, 200, updated)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/memory/tier') {
    const body = await readJsonBody(request)
    const type = typeof body.type === 'string' ? body.type : 'project'
    const content = typeof body.content === 'string' ? body.content : ''

    let targetPath = resolve(workspace, 'MEMORY.md')
    let label = 'Project Memory'
    if (type === 'user') {
      targetPath = resolve(agentDir, 'USER.md')
      label = 'User Profile'
    } else if (type === 'global') {
      targetPath = resolve(agentDir, 'MEMORY.md')
      label = 'Global Memory'
    }

    try {
      mkdirSync(dirname(targetPath), { recursive: true })
      writeFileSync(targetPath, content, 'utf8')
      record({ category: 'system', type: 'memory_saved', severity: 'info', summary: `Saved ${label} (${targetPath})` })
      json(response, 200, { success: true, type, path: targetPath })
    } catch (err: any) {
      json(response, 500, { error: `Failed to save ${label}: ${err?.message || 'Unknown error'}` })
    }
    return
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    json(response, 405, { error: 'Method not allowed' })
    return
  }
  if (url.pathname === '/api/memory/tier') {
    const type = url.searchParams.get('type') || 'project'
    let targetPath = resolve(workspace, 'MEMORY.md')
    let title = 'Project Memory (MEMORY.md)'
    let badge = '📁 Project Blueprint — Technical State'
    let description = 'Living technical blueprint for this workspace. Actively updated and pruned by the AI at checkpoints.'
    let rule = 'Pruned and updated during session checkpoints.'

    if (type === 'user') {
      targetPath = resolve(agentDir, 'USER.md')
      title = 'User Profile (USER.md)'
      badge = '👤 User Profile — Facts & Identity'
      description = 'Facts about your identity, background, skills, and goals.'
      rule = '🔒 Protected: AI MUST ask your permission before modifying.'
    } else if (type === 'global') {
      targetPath = resolve(agentDir, 'MEMORY.md')
      title = 'Global Memory (MEMORY.md)'
      badge = '🌐 Global Collaboration — Habits & Rules'
      description = 'Cross-project communication preferences, interaction habits, and universal rules.'
      rule = 'Collaborative: Refined during session checkpoints.'
    }

    let content = ''
    let exists = false
    try {
      if (existsSync(targetPath)) {
        content = readFileSync(targetPath, 'utf8')
        exists = true
      }
    } catch {}

    json(response, 200, {
      type,
      path: targetPath,
      content,
      exists,
      title,
      badge,
      description,
      rule,
    })
    return
  }
  if (url.pathname === '/api/system/remote-access') {
    json(response, 200, remoteAccess.get())
    return
  }
  if (url.pathname === '/api/projects') {
    json(response, 200, {
      rootDir: projectService.rootDir,
      activeWorkspace: workspace,
      activeProjectSlug: projectSlug,
      projects: projectService.list(),
    })
    return
  }
  if (url.pathname === '/api/onboarding') {
    json(response, 200, await onboarding.get())
    return
  }
  if (url.pathname === '/api/config') {
    json(response, 200, {
      profile: profile.name,
      features: profile.features,
      project: { name: projectSlug, path: workspace },
      ...(enabledFeatures.has('plugins') ? { pluginSources: pluginLocalRepositoryRoot ? ['github', 'workspace', 'local-preview'] : ['github', 'workspace'] } : {}),
    })
    return
  }
  if (url.pathname === '/api/workers') {
    json(response, 200, await workers.snapshot())
    return
  }
  if (url.pathname === '/api/workers/archive') {
    json(response, 200, {
      tasks: workers.getArchivedTasks(),
      archivedCount: workers.archivedCount,
      archivePath: workers.archivePath,
    })
    return
  }
  if (url.pathname === '/api/workers/rules') {
    json(response, 200, { rules: await workerRules.listRules() })
    return
  }
  const workerRuleGetMatch = url.pathname.match(/^\/api\/workers\/rules\/([^/]+)$/)
  if (workerRuleGetMatch) {
    const ruleId = decodeURIComponent(workerRuleGetMatch[1])
    const rule = await workerRules.getRule(ruleId)
    json(response, rule ? 200 : 404, rule ?? { error: 'Worker rule not found' })
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
  const workspacePreviewMatch = url.pathname.match(/^\/api\/preview\/workspace\/(.+)$/)
  if (workspacePreviewMatch) {
    const rawRel = decodeURIComponent(workspacePreviewMatch[1])
    try {
      const safeRel = files.validateRelative(rawRel)
      const fullPath = join(workspace, safeRel)
      const fileBuffer = await readFile(fullPath)
      const ext = extname(safeRel).toLowerCase()
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
        '.txt': 'text/plain; charset=utf-8',
        '.md': 'text/plain; charset=utf-8',
      }
      const contentType = mimeMap[ext] || 'application/octet-stream'
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
        'Cache-Control': 'no-cache',
      })
      response.end(fileBuffer)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;background:#0d1117;color:#c9d1d9"><h2>File not found: ${rawRel}</h2><p>Make sure the file exists inside your project workspace.</p></body></html>`)
    }
    return
  }

  if (url.pathname === '/api/preview/html-files') {
    const searchRes = await files.search('.html')
    const htmlFiles = searchRes
      .filter((item) => item.path.toLowerCase().endsWith('.html') || item.path.toLowerCase().endsWith('.htm'))
      .map((item) => item.path)
    json(response, 200, { files: htmlFiles })
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
    const catalogCurrentSessionId = currentSessionId && sessionList.some((session) => session.id === currentSessionId)
      ? currentSessionId
      : undefined
    await sessionArchive.archiveInactive(sessionList, catalogCurrentSessionId)
    json(response, 200, {
      sessions: sessionList.map((session) => ({ ...session, archived: sessionArchive.isArchived(session.id) })),
      ...(catalogCurrentSessionId ? { currentSessionId: catalogCurrentSessionId } : {}),
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
  const requestMethod = String(request.method ?? 'GET')
  if (requestMethod === 'GET' || requestMethod === 'HEAD') {
    const served = await tryServeStaticUi(url.pathname, response, requestMethod === 'HEAD')
    if (served) return
  }

  json(response, 404, { error: 'Not found' })
}

async function tryServeStaticUi(pathname: string, response: ServerResponse, headOnly: boolean): Promise<boolean> {
  if (!existsSync(staticUiDir)) return false
  const decodedPath = decodeURIComponent(pathname)
  const requested = decodedPath === '/' ? '/index.html' : decodedPath
  let targetPath = resolve(staticUiDir, `.${requested}`)
  if (!targetPath.startsWith(staticUiDir)) return false
  try {
    const info = await stat(targetPath)
    if (info.isDirectory()) targetPath = resolve(targetPath, 'index.html')
  } catch {
    targetPath = resolve(staticUiDir, 'index.html')
  }
  const extension = extname(targetPath).toLowerCase()
  const contentType = extension === '.html' ? 'text/html; charset=utf-8'
    : extension === '.js' ? 'text/javascript; charset=utf-8'
      : extension === '.css' ? 'text/css; charset=utf-8'
        : extension === '.svg' ? 'image/svg+xml'
          : extension === '.json' ? 'application/json; charset=utf-8'
            : 'application/octet-stream'
  const body = await readFile(targetPath)
  response.writeHead(200, { 'content-type': contentType, 'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' })
  if (!headOnly) response.end(body)
  else response.end()
  return true
}

const server = createServer((request, response) => {
  void handleHttp(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : 'Request failed'
    const status = error instanceof FileAccessError || error instanceof SkillError || error instanceof SystemError || error instanceof PluginError || error instanceof PluginHostError || error instanceof OnboardingError || error instanceof WorkerError ? error.status : 500
    if (status >= 500) record({ category: 'error', type: 'http_error', severity: 'error', summary: message, sessionId: currentSessionId })
    if (!response.headersSent) json(response, status, { error: message })
    else response.end()
  })
})

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
const terminalWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
const providerLoginWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
const workerConsoleWebSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const workerConsoleMatch = path.match(/^\/ws\/workers\/([^/]+)\/(login|manage)$/)
  const allowedPath = path === '/ws' || path === '/ws/provider-login' || (path === '/ws/terminal' && enabledFeatures.has('terminal')) || (Boolean(workerConsoleMatch) && enabledFeatures.has('workers'))
  if (!allowedPath || !auth.originAllowed(request, allowedOrigins) || (auth.enabled && !auth.authenticate(request))) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  const target = Boolean(workerConsoleMatch)
    ? workerConsoleWebSocketServer
    : path === '/ws/terminal'
      ? terminalWebSocketServer
      : path === '/ws/provider-login'
        ? providerLoginWebSocketServer
        : webSocketServer
  target.handleUpgrade(request, socket, head, (client) => target.emit('connection', client, request))
})

workerConsoleWebSocketServer.on('connection', (browser, request: IncomingMessage) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const match = url.pathname.match(/^\/ws\/workers\/([^/]+)\/(login|manage)$/)
  if (!match) {
    browser.close(1008, 'Invalid worker console path')
    return
  }
  const providerId = decodeURIComponent(match[1])
  const mode = match[2] as 'login' | 'manage'
  record({ category: 'system', type: 'worker_console_opened', severity: 'info', summary: `Opened ${providerId} console (${mode})` })
  workerConsoleSession.attach(browser, providerId, mode, workspace)
})

providerLoginWebSocketServer.on('connection', (browser) => {
  record({ category: 'system', type: 'provider_login_opened', severity: 'info', summary: 'Opened the embedded Pi provider login console' })
  providerLogin.attach(browser)
})

terminalWebSocketServer.on('connection', (browser, request: IncomingMessage) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const shell = url.searchParams.get('shell') ?? undefined
  record({ category: 'system', type: 'terminal_opened', severity: 'info', summary: `Opened native workspace terminal (${shell || 'default'})` })
  const session = new NativeTerminalSession(workspace)
  session.attach(browser, shell)
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
        if (!response.success) throw new Error(response.error ?? 'Prompt request failed')
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
  await Promise.all([rpc.stop(), providerLogin.stop(), ...(enabledFeatures.has('workers') ? [workers.shutdown()] : [])])
  await activity.flush()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

server.requestTimeout = 120_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000

function startServer(initialPort: number, host: string, maxAttempts = 20): void {
  let currentPort = initialPort
  let attempts = 0

  const tryListen = () => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && attempts < maxAttempts && !process.env.PORT && !process.env.PI_DASHBOARD_PORT) {
        attempts++
        currentPort++
        console.log(`Port ${currentPort - 1} in use, hunting for next available port... trying ${currentPort}`)
        setTimeout(tryListen, 50)
      } else {
        console.error(`Server failed to start on port ${currentPort}: ${error.message}`)
        process.exit(1)
      }
    }

    server.once('error', onError)
    server.listen(currentPort, host, () => {
      server.removeListener('error', onError)
      console.log(`Pi Dashboard backend listening on http://${host}:${currentPort} [Project: ${projectSlug}]`)
      record({ category: 'system', type: 'server_start', severity: 'info', summary: `Dashboard backend started on port ${currentPort} for project ${projectSlug}` })
      void rpc.start().then(() => state()).catch((error: Error) => {
        record({ category: 'error', type: 'rpc_start_failed', severity: 'error', summary: error.message })
        console.error(`Unable to start Pi RPC: ${error.message}`)
      })
    })
  }

  tryListen()
}

startServer(port, host)
