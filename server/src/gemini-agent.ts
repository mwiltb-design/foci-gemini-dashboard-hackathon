import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { FunctionCallingConfigMode, GoogleGenAI, Type, type Content, type FunctionDeclaration, type Part } from '@google/genai'
import type { JsonObject, RpcEvent, RpcResponse } from './types.js'

interface GeminiAgentOptions {
  cwd: string
  sessionDir?: string
  workerDelegate?: GeminiWorkerDelegate
}

const workerProviderIds = ['gemini-worker', 'sub-pi', 'antigravity-cli', 'codex-cli', 'claude-cli'] as const
const workerModes = ['research', 'review', 'implement'] as const

export interface GeminiWorkerDelegateInput {
  providerId?: typeof workerProviderIds[number]
  mode: typeof workerModes[number]
  prompt: string
  bounds?: {
    turnLimit?: number
    timeoutMs?: number
    resultLimitBytes?: number
  }
}

export interface GeminiWorkerDelegateResult {
  id: string
  status: string
  sessionId?: string
  result?: string
  resultTruncated?: boolean
  changedFiles?: Array<{ path: string; state: string }>
  error?: string
}

export type GeminiWorkerDelegate = (input: GeminiWorkerDelegateInput) => Promise<GeminiWorkerDelegateResult>

interface DashboardMessage {
  role: 'user' | 'assistant' | 'toolResult'
  content: Array<Record<string, unknown>>
  toolCallId?: string
  toolName?: string
  isError?: boolean
}

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file from the current workspace. Use relative paths only.',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 text file in the current workspace. Use relative paths only.',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING } }, required: ['path', 'content'] },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a workspace directory. Use relative paths only.',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ['path'] },
  },
  {
    name: 'run_command',
    description: 'Run a safe, bounded workspace command. Destructive shell operators and commands are blocked.',
    parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING } }, required: ['command'] },
  },
  {
    name: 'dashboard_delegate_worker',
    description: 'Start one bounded worker task and wait for its result. Use a specialized provider for narrow research, review, or implementation work.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        providerId: { type: Type.STRING, enum: [...workerProviderIds], description: 'Worker provider. Defaults to sub-pi.' },
        mode: { type: Type.STRING, enum: [...workerModes], description: 'Worker task mode.' },
        prompt: { type: Type.STRING, description: 'Complete bounded task and expected deliverable.' },
        bounds: {
          type: Type.OBJECT,
          description: 'Optional execution bounds.',
          properties: {
            turnLimit: { type: Type.NUMBER, description: 'Maximum turns (1-30).' },
            timeoutMinutes: { type: Type.NUMBER, description: 'Maximum runtime in minutes (1-30).' },
            resultLimitKb: { type: Type.NUMBER, description: 'Maximum result size in KB (1-64).' },
          },
        },
      },
      required: ['mode', 'prompt'],
    },
  },
]

function textContent(text: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text }]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Gemini agent error'
}

export class GeminiAgentProcess extends EventEmitter {
  private ai: GoogleGenAI | null = null
  private runningState = false
  private isStreaming = false
  private abortController: AbortController | null = null
  private requestCounter = 0
  private sessionId = `gemini-${Date.now()}`
  private sessionName = 'Gemini Cloud Session'
  private contents: Content[] = []
  private dashboardMessages: DashboardMessage[] = []
  private model: string
  private thinkingLevel = 'auto'

  constructor(private readonly options: GeminiAgentOptions) {
    super()
    this.model = process.env.GEMINI_MODEL ?? process.env.GEMINI_FLASH_MODEL ?? 'gemini-3.5-flash'
  }

  get running(): boolean {
    return this.runningState
  }

  async start(): Promise<void> {
    if (this.runningState) return
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (apiKey) this.ai = new GoogleGenAI({ apiKey })
    this.runningState = true
    await mkdir(this.options.cwd, { recursive: true }).catch(() => undefined)
    if (this.options.sessionDir) await mkdir(this.options.sessionDir, { recursive: true }).catch(() => undefined)
    queueMicrotask(() => this.emit('ready'))
  }

  async stop(): Promise<void> {
    this.abortController?.abort()
    this.abortController = null
    this.runningState = false
    this.isStreaming = false
  }

  send(_command: JsonObject): void {
    // Extension UI responses are a Pi-specific protocol feature. Gemini MVP ignores them safely.
  }

