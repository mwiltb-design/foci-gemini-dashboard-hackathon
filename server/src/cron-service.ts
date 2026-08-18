import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Cron } from 'croner'
import { attachJsonlReader } from './jsonl.js'
import { processGroupOptions, terminateProcess } from './process-control.js'

export type CronAccess = 'read-only' | 'workspace-write'
export type CronRunStatus = 'running' | 'success' | 'error' | 'timed-out' | 'cancelled'

export interface CronJob {
  id: string
  name: string
  prompt: string
  schedule: string
  timezone: string
  enabled: boolean
  access: CronAccess
  timeoutMinutes: number
  createdAt: string
  updatedAt: string
}

export interface CronRun {
  id: string
  jobId: string
  jobName: string
  trigger: 'schedule' | 'manual'
  status: CronRunStatus
  startedAt: string
  finishedAt?: string
  output?: string
  error?: string
  sessionId?: string
}

interface CronDocument {
  version: 1
  workspace: string
  updatedAt: string
  jobs: CronJob[]
  runs: CronRun[]
}

export interface CronJobView extends CronJob {
  nextRunAt?: string
  lastRun?: CronRun
  running: boolean
}

export interface CronSnapshot {
  workspace: string
  updatedAt: string
  jobs: CronJobView[]
  runs: CronRun[]
}

export interface CronJobInput {
  name?: unknown
  prompt?: unknown
  schedule?: unknown
  timezone?: unknown
  enabled?: unknown
  access?: unknown
  timeoutMinutes?: unknown
}

export interface CronExecutionResult {
  status: Exclude<CronRunStatus, 'running'>
  output?: string
  error?: string
  sessionId?: string
}

export interface CronRunner {
  run(job: CronJob, runId: string): Promise<CronExecutionResult>
  stop(runId: string): boolean
  stopAll(): void
}

export class CronError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const MAX_RUNS = 100
const MAX_OUTPUT = 20_000
const MAX_ERROR = 2_000
const MIN_INTERVAL_MS = 5 * 60 * 1_000

function text(value: unknown, field: string, maximum: number, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new CronError(`${field} must be text`)
  const result = value.trim()
  if (required && !result) throw new CronError(`${field} is required`)
  if (result.length > maximum) throw new CronError(`${field} must be ${maximum} characters or fewer`)
  return result
}

function timezone(value: unknown): string {
  const result = text(value, 'Timezone', 100, true)
  try { new Intl.DateTimeFormat('en-US', { timeZone: result }).format() } catch { throw new CronError('Timezone must be a valid IANA timezone such as America/Denver') }
  return result
}

export function validateSchedule(value: unknown, zone: string): string {
  const schedule = text(value, 'Schedule', 100, true).replace(/\s+/g, ' ')
  if (schedule.split(' ').length !== 5) throw new CronError('Schedule must use the standard five-field cron format')
  try {
    const evaluator = new Cron(schedule, { timezone: zone, paused: true })
    const upcoming = evaluator.nextRuns(12)
    evaluator.stop()
    if (upcoming.length < 2) throw new CronError('Schedule does not have enough future runs')
    for (let index = 1; index < upcoming.length; index += 1) {
      if (upcoming[index].getTime() - upcoming[index - 1].getTime() < MIN_INTERVAL_MS) throw new CronError('Scheduled jobs must run at least five minutes apart')
    }
  } catch (error) {
    if (error instanceof CronError) throw error
    throw new CronError(`Invalid cron schedule: ${error instanceof Error ? error.message : String(error)}`)
  }
  return schedule
}

function access(value: unknown): CronAccess {
  if (value !== 'read-only' && value !== 'workspace-write') throw new CronError('Access must be read-only or workspace-write')
  return value
}

function timeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 30) throw new CronError('Timeout must be a whole number from 1 to 30 minutes')
  return value
}

function enabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new CronError('Enabled must be true or false')
  return value
}

function validJob(value: unknown): value is CronJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<CronJob>
  return typeof job.id === 'string' && typeof job.name === 'string' && typeof job.prompt === 'string'
    && typeof job.schedule === 'string' && typeof job.timezone === 'string' && typeof job.enabled === 'boolean'
    && (job.access === 'read-only' || job.access === 'workspace-write') && typeof job.timeoutMinutes === 'number'
    && typeof job.createdAt === 'string' && typeof job.updatedAt === 'string'
}

