import type { RpcEvent } from './types.js'
import { PiRpcProcess } from './pi-rpc.js'
import type { GitService, GitStatusEntry } from './git-service.js'
import type { WorkerAdapter, WorkerChangedFile, WorkerMode, WorkerProviderStatus, WorkerRunHooks, WorkerRunInput, WorkerRunOutput } from './worker-types.js'

function toolsFor(mode: WorkerMode): string {
  return mode === 'implement' ? 'read,grep,find,ls,bash,edit,write' : 'read,grep,find,ls'
}

function boundedText(value: string, limit: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value.trim(), 'utf8')
  if (buffer.length <= limit) return { text: value.trim(), truncated: false }
  return { text: `${buffer.subarray(0, limit).toString('utf8')}\n\n[Result truncated by Dashboard]`, truncated: true }
}

function entryKey(entry: GitStatusEntry): string {
  return `${entry.index}${entry.workingTree}:${entry.state}`
}

function changedFiles(before: GitStatusEntry[], after: GitStatusEntry[], touched: Set<string>): WorkerChangedFile[] {
  const baseline = new Map(before.map((entry) => [entry.path, entryKey(entry)]))
  const detected = new Map<string, string>()
  for (const entry of after) {
    if (baseline.get(entry.path) !== entryKey(entry) || touched.has(entry.path)) detected.set(entry.path, entry.state)
  }
  for (const path of touched) {
    if (!detected.has(path)) detected.set(path, 'touched')
  }
  return [...detected].map(([path, state]) => ({ path, state })).sort((left, right) => left.path.localeCompare(right.path))
}

function workerPrompt(input: WorkerRunInput): string {
  const policy = input.mode === 'implement'
    ? 'You may edit files inside the current project and run focused validation. Do not commit, push, access credentials, change Dashboard sessions/UI, or delegate to another worker.'
    : input.mode === 'review'
      ? 'Read and review only. Do not edit files or run commands that change project or external state.'
      : 'Research inside the available project/runtime context only. Read only; do not edit files or run commands that change state.'

  const rules = input.ruleContext ? `\n\nGuidelines:\n${input.ruleContext}\n` : ''

  return `You are Sub PI, a bounded worker reporting to Primary PI.\n\nMode: ${input.mode}\n${policy}${rules}\nWork only on the narrow task below. Keep the final response concise and decision-useful. Include findings, validation performed, and changed files (if any). Primary PI will review your work and remains responsible for all final decisions.\n\nTask:\n${input.prompt}\n\nBounds: at most ${input.bounds.turnLimit} model turns and ${Math.round(input.bounds.timeoutMs / 60_000)} minutes.`
}

export interface SubPiWorkerOptions {
  workspace: string
  sessionDir?: string
  pluginToolsExtension: string
  pluginStateRoot?: string
  pluginCodeRoot?: string
  authoringSkillPath?: string
  referenceSkillPath?: string
  git: GitService
  enabled: boolean
}

export class SubPiWorkerAdapter implements WorkerAdapter {
  private active?: { taskId: string; rpc: PiRpcProcess; cancel: () => void }

  constructor(private readonly options: SubPiWorkerOptions) {}

  get provider(): WorkerProviderStatus {
    return {
      id: 'sub-pi',
      name: 'Sub PI',
      description: 'Built-in focused worker using a separate Pi RPC process and saved session.',
      kind: 'built-in',
      status: this.options.enabled ? 'ready' : 'disabled',
      statusLabel: this.options.enabled ? 'Ready in this Dashboard profile' : 'Enable Workers in the Dashboard profile',
      modes: ['research', 'review', 'implement'] as WorkerMode[],
      enabled: this.options.enabled,
      loginCommand: 'exec pi',
      manageCommand: 'exec pi',
    }
  }