  async request(command: JsonObject, _timeoutMs = 30_000): Promise<RpcResponse> {
    await this.start()
    const id = typeof command.id === 'string' ? command.id : `gemini-dashboard-${++this.requestCounter}`
    const type = String(command.type ?? '')
    try {
      if (type === 'get_state') return this.response(id, type, this.state())
      if (type === 'get_session_stats') return this.response(id, type, { contextUsage: { tokens: null, contextWindow: 1_000_000, percent: null } })
      if (type === 'get_messages') return this.response(id, type, { messages: this.dashboardMessages })
      if (type === 'get_available_models') {
        return this.response(id, type, { models: this.availableModels() })
      }
      if (type === 'get_commands') return this.response(id, type, { commands: [] })
      if (type === 'set_model') {
        const requestedModel = typeof command.modelId === 'string' ? command.modelId.trim() : ''
        if (requestedModel) this.model = requestedModel
        return this.response(id, type, this.state())
      }
      if (type === 'set_thinking_level') {
        const requestedLevel = typeof command.level === 'string' ? command.level.trim() : ''
        if (requestedLevel) this.thinkingLevel = requestedLevel
        return this.response(id, type, this.state())
      }
      if (type === 'new_session') {
        this.newSession()
        return this.response(id, type, this.state())
      }
      if (type === 'set_session_name') {
        this.sessionName = typeof command.name === 'string' && command.name.trim() ? command.name.trim().slice(0, 100) : this.sessionName
        return this.response(id, type, this.state())
      }
      if (type === 'abort') {
        this.abortController?.abort()
        return this.response(id, type, { aborted: true })
      }
      if (type === 'prompt') {
        const message = typeof command.message === 'string' ? command.message : ''
        await this.prompt(message)
        return this.response(id, type, this.state())
      }
      if (type === 'switch_session' || type === 'fork' || type === 'clone') return this.response(id, type, this.state())
      throw new Error(`Unsupported Gemini RPC command: ${type}`)
    } catch (error) {
      return { id, type: 'response', command: type, success: false, error: errorMessage(error) }
    }
  }

  private response(id: string, command: string, data: unknown): RpcResponse {
    return { id, type: 'response', command, success: true, data }
  }

  private state(): Record<string, unknown> {
    return {
      model: { provider: 'google', id: this.model },
      thinkingLevel: this.thinkingLevel,
      isStreaming: this.isStreaming,
      sessionId: this.sessionId,
      sessionName: this.sessionName,
      messageCount: this.dashboardMessages.length,
    }
  }

  private availableModels(): Array<Record<string, unknown>> {
    const models = [this.model, 'gemini-3.5-flash', 'gemini-3.5-pro', 'gemini-2.5-flash', 'gemini-2.5-pro']
    return [...new Set(models)].map((id) => ({
      id,
      provider: 'google',
      name: `Gemini (${id})`,
      reasoning: true,
      contextWindow: id.includes('pro') ? 2_000_000 : 1_000_000,
    }))
  }

  private newSession(): void {
    this.abortController?.abort()
    this.sessionId = `gemini-${Date.now()}`
    this.sessionName = 'Gemini Cloud Session'
    this.contents = []
    this.dashboardMessages = []
  }