function validRun(value: unknown): value is CronRun {
  if (!value || typeof value !== 'object') return false
  const run = value as Partial<CronRun>
  return typeof run.id === 'string' && typeof run.jobId === 'string' && typeof run.jobName === 'string'
    && (run.trigger === 'schedule' || run.trigger === 'manual')
    && ['running', 'success', 'error', 'timed-out', 'cancelled'].includes(String(run.status))
    && typeof run.startedAt === 'string'
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as { role?: unknown; content?: unknown }
  if (record.role !== 'assistant') return ''
  const content = record.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : []).join('\n')
}

export class PiCronRunner implements CronRunner {
  private processes = new Map<string, { child: ChildProcess; reason?: 'timed-out' | 'cancelled' | 'output-limit' }>()

  constructor(private readonly workspace: string, private readonly command = 'pi') {}

  run(job: CronJob, runId: string): Promise<CronExecutionResult> {
    const tools = job.access === 'read-only' ? 'read,grep,find,ls' : 'read,bash,edit,write'
    const args = ['--mode', 'json', '--no-extensions', '--name', `Scheduled: ${job.name}`, '--tools', tools]

    return new Promise((resolve) => {
      let output = ''
      let stderr = ''
      let stdoutBytes = 0
      let sessionId: string | undefined
      let settled = false
      const childEnv: NodeJS.ProcessEnv = { ...process.env, PI_SKIP_VERSION_CHECK: '1', GIT_TERMINAL_PROMPT: '0' }
      delete childEnv.PI_DASHBOARD_AUTH_TOKEN
      const child = spawn(this.command, args, {
        cwd: this.workspace,
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...processGroupOptions(),
      })
      this.processes.set(runId, { child })

      attachJsonlReader(child.stdout, (line) => {
        try {
          const event = JSON.parse(line) as { type?: string; id?: string; message?: unknown }
          if (event.type === 'session' && typeof event.id === 'string') sessionId = event.id
          if (event.type === 'message_end') {
            const next = assistantText(event.message)
            if (next) output = next.slice(-MAX_OUTPUT)
          }
        } catch {
          // Ignore malformed output here; a failed process still reports stderr/exit status.
        }
      })
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        const active = this.processes.get(runId)
        if (stdoutBytes > 10 * 1024 * 1024 && active && !active.reason) {
          active.reason = 'output-limit'
          terminateProcess(active.child, 'SIGTERM')
          setTimeout(() => terminateProcess(active.child, 'SIGKILL'), 2_000).unref()
        }
      })
      child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-MAX_ERROR) })

      const finish = (result: CronExecutionResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.processes.delete(runId)
        resolve({ ...result, sessionId, output: output || result.output })
      }
      const timer = setTimeout(() => {
        const active = this.processes.get(runId)
        if (!active) return
        active.reason = 'timed-out'
        terminateProcess(active.child, 'SIGTERM')
        setTimeout(() => terminateProcess(active.child, 'SIGKILL'), 2_000).unref()
      }, job.timeoutMinutes * 60 * 1_000)
      timer.unref()

      child.stdin.on('error', (error) => { stderr = `${stderr}\nUnable to send prompt: ${error.message}`.slice(-MAX_ERROR) })
      child.stdin.end(job.prompt)
      child.once('error', (error) => finish({ status: 'error', error: error.message }))
      child.once('close', (code, signal) => {
        const reason = this.processes.get(runId)?.reason
        if (reason) finish({
          status: reason === 'output-limit' ? 'error' : reason,
          error: reason === 'timed-out' ? `Run exceeded ${job.timeoutMinutes} minute timeout` : reason === 'output-limit' ? 'Run exceeded the 10 MB event-stream limit' : 'Run stopped by user',
        })
        else if (code === 0) finish({ status: 'success', output: output || 'Run completed without a text response.' })
        else finish({ status: 'error', error: (stderr.trim() || `Pi exited with ${signal ?? `code ${code ?? 'unknown'}`}`).slice(-MAX_ERROR) })
      })
    })
  }

  stop(runId: string): boolean {
    const active = this.processes.get(runId)
    if (!active) return false
    active.reason = 'cancelled'
    terminateProcess(active.child, 'SIGTERM')
    setTimeout(() => terminateProcess(active.child, 'SIGKILL'), 2_000).unref()
    return true
  }

  stopAll(): void {
    for (const runId of this.processes.keys()) this.stop(runId)
  }
}

