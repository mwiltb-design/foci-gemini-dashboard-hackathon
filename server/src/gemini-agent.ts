import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { FunctionCallingConfigMode, GoogleGenAI, Type, type Content, type FunctionDeclaration, type Part } from '@google/genai'
import type { JsonObject, RpcEvent, RpcResponse } from './types.js'
import {
  DEFAULT_MEMORY_CHECKPOINT_SETTINGS,
  memoryCheckpointThresholds,
  normalizeMemoryCheckpointSettings,
  normalizeMemoryCheckpointStatus,
  type MemoryCheckpointSettings,
  type MemoryCheckpointStatus,
} from './memory-checkpoint.js'

interface GeminiAgentOptions {
  cwd: string
  sessionDir?: string
  workerDelegate?: GeminiWorkerDelegate
}

const workerProviderIds = ['gemini-worker', 'antigravity-cli'] as const
const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash'
const GEMINI_MODEL_IDS = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.7-pro',
  'gemini-3.7-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.5-pro',
  'gemini-3.5-flash-lite',
  'gemini-3.0-flash',
  'gemini-3.0-pro',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-2.0-pro',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
] as const
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
    description: 'Read the complete text contents of a file in the current workspace. Use relative paths.',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: 'Relative path to the file' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the current workspace with new content. Use relative paths.',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: 'Relative path to the file' }, content: { type: Type.STRING, description: 'Complete file text content' } }, required: ['path', 'content'] },
  },
  {
    name: 'list_directory',
    description: 'List all files and subdirectories in a workspace directory. Use relative paths.',
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING, description: 'Relative path to the directory' } }, required: ['path'] },
  },
  {
    name: 'run_command',
    description: 'Execute shell commands, Python scripts (e.g. python3 scripts/...), Git operations, data fetching, and build tasks directly in the workspace.',
    parameters: { type: Type.OBJECT, properties: { command: { type: Type.STRING, description: 'Exact shell command string to execute' } }, required: ['command'] },
  },
  {
    name: 'dashboard_delegate_worker',
    description: 'Delegate an autonomous sub-agent task to a background worker (providerId: "gemini-worker" or "antigravity-cli", mode: "research", "review", or "implement").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        providerId: { type: Type.STRING, description: 'Worker provider ID: "gemini-worker" or "antigravity-cli"' },
        mode: { type: Type.STRING, description: 'Worker mode: "research", "review", or "implement"' },
        prompt: { type: Type.STRING, description: 'Detailed, actionable task prompt for the worker' },
        bounds: {
          type: Type.OBJECT,
          properties: {
            turnLimit: { type: Type.INTEGER, description: 'Maximum worker turns (default: 8)' },
            timeoutMs: { type: Type.INTEGER, description: 'Timeout in milliseconds (default: 180000)' },
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
  if (error instanceof Error) return error.message
  return String(error || 'Unknown error')
}

export class GeminiAgentProcess extends EventEmitter {
  private ai?: GoogleGenAI
  private runningState = false
  private isStreaming = false
  private abortController: AbortController | null = null
  private requestCounter = 0
  private sessionId = `gemini-${Date.now()}`
  private sessionName = 'Gemini Cloud Session'
  private sessionFilePath?: string
  private lastEntryId: string | null = null
  private contents: Content[] = []
  private dashboardMessages: DashboardMessage[] = []
  private model: string
  private thinkingLevel = 'auto'

  constructor(private readonly options: GeminiAgentOptions) {
    super()
    this.model = process.env.GEMINI_MODEL ?? process.env.GEMINI_FLASH_MODEL ?? DEFAULT_GEMINI_MODEL
  }

  get running(): boolean {
    return this.runningState
  }

  private async findLatestSessionFile(): Promise<string | null> {
    const sessionDir = this.options.sessionDir || resolve(this.options.cwd, '.pi/sessions')
    if (!existsSync(sessionDir)) return null
    try {
      const files = await readdir(sessionDir, { withFileTypes: true })
      const jsonlFiles = files
        .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
        .map((f) => resolve(sessionDir, f.name))
      if (!jsonlFiles.length) return null

      const stats = await Promise.all(
        jsonlFiles.map(async (file) => {
          try {
            const s = await stat(file)
            return { file, mtime: s.mtimeMs, size: s.size }
          } catch {
            return { file, mtime: 0, size: 0 }
          }
        })
      )
      const valid = stats.filter((s) => s.size > 0).sort((a, b) => b.mtime - a.mtime)
      return valid[0]?.file ?? null
    } catch {
      return null
    }
  }

  async start(): Promise<void> {
    if (this.runningState) return
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (apiKey) this.ai = new GoogleGenAI({ apiKey })
    this.runningState = true
    await mkdir(this.options.cwd, { recursive: true }).catch(() => undefined)
    if (this.options.sessionDir) await mkdir(this.options.sessionDir, { recursive: true }).catch(() => undefined)

    const latestFile = await this.findLatestSessionFile()
    if (latestFile) {
      try {
        await this.loadSession(latestFile)
      } catch (err) {
        console.warn('[GeminiAgentProcess] Failed to load latest session, starting new session:', err)
        await this.initSessionFile().catch(() => undefined)
      }
    } else {
      await this.initSessionFile().catch(() => undefined)
    }
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
      if (type === 'get_session_stats') {
        const toolCallCount = this.dashboardMessages.filter((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((b) => b.type === 'toolCall')).length
        return this.response(id, type, {
          totalMessages: this.dashboardMessages.length,
          toolCalls: toolCallCount,
          contextUsage: { tokens: null, contextWindow: this.model.includes('pro') ? 2_000_000 : 1_000_000, percent: null },
        })
      }
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
        await this.newSession()
        return this.response(id, type, this.state())
      }
      if (type === 'set_session_name') {
        this.sessionName = typeof command.name === 'string' && command.name.trim() ? command.name.trim().slice(0, 100) : this.sessionName
        const entryId = randomBytes(4).toString('hex')
        const entry = {
          type: 'session_info',
          id: entryId,
          parentId: this.lastEntryId,
          timestamp: new Date().toISOString(),
          name: this.sessionName,
        }
        this.lastEntryId = entryId
        await this.appendSessionEntry(entry)
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
      if (type === 'switch_session') {
        const sessionPath = typeof command.sessionPath === 'string' ? command.sessionPath : ''
        await this.loadSession(sessionPath)
        return this.response(id, type, this.state())
      }
      if (type === 'fork' || type === 'clone') {
        const entryIdParam = typeof command.entryId === 'string' ? command.entryId : undefined
        await this.forkSession(entryIdParam)
        return this.response(id, type, this.state())
      }
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
      sessionFile: this.sessionFilePath,
      sessionName: this.sessionName,
      messageCount: this.dashboardMessages.length,
    }
  }

  private availableModels(): Array<Record<string, unknown>> {
    const models = [this.model, ...GEMINI_MODEL_IDS]
    return [...new Set(models)].map((id) => ({
      id,
      provider: 'google',
      name: `Gemini (${id})`,
      reasoning: true,
      contextWindow: id.includes('pro') ? 2_000_000 : 1_000_000,
    }))
  }

  private async initSessionFile(): Promise<string> {
    if (this.sessionFilePath && existsSync(this.sessionFilePath)) {
      return this.sessionFilePath
    }
    const sessionDir = this.options.sessionDir || resolve(this.options.cwd, '.pi/sessions')
    await mkdir(sessionDir, { recursive: true }).catch(() => undefined)
    const filePath = resolve(sessionDir, `${this.sessionId}.jsonl`)
    this.sessionFilePath = filePath

    if (existsSync(filePath)) {
      return filePath
    }

    const header = {
      type: 'session',
      version: 1,
      id: this.sessionId,
      timestamp: new Date().toISOString(),
      cwd: resolve(this.options.cwd),
    }
    const infoEntryId = randomBytes(4).toString('hex')
    const infoEntry = {
      type: 'session_info',
      id: infoEntryId,
      parentId: null,
      timestamp: new Date().toISOString(),
      name: this.sessionName,
    }
    this.lastEntryId = infoEntryId

    const content = `${JSON.stringify(header)}\n${JSON.stringify(infoEntry)}\n`
    await writeFile(filePath, content, 'utf8')
    return filePath
  }

  private async appendSessionEntry(entry: Record<string, unknown>): Promise<void> {
    try {
      await this.initSessionFile()
      if (!this.sessionFilePath) return
      await appendFile(this.sessionFilePath, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch (err) {
      console.warn('[GeminiAgentProcess] Failed to append session entry:', err)
    }
  }

  private async newSession(): Promise<void> {
    this.abortController?.abort()
    this.sessionId = `gemini-${Date.now()}`
    this.sessionName = 'Gemini Cloud Session'
    this.contents = []
    this.dashboardMessages = []
    this.lastEntryId = null
    this.sessionFilePath = undefined
    await this.initSessionFile()
  }

  private async loadSession(sessionPath: string): Promise<void> {
    this.abortController?.abort()
    const resolvedPath = resolve(sessionPath)
    const content = await readFile(resolvedPath, 'utf8')
    const lines = content.split('\n').filter(Boolean)
    const records = lines.flatMap((line) => {
      try { return [JSON.parse(line) as Record<string, unknown>] } catch { return [] }
    })
    const header = records[0]
    if (!header || header.type !== 'session') throw new Error('Invalid session file')

    this.sessionId = String(header.id || `gemini-${Date.now()}`)
    this.sessionFilePath = resolvedPath
    this.sessionName = 'Gemini Cloud Session'
    this.contents = []
    this.dashboardMessages = []
    this.lastEntryId = null

    const entries = records.slice(1)
    for (const entry of entries) {
      if (entry.id && typeof entry.id === 'string') this.lastEntryId = entry.id
      if (entry.type === 'session_info' && typeof entry.name === 'string' && entry.name.trim()) {
        this.sessionName = entry.name.trim()
      } else if (entry.type === 'message' && entry.message && typeof entry.message === 'object') {
        const msg = entry.message as Record<string, unknown>
        const role = msg.role as string
        if (role === 'user') {
          const text = Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
            : (typeof msg.content === 'string' ? msg.content : '')
          this.dashboardMessages.push({ role: 'user', content: [{ type: 'text', text }] })
          this.contents.push({ role: 'user', parts: [{ text }] })
        } else if (role === 'assistant') {
          const text = Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
            : (typeof msg.content === 'string' ? msg.content : '')
          const toolCalls = Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b && typeof b === 'object' && b.type === 'toolCall')
            : []
          if (toolCalls.length > 0) {
            this.dashboardMessages.push({ role: 'assistant', content: toolCalls })
            this.contents.push({
              role: 'model',
              parts: [
                ...(text ? [{ text }] : []),
                ...toolCalls.map((tc: any) => ({
                  functionCall: { id: tc.id, name: tc.name, args: tc.arguments ?? {} },
                })),
              ],
            })
          } else if (text) {
            this.dashboardMessages.push({ role: 'assistant', content: [{ type: 'text', text }] })
            this.contents.push({ role: 'model', parts: [{ text }] })
          }
        } else if (role === 'toolResult') {
          const output = Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
            : (typeof msg.content === 'string' ? msg.content : '')
          const toolCallId = typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined
          const toolName = typeof msg.toolName === 'string' ? msg.toolName : undefined
          this.dashboardMessages.push({
            role: 'toolResult',
            toolCallId,
            toolName,
            isError: Boolean(msg.isError),
            content: [{ type: 'text', text: output }],
          })
          this.contents.push({
            role: 'user',
            parts: [{
              functionResponse: {
                id: toolCallId,
                name: toolName || 'unknown_tool',
                response: msg.isError ? { error: output } : { output },
              },
            }],
          })
        }
      }
    }
  }

  private async forkSession(targetEntryId?: string): Promise<void> {
    this.abortController?.abort()
    const parentSessionId = this.sessionId
    const newSessionId = `gemini-${Date.now()}`
    const sessionDir = this.options.sessionDir || resolve(this.options.cwd, '.pi/sessions')
    await mkdir(sessionDir, { recursive: true }).catch(() => undefined)
    const newFilePath = resolve(sessionDir, `${newSessionId}.jsonl`)

    const header = {
      type: 'session',
      version: 1,
      id: newSessionId,
      timestamp: new Date().toISOString(),
      cwd: resolve(this.options.cwd),
      parentSession: parentSessionId,
    }

    let recordsToCopy: Array<Record<string, unknown>> = []
    if (this.sessionFilePath && existsSync(this.sessionFilePath)) {
      try {
        const fileContent = await readFile(this.sessionFilePath, 'utf8')
        const allRecords = fileContent.split('\n').filter(Boolean).flatMap((line) => {
          try { return [JSON.parse(line) as Record<string, unknown>] } catch { return [] }
        })
        const entries = allRecords.slice(1)
        if (targetEntryId) {
          const targetIndex = entries.findIndex((e) => e.id === targetEntryId)
          recordsToCopy = targetIndex !== -1 ? entries.slice(0, targetIndex + 1) : entries
        } else {
          recordsToCopy = entries
        }
      } catch {}
    }

    const lines = [JSON.stringify(header), ...recordsToCopy.map((r) => JSON.stringify(r))].join('\n') + '\n'
    await writeFile(newFilePath, lines, 'utf8')

    await this.loadSession(newFilePath)
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

    const userEntryId = randomBytes(4).toString('hex')
    const userEntry = {
      type: 'message',
      id: userEntryId,
      parentId: this.lastEntryId,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: textContent(message),
      },
    }
    this.lastEntryId = userEntryId
    await this.appendSessionEntry(userEntry)

    this.emitEvent({ type: 'agent_start' })
    this.emitEvent({ type: 'message_start', message: userMessage })
    this.emitEvent({ type: 'message_start', message: { role: 'assistant', content: textContent('') } })

    // Track user message and check if scheduled memory consolidation checkpoint is due
    await this.checkAndRunMemoryCheckpoint(1, 0)

    let assistantText = ''
    const MAX_TOTAL_ROUNDS = Number(process.env.FOCI_AGENT_MAX_ROUNDS || 200)
    const MAX_CONSECUTIVE_FAILURES = 5
    const MAX_IDENTICAL_REPEATS = 3
    let consecutiveFailures = 0
    let lastActionSignature = ''
    let identicalActionCount = 0

    try {
      for (let round = 0; round < MAX_TOTAL_ROUNDS; round += 1) {
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

        const toolCallsForEntry = functionCallParts.map((part) => {
          const call = part.functionCall!
          const toolCallId = call.id || `gemini-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const toolName = call.name || 'unknown_tool'
          const args = call.args ?? {}
          return { type: 'toolCall', id: toolCallId, name: toolName, arguments: args }
        })

        const assistantEntryId = randomBytes(4).toString('hex')
        const assistantEntry = {
          type: 'message',
          id: assistantEntryId,
          parentId: this.lastEntryId,
          timestamp: new Date().toISOString(),
          message: {
            role: 'assistant',
            model: this.model,
            content: [
              ...(roundText ? [{ type: 'text', text: roundText }] : []),
              ...toolCallsForEntry,
            ],
          },
        }
        this.lastEntryId = assistantEntryId
        await this.appendSessionEntry(assistantEntry)

        let hasRoundFailure = false

        const pendingTools = functionCallParts.map(async (part, idx) => {
          const call = part.functionCall!
          const toolCallItem = toolCallsForEntry[idx]
          const toolCallId = toolCallItem.id
          const toolName = toolCallItem.name
          const args = toolCallItem.arguments

          // Loop & duplicate failure guard
          const signature = `${toolName}:${JSON.stringify(args)}`
          let isStuckDuplicate = false
          if (signature === lastActionSignature && consecutiveFailures > 0) {
            identicalActionCount += 1
            if (identicalActionCount >= MAX_IDENTICAL_REPEATS) {
              isStuckDuplicate = true
            }
          } else {
            lastActionSignature = signature
            identicalActionCount = 1
          }

          this.dashboardMessages.push({ role: 'assistant', content: [toolCallItem] })
          this.emitEvent({ type: 'tool_execution_start', toolCallId, toolName, args })

          let result: { ok: true; output: string } | { ok: false; error: string }
          if (isStuckDuplicate) {
            result = {
              ok: false,
              error: `Stuck loop prevented: this exact action failed ${identicalActionCount} times in a row with the same arguments. Analyze the error above and either adjust your parameters/approach or explain the blocker to the user.`,
            }
          } else {
            result = await this.executeTool(toolName, args)
          }

          if (result.ok) {
            // SUCCESS RESETS THE FAILURE & REPEAT COUNTERS (PROGRESS ENGINE)
            consecutiveFailures = 0
            identicalActionCount = 0
            await this.checkAndRunMemoryCheckpoint(0, 1)
          } else {
            hasRoundFailure = true
          }

          const output = result.ok ? result.output : result.error
          this.dashboardMessages.push({ role: 'toolResult', toolCallId, toolName, isError: !result.ok, content: textContent(output) })
          this.emitEvent({ type: 'tool_execution_end', toolCallId, toolName, isError: !result.ok, result: { content: textContent(output) } })

          const toolResultEntryId = randomBytes(4).toString('hex')
          const toolResultEntry = {
            type: 'message',
            id: toolResultEntryId,
            parentId: this.lastEntryId,
            timestamp: new Date().toISOString(),
            message: {
              role: 'toolResult',
              toolCallId,
              toolName,
              isError: !result.ok,
              content: textContent(output),
            },
          }
          this.lastEntryId = toolResultEntryId
          await this.appendSessionEntry(toolResultEntry)

          return { functionResponse: { id: call.id, name: toolName, response: result.ok ? { output } : { error: output } } }
        })

        const functionResponses = await Promise.all(pendingTools)
        this.contents.push({ role: 'user', parts: functionResponses })

        if (hasRoundFailure) {
          consecutiveFailures += 1
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            this.emitEvent({
              type: 'message_update',
              assistantMessageEvent: {
                type: 'text_delta',
                delta: `\n\n> ⚠️ *Adaptive safety brake engaged after ${consecutiveFailures} consecutive failed actions. Synthesizing status and blockers...*\n\n`,
              },
            })
            break
          }
        }
      }

      // Always guarantee a final text synthesis if the loop ended on tool calls without an explanation
      if (!assistantText.trim() || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        let finalSummary = ''
        await this.generateRound((delta) => {
          finalSummary += delta
          assistantText += delta
          this.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } })
        }, false)
        if (finalSummary.trim()) {
          this.contents.push({ role: 'model', parts: [{ text: finalSummary }] })
        }
      }

      if (!assistantText.trim()) {
        assistantText = 'Completed all requested actions and tool executions.'
        this.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: assistantText } })
      }

      const assistantMessage: DashboardMessage = { role: 'assistant', content: textContent(assistantText) }
      this.dashboardMessages.push(assistantMessage)

      if (assistantText) {
        const finalAssistantEntryId = randomBytes(4).toString('hex')
        const finalAssistantEntry = {
          type: 'message',
          id: finalAssistantEntryId,
          parentId: this.lastEntryId,
          timestamp: new Date().toISOString(),
          message: {
            role: 'assistant',
            model: this.model,
            content: textContent(assistantText),
          },
        }
        this.lastEntryId = finalAssistantEntryId
        await this.appendSessionEntry(finalAssistantEntry)
      }

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

  private async generateRound(onText: (delta: string) => void, allowTools = true): Promise<Part[]> {
    if (!this.ai) throw new Error('Gemini client is not initialized')
    const systemInstruction = await this.systemInstruction()
    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: this.contents,
      config: {
        systemInstruction,
        ...(allowTools ? {
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        } : {}),
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
    const projectMemory = await this.readOptional('MEMORY.md')
    const agentDir = process.env.PI_AGENT_DIR ?? process.env.FOCI_AGENT_DIR ?? resolve(homedir(), '.pi/agent')
    let globalMemory = ''
    let globalUser = ''
    try {
      if (existsSync(resolve(agentDir, 'MEMORY.md'))) {
        globalMemory = await readFile(resolve(agentDir, 'MEMORY.md'), 'utf8')
      }
      if (existsSync(resolve(agentDir, 'USER.md'))) {
        globalUser = await readFile(resolve(agentDir, 'USER.md'), 'utf8')
      }
    } catch {}
    const localUser = await this.readOptional('USER.md')
    const user = localUser || globalUser
    return [
      '# ROLE & CAPABILITIES',
      'You are Foci Dashboard Lead Orchestrator — an autonomous, senior AI engineer and scientific research lead.',
      'You operate directly inside the user\'s project workspace with full access to terminal commands, Python 3.11 geospatial tools, file manipulation, and background workers.',
      '',
      '# CORE BEHAVIORS & INITIATIVE',
      '1. Take Proactive Action: When given a goal or instruction, do not just explain what could be done — actively execute the required tools, inspect files, run the scripts, and produce concrete deliverables.',
      '2. End-to-End Problem Solving: If a script, command, or data download encounters an error, read the exact error output, diagnose the cause, inspect/modify the relevant files, and re-run. Never give up or repeat failing actions blindly.',
      '3. Full Tool Mastery:',
      '   - run_command: Run Python pipelines (`python3 ...`), git operations, USGS data downloads, tests, and build commands directly in the workspace.',
      '   - read_file / write_file / list_directory: Inspect and modify code, configurations, data manifests, and HTML reports.',
      '   - dashboard_delegate_worker: Delegate focused sub-tasks to `gemini-worker` or `antigravity-cli`.',
      '4. Clear & Authoritative Output: Present your findings clearly using structured Markdown tables, progress checklists, and direct links to output deliverables.',
      '',
      projectMemory ? `# Project Technical Memory (MEMORY.md):\n${projectMemory.slice(0, 20_000)}` : '',
      globalMemory ? `# Global Collaboration Memory (MEMORY.md):\n${globalMemory.slice(0, 10_000)}` : '',
      user ? `# User Profile (USER.md):\n${user.slice(0, 8_000)}` : '',
    ].filter(Boolean).join('\n\n')
  }

  private async checkAndRunMemoryCheckpoint(userMsgDelta = 0, toolCallDelta = 0): Promise<void> {
    const agentDir = process.env.PI_AGENT_DIR ?? process.env.FOCI_AGENT_DIR ?? resolve(homedir(), '.pi/agent')
    const statusPath = resolve(agentDir, 'dashboard/memory-checkpoint/status.json')
    const settingsPath = resolve(agentDir, 'dashboard/memory-checkpoint/settings.json')

    let settings: MemoryCheckpointSettings = DEFAULT_MEMORY_CHECKPOINT_SETTINGS
    try {
      if (existsSync(settingsPath)) {
        settings = normalizeMemoryCheckpointSettings(JSON.parse(await readFile(settingsPath, 'utf8')))
      }
    } catch {}

    if (!settings.enabled) return

    let memoryChars = 0
    try {
      const pMem = await this.readOptional('MEMORY.md')
      memoryChars += pMem.length
      if (existsSync(resolve(agentDir, 'MEMORY.md'))) {
        memoryChars += (await readFile(resolve(agentDir, 'MEMORY.md'), 'utf8')).length
      }
    } catch {}

    const thresholds = memoryCheckpointThresholds(settings, memoryChars)
    let status: MemoryCheckpointStatus = {
      schemaVersion: 1,
      userMessages: 0,
      toolCalls: 0,
      effectiveUserMessages: thresholds.userMessages,
      effectiveToolCalls: thresholds.toolCalls,
      reviewDue: false,
      checkpointRunning: false,
      updatedAt: new Date().toISOString(),
    }

    try {
      if (existsSync(statusPath)) {
        status = normalizeMemoryCheckpointStatus(JSON.parse(await readFile(statusPath, 'utf8')), thresholds)
      }
    } catch {}

    status.userMessages += userMsgDelta
    status.toolCalls += toolCallDelta
    status.reviewDue = status.userMessages >= thresholds.userMessages || status.toolCalls >= thresholds.toolCalls
    status.updatedAt = new Date().toISOString()

    if (status.reviewDue && !status.checkpointRunning) {
      status.checkpointRunning = true
      status.userMessages = 0
      status.toolCalls = 0
      status.reviewDue = false
      status.lastCheckpointAt = new Date().toISOString()

      try {
        await mkdir(dirname(statusPath), { recursive: true })
        await writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8')
      } catch {}

      try {
        await this.runMemoryCheckpointRound()
      } finally {
        status.checkpointRunning = false
        try {
          await writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8')
        } catch {}
      }
    } else {
      try {
        await mkdir(dirname(statusPath), { recursive: true })
        await writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8')
      } catch {}
    }
  }

  private async runMemoryCheckpointRound(): Promise<void> {
    if (!this.ai) return
    const systemInstruction = await this.systemInstruction()
    const reviewPrompt = `Memory checkpoint. This is a scheduled, lightweight review—not a new development task.

1. Review the useful facts, technical work, and decisions from the recent conversation.
2. For Global MEMORY.md: If you learned a new cross-project collaboration or communication preference (e.g., how the user prefers answers, explanations, or code formatting), update Global MEMORY.md. Keep it concise.
3. For Project MEMORY.md: Heavily review and update the active project's technical architecture. Prune out obsolete notes, and record current technical state, folder layout, and key implementation decisions.
4. If there is nothing worth updating, do nothing.
5. Report only a brief summary of what was updated.`

    const checkpointContents: Content[] = [
      ...this.contents.slice(-10),
      { role: 'user', parts: [{ text: reviewPrompt }] },
    ]

    try {
      this.emitEvent({
        type: 'message_update',
        assistantMessageEvent: {
          type: 'text_delta',
          delta: '\n\n> 🧠 *Performing scheduled memory checkpoint review (updating project & global MEMORY.md)...*\n\n',
        },
      })

      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents: checkpointContents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: toolDeclarations }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
        },
      })

      const functionCalls: Part[] = []
      for await (const chunk of stream) {
        const text = chunk.text ?? ''
        if (text) {
          this.emitEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
        }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (part.functionCall?.name) functionCalls.push(part)
        }
      }

      for (const fc of functionCalls) {
        if (fc.functionCall?.name) {
          const args = (fc.functionCall.args ?? {}) as Record<string, unknown>
          await this.executeTool(fc.functionCall.name, args)
        }
      }
    } catch {}
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

    // Block destructive root-level commands
    const blocked = /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot|poweroff|init\s+0)\b/i
    if (blocked.test(trimmed)) return { ok: false, error: 'Dangerous destructive command blocked by safety policy' }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: homedir(),
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      TERM: 'xterm-256color',
      CI: '1',
    }

    return await new Promise((resolvePromise) => {
      // 30 minute timeout for long-running LiDAR / raster processing tasks
      const child = spawn(trimmed, { cwd: this.options.cwd, shell: true, env })
      let output = ''
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 2000).unref()
        resolvePromise({ ok: false, error: `${output}\nCommand timed out after 30 minutes`.trim() })
      }, 1_800_000)

      child.stdout?.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-500_000) })
      child.stderr?.on('data', (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-500_000) })
      child.on('close', (code) => {
        clearTimeout(timeout)
        const finalOutput = output.trim() || `(command exited with code ${code ?? 0})`
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