  private async prompt(message: string): Promise<void> {
    if (!message.trim()) throw new Error('Prompt is required')
    if (!this.ai) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini Cloud mode')
    if (this.isStreaming) throw new Error('Wait for the current Gemini response to finish')

    this.abortController = new AbortController()
    this.isStreaming = true
    const userMessage: DashboardMessage = { role: 'user', content: textContent(message) }
    this.dashboardMessages.push(userMessage)
    this.contents.push({ role: 'user', parts: [{ text: message }] })
    this.emitEvent({ type: 'agent_start' })
    this.emitEvent({ type: 'message_start', message: userMessage })
    this.emitEvent({ type: 'message_start', message: { role: 'assistant', content: textContent('') } })

    let assistantText = ''
    try {
      for (let round = 0; round < 8; round += 1) {
        let roundText = ''
        const functionCallParts = await this.generateRound((delta) => {
          roundText += delta
          assistantText += delta
          this.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } })
        })
        if (functionCallParts.length === 0) {
          if (roundText) this.contents.push({ role: 'model', parts: [{ text: roundText }] })
          break
        }
        this.contents.push({ role: 'model', parts: [
          ...(roundText ? [{ text: roundText }] : []),
          ...functionCallParts,
        ] })
        const pendingTools = functionCallParts.map(async (part) => {
          const call = part.functionCall!
          const toolCallId = call.id || `gemini-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const toolName = call.name || 'unknown_tool'
          const args = call.args ?? {}
          this.dashboardMessages.push({ role: 'assistant', content: [{ type: 'toolCall', id: toolCallId, name: toolName, arguments: args }] })
          this.emitEvent({ type: 'tool_execution_start', toolCallId, toolName, args })
          const result = await this.executeTool(toolName, args)
          const output = result.ok ? result.output : result.error
          this.dashboardMessages.push({ role: 'toolResult', toolCallId, toolName, isError: !result.ok, content: textContent(output) })
          this.emitEvent({ type: 'tool_execution_end', toolCallId, toolName, isError: !result.ok, result: { content: textContent(output) } })
          return { functionResponse: { id: call.id, name: toolName, response: result.ok ? { output } : { error: output } } }
        })
        const functionResponses = await Promise.all(pendingTools)
        this.contents.push({ role: 'user', parts: functionResponses })
      }
      const assistantMessage: DashboardMessage = { role: 'assistant', content: textContent(assistantText) }
      this.dashboardMessages.push(assistantMessage)
      this.emitEvent({ type: 'message_end', message: assistantMessage })
    } catch (error) {
      this.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'error', reason: errorMessage(error) } })
      throw error
    } finally {
      this.isStreaming = false
      this.abortController = null
      this.emitEvent({ type: 'agent_settled' })
    }
  }

  private async generateRound(onText: (delta: string) => void): Promise<Part[]> {
    if (!this.ai) throw new Error('Gemini client is not initialized')
    const systemInstruction = await this.systemInstruction()
    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: this.contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: toolDeclarations }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      },
    })
    const functionCallParts: Part[] = []
    for await (const chunk of stream) {
      if (this.abortController?.signal.aborted) throw new Error('aborted')
      const text = chunk.text ?? ''
      if (text) onText(text)
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (part.functionCall?.name) functionCallParts.push(part)
      }
    }
    return functionCallParts
  }

  private async systemInstruction(): Promise<string> {
    const memory = await this.readOptional('MEMORY.md')
    const user = await this.readOptional('USER.md')
    return [
      'You are Foci Dashboard, a cloud Gemini agent for a hackathon demo.',
      'Be concise, transparent, and safe. Prefer small, reversible file edits.',
      'Use tools when you need exact workspace facts. Do not claim a file changed unless a tool succeeded.',
      'Use dashboard_delegate_worker for narrow delegated tasks. Review its result before presenting findings or accepting changes.',
      'For shell commands, use the smallest safe command and explain risky operations before attempting them.',
      memory ? `Project MEMORY.md:\n${memory.slice(0, 20_000)}` : '',
      user ? `Workspace USER.md:\n${user.slice(0, 8_000)}` : '',
    ].filter(Boolean).join('\n\n')
  }

  private async readOptional(path: string): Promise<string> {
    try { return await readFile(this.safePath(path), 'utf8') } catch { return '' }
  }

  private safePath(input: string, allowWorkspaceRoot = false): string {
    if (!input || input.includes('\0')) throw new Error('Invalid path')
    const workspaceRoot = resolve(this.options.cwd)
    const target = resolve(workspaceRoot, input)
    const normalize = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
    const normalizedRoot = normalize(workspaceRoot)
    const normalizedTarget = normalize(target)
    const isRoot = normalizedTarget === normalizedRoot
    if ((!allowWorkspaceRoot && isRoot) || (!isRoot && !normalizedTarget.startsWith(`${normalizedRoot}${sep}`))) {
      throw new Error('Path must stay inside the workspace')
    }
    return target
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
    try {
      if (name === 'read_file') {
        const path = String(args.path ?? '')
        const content = await readFile(this.safePath(path), 'utf8')
        return { ok: true, output: content.slice(0, 50_000) }
      }
      if (name === 'write_file') {
        const path = String(args.path ?? '')
        const content = String(args.content ?? '')
        const target = this.safePath(path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content, 'utf8')
        return { ok: true, output: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path}` }
      }
      if (name === 'list_directory') {
        const path = String(args.path ?? '.')
        const target = this.safePath(path, true)
        const entries = await readdir(target, { withFileTypes: true })
        return { ok: true, output: entries.map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'}\t${entry.name}`).join('\n').slice(0, 50_000) }
      }
      if (name === 'run_command') return await this.runCommand(String(args.command ?? ''))
      if (name === 'dashboard_delegate_worker') return await this.delegateWorker(args)
      return { ok: false, error: `Unknown tool: ${name}` }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
    }
  }

  private async delegateWorker(args: Record<string, unknown>): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
    if (!this.options.workerDelegate) return { ok: false, error: 'Worker delegation is not available' }
    const providerId = typeof args.providerId === 'string' ? args.providerId : undefined
    const mode = typeof args.mode === 'string' ? args.mode : ''
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
    if (providerId && !(workerProviderIds as readonly string[]).includes(providerId)) return { ok: false, error: `Unknown worker provider: ${providerId}` }
    if (!(workerModes as readonly string[]).includes(mode)) return { ok: false, error: 'Worker mode must be research, review, or implement' }
    if (!prompt) return { ok: false, error: 'Worker prompt is required' }

    const rawBounds = args.bounds && typeof args.bounds === 'object' ? args.bounds as Record<string, unknown> : undefined
    const numberInRange = (value: unknown, minimum: number, maximum: number): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : undefined
    const turnLimit = numberInRange(rawBounds?.turnLimit, 1, 30)
    const timeoutMinutes = numberInRange(rawBounds?.timeoutMinutes, 1, 30)
    const resultLimitKb = numberInRange(rawBounds?.resultLimitKb, 1, 64)
    const bounds = rawBounds ? {
      ...(turnLimit !== undefined ? { turnLimit } : {}),
      ...(timeoutMinutes !== undefined ? { timeoutMs: timeoutMinutes * 60_000 } : {}),
      ...(resultLimitKb !== undefined ? { resultLimitBytes: resultLimitKb * 1024 } : {}),
    } : undefined

    const task = await this.options.workerDelegate({
      ...(providerId ? { providerId: providerId as GeminiWorkerDelegateInput['providerId'] } : {}),
      mode: mode as GeminiWorkerDelegateInput['mode'],
      prompt,
      ...(bounds ? { bounds } : {}),
    })
    const summary = {
      taskId: task.id,
      status: task.status,
      sessionId: task.sessionId,
      result: task.result,
      resultTruncated: task.resultTruncated,
      changedFiles: task.changedFiles,
      error: task.error,
    }
    return { ok: true, output: JSON.stringify(summary, null, 2) }
  }

  private async runCommand(command: string): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
    const trimmed = command.trim()
    if (!trimmed) return { ok: false, error: 'Command is required' }
    if (/[\r\n]/.test(command)) return { ok: false, error: 'Command blocked by Foci safety policy' }
    const blocked = /(?:\brm\b|\brmdir\b|\bdel\b|\bformat\b|\bshutdown\b|\breboot\b|[>&|;`]|\$\()/i
    if (blocked.test(trimmed)) return { ok: false, error: 'Command blocked by Foci safety policy' }
    const first = trimmed.split(/\s+/)[0]?.toLowerCase() ?? ''
    const allowed = new Set(['npm', 'git', 'ls', 'dir', 'pwd', 'echo', 'find', 'grep'])
    if (!allowed.has(first)) return { ok: false, error: `Command not allowlisted: ${first}` }

    const inheritedEnvironment = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TERM', 'NODE_ENV'])
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => inheritedEnvironment.has(name.toUpperCase())))

    return await new Promise((resolvePromise) => {
      const child = spawn(trimmed, { cwd: this.options.cwd, shell: true, env })
      let output = ''
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        resolvePromise({ ok: false, error: `${output}\nCommand timed out after 20 seconds`.trim() })
      }, 20_000)
      child.stdout.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-50_000) })
      child.stderr.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-50_000) })
      child.on('close', (code) => {
        clearTimeout(timeout)
        const finalOutput = output.trim() || `(command exited with code ${code ?? 'unknown'})`
        if (code === 0) resolvePromise({ ok: true, output: finalOutput })
        else resolvePromise({ ok: false, error: finalOutput })
      })
      child.on('error', (error) => {
        clearTimeout(timeout)
        resolvePromise({ ok: false, error: error.message })
      })
    })
  }

  private emitEvent(event: RpcEvent): void {
    this.emit('event', event)
  }
}
