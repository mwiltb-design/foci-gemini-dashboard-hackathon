import { appendFile, readdir, readFile, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join, resolve, sep } from 'node:path'

interface SessionHeader {
  type: 'session'
  version?: number
  id: string
  timestamp: string
  cwd: string
  parentSession?: string
}

interface SessionEntry {
  type: string
  id?: string
  parentId?: string | null
  timestamp?: string
  [key: string]: unknown
}

export interface SessionSummary {
  id: string
  name: string
  explicitName: boolean
  createdAt: string
  updatedAt: string
  cwd: string
  parentSession: boolean
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  toolCallCount: number
  errorCount: number
  contextTokens?: number
  model?: string
}

export type SessionTimelineItem =
  | { kind: 'message'; id: string; entryId?: string; timestamp?: string; role: 'user' | 'assistant'; text: string; thinking?: string; model?: string; stopReason?: string }
  | { kind: 'tool'; id: string; timestamp?: string; name: string; args?: unknown; output: string; isError: boolean }
  | { kind: 'notice'; id: string; timestamp?: string; noticeType: string; text: string }

export interface SessionDetail {
  summary: SessionSummary
  timeline: SessionTimelineItem[]
  forkPoints: Array<{ entryId: string; text: string; timestamp?: string }>
}

interface ParsedSession {
  path: string
  header: SessionHeader
  entries: SessionEntry[]
  branch: SessionEntry[]
  summary: SessionSummary
}

const MAX_SESSION_BYTES = 50 * 1024 * 1024
const MAX_TOOL_OUTPUT = 20_000

function blocks(content: unknown, type: string, field: string): string {
  if (typeof content === 'string') return type === 'text' ? content : ''
  if (!Array.isArray(content)) return ''
  return content
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => item.type === type && typeof item[field] === 'string')
    .map((item) => item[field] as string)
    .join('')
}

function excerpt(value: string, length = 160): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > length ? `${compact.slice(0, length - 1)}…` : compact
}

function activeBranch(entries: SessionEntry[]): SessionEntry[] {
  const withIds = entries.filter((entry): entry is SessionEntry & { id: string } => typeof entry.id === 'string')
  const leaf = withIds.at(-1)
  if (!leaf) return []
  const byId = new Map(withIds.map((entry) => [entry.id, entry]))
  const result: SessionEntry[] = []
  const seen = new Set<string>()
  let current: SessionEntry | undefined = leaf
  while (current?.id && !seen.has(current.id)) {
    result.push(current)
    seen.add(current.id)
    current = typeof current.parentId === 'string' ? byId.get(current.parentId) : undefined
  }
  return result.reverse()
}