export class CronService extends EventEmitter {
  private document: CronDocument
  private schedules = new Map<string, Cron>()
  private mutationChain = Promise.resolve()
  private active = new Map<string, Promise<void>>()

  constructor(private readonly path: string, workspace: string, private readonly runner: CronRunner = new PiCronRunner(workspace)) {
    super()
    this.document = { version: 1, workspace, updatedAt: new Date(0).toISOString(), jobs: [], runs: [] }
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<CronDocument>
      if (parsed.version !== 1 || parsed.workspace !== this.document.workspace || !Array.isArray(parsed.jobs) || !parsed.jobs.every(validJob) || !Array.isArray(parsed.runs) || !parsed.runs.every(validRun)) {
        throw new CronError('Stored cron data is invalid', 500)
      }
      this.document = parsed as CronDocument
      for (const job of this.document.jobs) {
        const zone = timezone(job.timezone)
        validateSchedule(job.schedule, zone)
        access(job.access)
        timeout(job.timeoutMinutes)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    let repaired = false
    for (const run of this.document.runs) {
      if (run.status === 'running') {
        run.status = 'error'; run.finishedAt = new Date().toISOString(); run.error = 'Dashboard restarted before this run completed'; repaired = true
      }
    }
    if (repaired) {
      this.document.updatedAt = new Date().toISOString()
      await this.persist()
    }
    this.rescheduleAll()
  }

  get(): CronSnapshot {
    const runs = [...this.document.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return {
      workspace: this.document.workspace,
      updatedAt: this.document.updatedAt,
      jobs: this.document.jobs.map((job) => ({
        ...job,
        nextRunAt: job.enabled ? this.nextRun(job)?.toISOString() : undefined,
        lastRun: runs.find((run) => run.jobId === job.id),
        running: runs.some((run) => run.jobId === job.id && run.status === 'running'),
      })),
      runs,
    }
  }

  create(input: CronJobInput): Promise<CronSnapshot> {
    return this.mutate(() => {
      const zone = timezone(input.timezone)
      const now = new Date().toISOString()
      this.document.jobs.push({
        id: randomUUID(), name: text(input.name, 'Name', 100, true), prompt: text(input.prompt, 'Prompt', 20_000, true),
        schedule: validateSchedule(input.schedule, zone), timezone: zone,
        enabled: input.enabled === undefined ? false : enabled(input.enabled),
        access: input.access === undefined ? 'read-only' : access(input.access),
        timeoutMinutes: input.timeoutMinutes === undefined ? 10 : timeout(input.timeoutMinutes),
        createdAt: now, updatedAt: now,
      })
    }, true)
  }

  update(id: string, input: CronJobInput, expectedUpdatedAt: string): Promise<CronSnapshot> {
    return this.mutate(() => {
      const job = this.job(id)
      if (this.isRunning(id)) throw new CronError('Stop the active run before editing this job', 409)
      if (job.updatedAt !== expectedUpdatedAt) throw new CronError('This scheduled job changed in another browser. Refresh and try again.', 409)
      const zone = input.timezone === undefined ? job.timezone : timezone(input.timezone)
      const schedule = input.schedule === undefined ? job.schedule : text(input.schedule, 'Schedule', 100, true)
      job.name = input.name === undefined ? job.name : text(input.name, 'Name', 100, true)
      job.prompt = input.prompt === undefined ? job.prompt : text(input.prompt, 'Prompt', 20_000, true)
      job.schedule = validateSchedule(schedule, zone)
      job.timezone = zone
      if (input.enabled !== undefined) job.enabled = enabled(input.enabled)
      if (input.access !== undefined) job.access = access(input.access)
      if (input.timeoutMinutes !== undefined) job.timeoutMinutes = timeout(input.timeoutMinutes)
      job.updatedAt = this.nextTimestamp(job.updatedAt)
    }, true)
  }

  remove(id: string, expectedUpdatedAt: string): Promise<CronSnapshot> {
    return this.mutate(() => {
      if (this.isRunning(id)) throw new CronError('Stop the active run before deleting this job', 409)
      const index = this.document.jobs.findIndex((job) => job.id === id)
      if (index < 0) throw new CronError('Scheduled job not found', 404)
      if (this.document.jobs[index].updatedAt !== expectedUpdatedAt) throw new CronError('This scheduled job changed in another browser. Refresh and try again.', 409)
      this.document.jobs.splice(index, 1)
      this.document.runs = this.document.runs.filter((run) => run.jobId !== id)
    }, true)
  }

  async runNow(id: string): Promise<CronSnapshot> {
    const { job, run } = await this.beginRun(id, 'manual')
    this.launch(job, run)
    return this.get()
  }

  stopRun(id: string): Promise<CronSnapshot> {
    const run = this.document.runs.find((candidate) => candidate.jobId === id && candidate.status === 'running')
    if (!run || !this.runner.stop(run.id)) throw new CronError('No active run found for this job', 409)
    return Promise.resolve(this.get())
  }

  async shutdown(): Promise<void> {
    for (const schedule of this.schedules.values()) schedule.stop()
    this.schedules.clear()
    this.runner.stopAll()
    await Promise.allSettled(this.active.values())
    await this.mutationChain
  }

  private async beginRun(id: string, trigger: CronRun['trigger']): Promise<{ job: CronJob; run: CronRun }> {
    let selected!: CronJob
    let created!: CronRun
    await this.mutate(() => {
      const job = this.job(id)
      if (this.isRunning(id)) throw new CronError('This job already has an active run', 409)
      selected = structuredClone(job)
      created = { id: randomUUID(), jobId: job.id, jobName: job.name, trigger, status: 'running', startedAt: new Date().toISOString() }
      this.document.runs.push(created)
      if (this.document.runs.length > MAX_RUNS) this.document.runs.splice(0, this.document.runs.length - MAX_RUNS)
    })
    return { job: selected, run: created }
  }

  private launch(job: CronJob, run: CronRun): void {
    const execution = (async () => {
      let result: CronExecutionResult
      try {
        result = await this.runner.run(job, run.id)
      } catch (error) {
        result = { status: 'error', error: error instanceof Error ? error.message : 'Scheduled run failed' }
      }
      await this.mutate(() => {
        const stored = this.document.runs.find((candidate) => candidate.id === run.id)
        if (!stored) return
        stored.status = result.status
        stored.finishedAt = new Date().toISOString()
        stored.output = result.output?.slice(-MAX_OUTPUT)
        stored.error = result.error?.slice(-MAX_ERROR)
        stored.sessionId = result.sessionId
      })
      const finished = this.document.runs.find((candidate) => candidate.id === run.id)
      if (finished) this.emit('runFinished', { job: structuredClone(job), run: structuredClone(finished) })
    })().catch((error) => { this.emit('schedulerError', error) }).finally(() => { this.active.delete(run.id) })
    this.active.set(run.id, execution)
  }

  private scheduled(id: string): void {
    void this.beginRun(id, 'schedule').then(({ job, run }) => this.launch(job, run)).catch((error) => {
      if (!(error instanceof CronError && error.status === 409)) this.emit('schedulerError', error)
    })
  }

  private rescheduleAll(): void {
    for (const schedule of this.schedules.values()) schedule.stop()
    this.schedules.clear()
    for (const job of this.document.jobs) {
      if (!job.enabled) continue
      const schedule = new Cron(job.schedule, { timezone: job.timezone, protect: true, catch: (error) => this.emit('schedulerError', error), unref: true }, () => this.scheduled(job.id))
      this.schedules.set(job.id, schedule)
    }
  }

  private nextRun(job: CronJob): Date | null {
    try {
      const existing = this.schedules.get(job.id)
      if (existing) return existing.nextRun()
      const evaluator = new Cron(job.schedule, { timezone: job.timezone, paused: true })
      const next = evaluator.nextRun(); evaluator.stop(); return next
    } catch { return null }
  }

  private job(id: string): CronJob {
    const job = this.document.jobs.find((candidate) => candidate.id === id)
    if (!job) throw new CronError('Scheduled job not found', 404)
    return job
  }

  private isRunning(id: string): boolean {
    return this.document.runs.some((run) => run.jobId === id && run.status === 'running')
  }

  private nextTimestamp(previous: string): string {
    const now = Date.now()
    return new Date(Math.max(now, Date.parse(previous) + 1)).toISOString()
  }

  private mutate(change: () => void, reschedule = false): Promise<CronSnapshot> {
    const operation = this.mutationChain.then(async () => {
      const previous = structuredClone(this.document)
      try {
        change()
        this.document.updatedAt = new Date().toISOString()
        await this.persist()
        if (reschedule) this.rescheduleAll()
        const snapshot = this.get()
        this.emit('changed', snapshot)
        return snapshot
      } catch (error) {
        this.document = previous
        throw error
      }
    })
    this.mutationChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async persist(): Promise<void> {
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }
}
