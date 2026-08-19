import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WORKER_MODES, type WorkerAdapter, type WorkerBounds, type WorkerMode, type WorkerProviderStatus, type WorkerTask } from './worker-types.js'

const MAX_TASKS = 100
const MAX_PROMPT_LENGTH = 12_000

interface WorkerStore {
  schemaVersion: 1
  tasks: WorkerTask[]
}

export class WorkerError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export interface WorkerCoordinatorOptions {
  storePath: string
  adapter: WorkerAdapter
  bounds: WorkerBounds
  primaryDefaults: () => Promise<{ model?: { provider: string; id: string }; thinkingLevel?: string }>
}

export class WorkerCoordinator extends EventEmitter {
  private tasks: WorkerTask[] = []
  private activeTaskId?: string
  private timer?: NodeJS.Timeout
  private saveChain = Promise.resolve()

  constructor(private readonly options: WorkerCoordinatorOptions) {
    super()
  }

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.options.storePath, 'utf8')) as WorkerStore
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.tasks)) throw new Error('invalid worker store')
      const now = new Date().toISOString()
      this.tasks = parsed.tasks.slice(0, MAX_TASKS).map((task) =>
        task.status === 'queued' || task.status === 'running'
          ? { ...task, status: 'failed', progress: 'Interrupted by a Dashboard restart.', error: 'Dashboard restarted before this task finished.', updatedAt: now, finishedAt: now }
          : task)
      await this.save()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.tasks = []
      }
    }
  }

  snapshot(): { providers: WorkerProviderStatus[]; activeTaskId?: string; tasks: WorkerTask[] } {
    const external: WorkerProviderStatus[] = [
      { id: 'codex-cli', name: 'Codex CLI', description: 'Future optional coding-provider adapter.', kind: 'external', status: 'planned', statusLabel: 'Future optional capability; not configured', modes: [] },
      { id: 'antigravity-cli', name: 'Antigravity CLI', description: 'Future optional coding-provider adapter.', kind: 'external', status: 'planned', statusLabel: 'Future optional capability; not configured', modes: [] },
      { id: 'claude-cli', name: 'Claude CLI', description: 'Future optional coding-provider adapter.', kind: 'external', status: 'planned', statusLabel: 'Future optional capability; not configured', modes: [] },
    ]
    return { providers: [this.options.adapter.provider, ...external], ...(this.activeTaskId ? { activeTaskId: this.activeTaskId } : {}), tasks: this.tasks.map((task) => ({ ...task, changedFiles: [...task.changedFiles] })) }
  }

  get(id: string): WorkerTask | undefined {
    const task = this.tasks.find((candidate) => candidate.id === id)
    return task ? { ...task, changedFiles: [...task.changedFiles] } : undefined
  }

  async start(input: { providerId?: string; mode?: string; prompt?: string; model?: { provider: string; id: string }; thinkingLevel?: string }): Promise<WorkerTask> {
    if (this.activeTaskId) throw new WorkerError('Sub PI is already working on another task', 409)
    if (input.providerId && input.providerId !== this.options.adapter.provider.id) throw new WorkerError('This worker provider is not operational', 409)
    if (!WORKER_MODES.includes(input.mode as WorkerMode)) throw new WorkerError('Choose Research, Review, or Implement mode')
    const prompt = input.prompt?.trim() ?? ''
    if (!prompt) throw new WorkerError('Describe a bounded task for Sub PI')
    if (prompt.length > MAX_PROMPT_LENGTH) throw new WorkerError(`Worker prompts are limited to ${MAX_PROMPT_LENGTH.toLocaleString()} characters`, 413)
    if (this.options.adapter.provider.status !== 'ready') throw new WorkerError(this.options.adapter.provider.statusLabel, 409)

    const now = new Date().toISOString()
    const task: WorkerTask = {
      id: randomUUID(),
      providerId: this.options.adapter.provider.id,
      providerName: this.options.adapter.provider.name,
      mode: input.mode as WorkerMode,
      prompt,
      status: 'queued',
      progress: 'Waiting for the Sub PI process to start.',
      turns: 0,
      bounds: { ...this.options.bounds },
      createdAt: now,
      updatedAt: now,
      changedFiles: [],
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    }
    this.tasks.unshift(task)
    this.tasks = this.tasks.slice(0, MAX_TASKS)
    this.activeTaskId = task.id
    await this.save()
    this.emit('changed', task)
    void this.execute(task)
    return { ...task, changedFiles: [] }
  }

  async cancel(id: string): Promise<WorkerTask> {
    const task = this.tasks.find((candidate) => candidate.id === id)
    if (!task) throw new WorkerError('Worker task not found', 404)
    if (this.activeTaskId !== id || (task.status !== 'queued' && task.status !== 'running')) throw new WorkerError('This worker task is not running', 409)
    await this.options.adapter.cancel(id)
    await this.finish(task, 'cancelled', { progress: 'Cancelled by the user.' })
    return { ...task, changedFiles: [...task.changedFiles] }
  }

  async shutdown(): Promise<void> {
    if (!this.activeTaskId) return
    await this.options.adapter.cancel(this.activeTaskId).catch(() => undefined)
  }

  private async execute(task: WorkerTask): Promise<void> {
    try {
      const defaults = await this.options.primaryDefaults()
      await this.update(task, { status: 'running', progress: 'Sub PI started in a separate saved session.', startedAt: new Date().toISOString() })
      this.timer = setTimeout(() => {
        if (this.activeTaskId !== task.id) return
        void this.options.adapter.cancel(task.id).finally(() =>
          this.finish(task, 'timed-out', { progress: 'Stopped at the configured runtime limit.', error: 'Worker runtime limit reached.' }))
      }, task.bounds.timeoutMs)
      const output = await this.options.adapter.run({
        taskId: task.id,
        mode: task.mode,
        prompt: task.prompt,
        bounds: task.bounds,
        ...defaults,
        ...(task.model ? { model: task.model } : {}),
        ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
      }, {
        onSession: (sessionId) => this.update(task, { sessionId }),
        onProgress: (progress, turns) => this.update(task, { progress, turns }),
      })
      if (this.activeTaskId !== task.id) return
      await this.finish(task, 'completed', {
        progress: 'Sub PI finished. Primary PI remains responsible for review.',
        result: output.result,
        resultTruncated: output.resultTruncated,
        changedFiles: output.changedFiles,
      })
    } catch (error) {
      if (this.activeTaskId !== task.id) return
      const message = error instanceof Error ? error.message : 'Sub PI failed'
      await this.finish(task, 'failed', { progress: 'Sub PI could not complete the task.', error: message })
    }
  }

  private async update(task: WorkerTask, patch: Partial<WorkerTask>): Promise<void> {
    if (!this.tasks.includes(task)) return
    Object.assign(task, patch, { updatedAt: new Date().toISOString() })
    await this.save()
    this.emit('changed', task)
  }

  private async finish(task: WorkerTask, status: WorkerTask['status'], patch: Partial<WorkerTask>): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (this.activeTaskId === task.id) this.activeTaskId = undefined
    await this.update(task, { ...patch, status, finishedAt: new Date().toISOString() })
  }

  private async save(): Promise<void> {
    const operation = this.saveChain.then(() => this.saveDirect(), () => this.saveDirect())
    this.saveChain = operation.catch(() => undefined)
    return operation
  }

  private async saveDirect(): Promise<void> {
    await mkdir(dirname(this.options.storePath), { recursive: true })
    const temporary = `${this.options.storePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, tasks: this.tasks }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.options.storePath)
  }
}
