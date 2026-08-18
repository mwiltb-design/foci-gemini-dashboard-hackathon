import { mkdir, open, readFile, rename, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export type ActivityCategory = 'session' | 'tool' | 'skill' | 'board' | 'cron' | 'error' | 'system'
export type ActivitySeverity = 'info' | 'warning' | 'error'

export interface ActivityEvent {
  id: string
  timestamp: string
  category: ActivityCategory
  type: string
  severity: ActivitySeverity
  summary: string
  sessionId?: string
  runId?: string
  correlationId?: string
  data?: Record<string, string | number | boolean | null>
}

export interface ActivityInput extends Omit<ActivityEvent, 'id' | 'timestamp'> {
  timestamp?: string
}

export interface ActivityQuery {
  category?: ActivityCategory
  sessionId?: string
  severity?: ActivitySeverity
  limit?: number
}

export class ActivityStore {
  private events: ActivityEvent[] = []
  private writeChain = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly memoryLimit = 2_000,
    private readonly maxBytes = 5 * 1024 * 1024,
  ) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    try {
      const source = await readFile(this.path, 'utf8')
      this.events = source.split('\n').filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line) as ActivityEvent] } catch { return [] }
      }).slice(-this.memoryLimit)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  record(input: ActivityInput): ActivityEvent {
    const event: ActivityEvent = {
      ...input,
      id: randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      summary: input.summary.slice(0, 500),
    }
    this.events.push(event)
    if (this.events.length > this.memoryLimit) this.events.splice(0, this.events.length - this.memoryLimit)
    this.writeChain = this.writeChain.then(() => this.append(event)).catch((error) => {
      console.error(`Unable to persist dashboard activity: ${error instanceof Error ? error.message : String(error)}`)
    })
    return event
  }

  query(query: ActivityQuery = {}): ActivityEvent[] {
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500))
    return this.events
      .filter((event) => !query.category || event.category === query.category)
      .filter((event) => !query.sessionId || event.sessionId === query.sessionId)
      .filter((event) => !query.severity || event.severity === query.severity)
      .slice(-limit)
      .reverse()
  }

  async flush(): Promise<void> {
    await this.writeChain
  }

  private async append(event: ActivityEvent): Promise<void> {
    try {
      const info = await stat(this.path)
      if (info.size >= this.maxBytes) {
        await rename(this.path, `${this.path}.1`).catch(() => undefined)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const file = await open(this.path, 'a')
    try {
      await file.appendFile(`${JSON.stringify(event)}\n`, 'utf8')
    } finally {
      await file.close()
    }
  }
}