function buildSummary(path: string, header: SessionHeader, entries: SessionEntry[], branch: SessionEntry[], updatedAt: string): SessionSummary {
  let explicitName = ''
  let firstPrompt = ''
  let userMessageCount = 0
  let assistantMessageCount = 0
  let toolCallCount = 0
  let errorCount = 0
  let contextTokens: number | undefined
  let model: string | undefined

  for (const entry of entries) {
    if (entry.type === 'session_info' && typeof entry.name === 'string') explicitName = entry.name.trim()
  }
  for (const entry of branch) {
    if (entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') continue
    const message = entry.message as Record<string, unknown>
    if (message.role === 'user') {
      userMessageCount += 1
      if (!firstPrompt) firstPrompt = excerpt(blocks(message.content, 'text', 'text'))
    } else if (message.role === 'assistant') {
      assistantMessageCount += 1
      if (typeof message.model === 'string') model = message.model
      const usage = message.usage
      if (usage && typeof usage === 'object') {
        const rawUsage = usage as Record<string, unknown>
        const input = typeof rawUsage.input === 'number' ? rawUsage.input : 0
        const cacheRead = typeof rawUsage.cacheRead === 'number' ? rawUsage.cacheRead : 0
        const cacheWrite = typeof rawUsage.cacheWrite === 'number' ? rawUsage.cacheWrite : 0
        const total = input + cacheRead + cacheWrite
        if (total > 0) contextTokens = total
      }
      if (message.stopReason === 'error') errorCount += 1
      if (Array.isArray(message.content)) {
        toolCallCount += message.content.filter((block) => Boolean(block) && typeof block === 'object' && (block as Record<string, unknown>).type === 'toolCall').length
      }
    } else if (message.role === 'toolResult' && message.isError) {
      errorCount += 1
    }
  }

  return {
    id: header.id,
    name: explicitName || firstPrompt || 'Untitled session',
    explicitName: Boolean(explicitName),
    createdAt: header.timestamp,
    updatedAt,
    cwd: header.cwd,
    parentSession: Boolean(header.parentSession),
    messageCount: userMessageCount + assistantMessageCount,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    errorCount,
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(model ? { model } : {}),
  }
}

export class SessionCatalog {
  private readonly root: string

  constructor(root: string, private readonly workspace: string) {
    this.root = resolve(root)
  }

  async list(): Promise<SessionSummary[]> {
    const sessions = await this.scan()
    return sessions.map((session) => session.summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string): Promise<SessionDetail | null> {
    const session = (await this.scan()).find((candidate) => candidate.header.id === id)
    if (!session) return null
    return {
      summary: session.summary,
      timeline: this.timeline(session.branch),
      forkPoints: session.branch.flatMap((entry) => {
        if (entry.type !== 'message' || !entry.id || !entry.message || typeof entry.message !== 'object') return []
        const message = entry.message as Record<string, unknown>
        if (message.role !== 'user') return []
        return [{ entryId: entry.id, text: excerpt(blocks(message.content, 'text', 'text'), 240), timestamp: entry.timestamp }]
      }),
    }
  }

  async pathFor(id: string): Promise<string | null> {
    return (await this.scan()).find((candidate) => candidate.header.id === id)?.path ?? null
  }

  async renameInactive(id: string, name: string): Promise<void> {
    const session = (await this.scan()).find((candidate) => candidate.header.id === id)
    if (!session) throw new Error('Session not found')
    const parentId = session.entries.filter((entry) => typeof entry.id === 'string').at(-1)?.id ?? null
    const entry = {
      type: 'session_info',
      id: randomBytes(4).toString('hex'),
      parentId,
      timestamp: new Date().toISOString(),
      name,
    }
    await appendFile(session.path, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private async scan(): Promise<ParsedSession[]> {
    let files: string[] = []
    try {
      files = await this.findJsonl(this.root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const parsed: ParsedSession[] = []
    for (const path of files) {
      const session = await this.parse(path)
      if (session && resolve(session.header.cwd) === resolve(this.workspace)) parsed.push(session)
    }
    return parsed
  }

  private async findJsonl(directory: string): Promise<string[]> {
    const results: string[] = []
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (!resolve(path).startsWith(`${this.root}${sep}`)) continue
      if (entry.isDirectory()) results.push(...await this.findJsonl(path))
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(path)
    }
    return results
  }

  private async parse(path: string): Promise<ParsedSession | null> {
    try {
      const info = await stat(path)
      if (info.size === 0 || info.size > MAX_SESSION_BYTES) return null
      const source = await readFile(path, 'utf8')
      const records = source.split('\n').filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as SessionHeader | SessionEntry] } catch { return [] }
      })
      const header = records[0]
      if (!header || header.type !== 'session' || !('id' in header) || !('cwd' in header)) return null
      const sessionHeader = header as SessionHeader
      const entries = records.slice(1) as SessionEntry[]
      const branch = activeBranch(entries)
      return {
        path,
        header: sessionHeader,
        entries,
        branch,
        summary: buildSummary(path, sessionHeader, entries, branch, info.mtime.toISOString()),
      }
    } catch {
      return null
    }
  }

  private timeline(branch: SessionEntry[]): SessionTimelineItem[] {
    const timeline: SessionTimelineItem[] = []
    const tools = new Map<string, Extract<SessionTimelineItem, { kind: 'tool' }>>()
    for (const entry of branch) {
      if (entry.type === 'message' && entry.message && typeof entry.message === 'object') {
        const message = entry.message as Record<string, unknown>
        if (message.role === 'user' || message.role === 'assistant') {
          const text = blocks(message.content, 'text', 'text')
          const thinking = blocks(message.content, 'thinking', 'thinking')
          if (text || thinking || message.role === 'user') {
            timeline.push({
              kind: 'message', id: entry.id ?? randomBytes(4).toString('hex'), entryId: entry.id, timestamp: entry.timestamp,
              role: message.role, text, ...(thinking ? { thinking } : {}),
              ...(typeof message.model === 'string' ? { model: message.model } : {}),
              ...(typeof message.stopReason === 'string' ? { stopReason: message.stopReason } : {}),
            })
          }
          if (message.role === 'assistant' && Array.isArray(message.content)) {
            for (const rawBlock of message.content) {
              if (!rawBlock || typeof rawBlock !== 'object') continue
              const block = rawBlock as Record<string, unknown>
              if (block.type !== 'toolCall' || typeof block.id !== 'string') continue
              const tool: Extract<SessionTimelineItem, { kind: 'tool' }> = {
                kind: 'tool', id: block.id, timestamp: entry.timestamp, name: String(block.name ?? 'tool'), args: block.arguments, output: '', isError: false,
              }
              tools.set(block.id, tool)
              timeline.push(tool)
            }
          }
        } else if (message.role === 'toolResult') {
          const id = String(message.toolCallId ?? randomBytes(4).toString('hex'))
          const output = blocks(message.content, 'text', 'text').slice(0, MAX_TOOL_OUTPUT)
          const tool = tools.get(id)
          if (tool) {
            tool.output = output
            tool.isError = Boolean(message.isError)
          } else {
            timeline.push({ kind: 'tool', id, timestamp: entry.timestamp, name: String(message.toolName ?? 'tool'), output, isError: Boolean(message.isError) })
          }
        } else if (message.role === 'bashExecution') {
          timeline.push({ kind: 'tool', id: entry.id ?? randomBytes(4).toString('hex'), timestamp: entry.timestamp, name: 'bash', args: { command: message.command }, output: String(message.output ?? '').slice(0, MAX_TOOL_OUTPUT), isError: Boolean(message.exitCode) })
        }
      } else if (entry.type === 'compaction' || entry.type === 'branch_summary') {
        timeline.push({ kind: 'notice', id: entry.id ?? randomBytes(4).toString('hex'), timestamp: entry.timestamp, noticeType: entry.type, text: String(entry.summary ?? 'Session context summarized') })
      }
    }
    return timeline
  }
}