  async run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput> {
    if (this.active) throw new Error('Sub PI is already running')
    const args = ['--mode', 'rpc', '--name', `Sub PI: ${input.prompt.slice(0, 72)}`, '--tools', toolsFor(input.mode), '--extension', this.options.pluginToolsExtension, ...(this.options.sessionDir ? ['--session-dir', this.options.sessionDir] : [])]
    const rpc = new PiRpcProcess({
      cwd: this.options.workspace,
      args,
      env: {
        PI_DASHBOARD_WORKER_MODE: input.mode,
        ...(this.options.pluginStateRoot ? { PI_DASHBOARD_PLUGIN_STATE_ROOT: this.options.pluginStateRoot } : {}),
        ...(this.options.pluginCodeRoot ? { PI_DASHBOARD_PLUGIN_CODE_ROOT: this.options.pluginCodeRoot } : {}),
        ...(this.options.authoringSkillPath ? { PI_DASHBOARD_PLUGIN_AUTHORING_SKILL_PATH: this.options.authoringSkillPath } : {}),
        ...(this.options.referenceSkillPath ? { PI_DASHBOARD_REFERENCE_SKILL_PATH: this.options.referenceSkillPath } : {}),
      },
    })
    const before = (await this.options.git.status()).entries
    const touched = new Set<string>()
    let result = ''
    let turns = 0
    let settledResolve: (() => void) | undefined
    let settledReject: ((error: Error) => void) | undefined
    const settled = new Promise<void>((resolve, reject) => { settledResolve = resolve; settledReject = reject })
    this.active = { taskId: input.taskId, rpc, cancel: () => settledReject?.(new Error('Sub PI task was cancelled')) }
    const eventHandler = (event: RpcEvent) => {
      if (event.type === 'turn_start') {
        turns += 1
        void hooks.onProgress(`Sub PI is working (turn ${Math.min(turns, input.bounds.turnLimit)} of ${input.bounds.turnLimit}).`, turns)
        if (turns > input.bounds.turnLimit) {
          void rpc.request({ type: 'abort' }).catch(() => undefined)
          settledReject?.(new Error(`Sub PI reached the ${input.bounds.turnLimit}-turn limit`))
        }
      } else if (event.type === 'message_update') {
        const delta = event.assistantMessageEvent as Record<string, unknown> | undefined
        if (delta?.type === 'text_delta' && typeof delta.delta === 'string') result += delta.delta
        if (delta?.type === 'error' && delta.reason !== 'aborted') settledReject?.(new Error(`Sub PI response failed: ${String(delta.reason ?? 'unknown error')}`))
      } else if (event.type === 'tool_execution_start') {
        const toolName = String(event.toolName ?? 'tool')
        const args = event.args && typeof event.args === 'object' ? event.args as Record<string, unknown> : {}
        if ((toolName === 'edit' || toolName === 'write') && typeof args.path === 'string') touched.add(args.path.replaceAll('\\', '/').replace(/^\.\//, ''))
        void hooks.onProgress(`Sub PI is using ${toolName}.`, turns)
      } else if (event.type === 'extension_error') {
        settledReject?.(new Error(`Sub PI extension failed: ${String(event.error ?? 'unknown error')}`))
      } else if (event.type === 'agent_settled') {
        settledResolve?.()
      }
    }
    rpc.on('event', eventHandler)
    rpc.on('exit', (error: Error) => settledReject?.(error))
    rpc.on('protocolError', (error: Error) => settledReject?.(error))
    try {
      await rpc.start()
      if (input.model) await rpc.request({ type: 'set_model', provider: input.model.provider, modelId: input.model.id })
      if (input.thinkingLevel) await rpc.request({ type: 'set_thinking_level', level: input.thinkingLevel })
      const state = await rpc.request({ type: 'get_state' })
      const sessionId = state.data && typeof state.data === 'object' && typeof (state.data as Record<string, unknown>).sessionId === 'string'
        ? (state.data as Record<string, unknown>).sessionId as string
        : undefined
      if (!sessionId) throw new Error('Sub PI did not provide a saved session ID')
      await hooks.onSession(sessionId)
      await rpc.request({ type: 'prompt', message: workerPrompt(input) })
      await settled
      const bounded = boundedText(result || 'Sub PI finished without a text result. Inspect the saved session for details.', input.bounds.resultLimitBytes)
      const after = (await this.options.git.status()).entries
      const files = changedFiles(before, after, touched)
      return {
        result: bounded.text,
        resultTruncated: bounded.truncated,
        changedFiles: files,
        resultEnvelope: {
          summary: bounded.text.slice(0, 300),
          actionsTaken: files.length ? [`Modified ${files.length} file(s)`] : ['Completed task execution'],
          changedFiles: files,
          warnings: [],
          sessionId,
        },
      }
    } finally {
      rpc.off('event', eventHandler)
      await rpc.stop().catch(() => undefined)
      if (this.active?.taskId === input.taskId) this.active = undefined
    }
  }

  async cancel(taskId: string): Promise<void> {
    const active = this.active
    if (active?.taskId !== taskId) return
    active.cancel()
    await active.rpc.request({ type: 'abort' }).catch(() => undefined)
    await active.rpc.stop().catch(() => undefined)
    if (this.active === active) this.active = undefined
  }
}
