import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WORKER_MODES, type WorkerAdapter, type WorkerBounds, type WorkerConfiguration, type WorkerMode, type WorkerProviderStatus, type WorkerRuleFile, type WorkerTask } from './worker-types.js'
import type { WorkerRulesService } from './worker-rules.js'

const ACTIVE_TASK_LIMIT = 15
const MAX_ARCHIVE_TASKS = 500
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

export function resolveEnabledWorkerProviders(): { allowedIds: string[] | undefined; isCloudMode: boolean } {
  const envFilter = process.env.FOCI_ENABLED_WORKERS?.trim()
  if (envFilter) {
    if (envFilter === '*' || envFilter.toLowerCase() === 'all') {
      return { allowedIds: undefined, isCloudMode: false }
    }

    const list = envFilter.split(',').map((id) => id.trim()).filter(Boolean)
    if (list.length > 0) {
      return { allowedIds: list, isCloudMode: true }
    }
  }

  const isCloudRun = Boolean(process.env.K_SERVICE)
  const isGeminiProvider = (process.env.FOCI_AGENT_PROVIDER ?? process.env.PI_DASHBOARD_AGENT_PROVIDER ?? '').toLowerCase() === 'gemini'

  if (isCloudRun || isGeminiProvider) {
    return {
      allowedIds: ['codex-cli', 'gemini-worker', 'antigravity-cli'],
      isCloudMode: true,
    }
  }

  return { allowedIds: undefined, isCloudMode: false }
}

export interface WorkerCoordinatorOptions {
  storePath: string
  archivePath: string
  adapters: WorkerAdapter[]
  rulesService: WorkerRulesService
  bounds: WorkerBounds
  defaultProviderId?: string
  allowedProviderIds?: string[]
  primaryDefaults: () => Promise<{ model?: { provider: string; id: string }; thinkingLevel?: string }>
}

export class WorkerCoordinator extends EventEmitter {
  private tasks: WorkerTask[] = []
  private archivedTasks: WorkerTask[] = []
  private activeTaskId?: string
  private activeAdapter?: WorkerAdapter
  private timer?: NodeJS.Timeout
  private saveChain = Promise.resolve()

  constructor(private readonly options: WorkerCoordinatorOptions) {
    super()
  }

  get allowedProviderIds(): string[] | undefined {
    return this.options.allowedProviderIds
  }

  get isFiltered(): boolean {
    return Boolean(this.allowedProviderIds && this.allowedProviderIds.length < this.options.adapters.length)
  }

  async initialize(): Promise<void> {
    await this.options.rulesService.initialize()

    // 1. Load active tasks
    try {
      const parsed = JSON.parse(await readFile(this.options.storePath, 'utf8')) as WorkerStore
      if (parsed?.schemaVersion === 1 && Array.isArray(parsed.tasks)) {
        const now = new Date().toISOString()
        this.tasks = parsed.tasks.map((task) =>
          task.status === 'queued' || task.status === 'running'
            ? { ...task, status: 'failed', progress: 'Interrupted by a Dashboard restart.', error: 'Dashboard restarted before this task finished.', updatedAt: now, finishedAt: now }
            : task)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.tasks = []
      }
    }

    // 2. Load archived tasks
    try {
      const parsedArchive = JSON.parse(await readFile(this.options.archivePath, 'utf8')) as WorkerStore
      if (parsedArchive?.schemaVersion === 1 && Array.isArray(parsedArchive.tasks)) {
        this.archivedTasks = parsedArchive.tasks.map((t) => ({ ...t, archived: true }))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.archivedTasks = []
      }
    }

    // 3. Enforce 15 task retention rule
    this.enforceRetentionLimit()
    await this.save()
  }

  getAdapter(providerId: string): WorkerAdapter | undefined {
    if (this.allowedProviderIds && !this.allowedProviderIds.includes(providerId)) {
      return undefined
    }
    return this.options.adapters.find((candidate) => candidate.provider.id === providerId)
  }

  get archivedCount(): number {
    return this.archivedTasks.length
  }

  get archivePath(): string {
    return this.options.archivePath
  }

  async snapshot(): Promise<{
    providers: WorkerProviderStatus[]
    activeTaskId?: string
    tasks: WorkerTask[]
    archivedCount: number
    archivePath: string
    configuration: WorkerConfiguration
    rules: WorkerRuleFile[]
    isFiltered?: boolean
    profileLabel?: string
  }> {
    const config = await this.options.rulesService.loadConfig()
    const rules = await this.options.rulesService.listRules()

    const visibleAdapters = this.allowedProviderIds
      ? this.options.adapters.filter((adapter) => this.allowedProviderIds!.includes(adapter.provider.id))
      : this.options.adapters

    const providers: WorkerProviderStatus[] = visibleAdapters.map((adapter) => {
      const p = adapter.provider
      const isEnabled = config.providersEnabled[p.id] !== false
      return {
        ...p,
        enabled: isEnabled,
        status: isEnabled ? p.status : 'disabled',
        statusLabel: isEnabled ? p.statusLabel : 'Disabled in configuration',
      }
    })

    return {
      providers,
      ...(this.activeTaskId ? { activeTaskId: this.activeTaskId } : {}),
      tasks: this.tasks.map((task) => ({ ...task, changedFiles: [...task.changedFiles] })),
      archivedCount: this.archivedTasks.length,
      archivePath: this.options.archivePath,
      configuration: config,
      rules,
      ...(this.isFiltered ? { isFiltered: true, profileLabel: 'Codex / Gemini / Antigravity Cloud Profile' } : {}),
    }
  }

  get(id: string): WorkerTask | undefined {
    const task = this.tasks.find((candidate) => candidate.id === id) ?? this.archivedTasks.find((candidate) => candidate.id === id)
    return task ? { ...task, changedFiles: [...task.changedFiles] } : undefined
  }

  getArchivedTasks(): WorkerTask[] {
    return this.archivedTasks.map((task) => ({ ...task, archived: true, changedFiles: [...task.changedFiles] }))
  }

  async archiveTask(id: string): Promise<boolean> {
    const index = this.tasks.findIndex((t) => t.id === id)
    if (index === -1) return false
    if (this.activeTaskId === id) throw new WorkerError('Cannot archive an active running task', 409)

    const [task] = this.tasks.splice(index, 1)
    if (task) {
      task.archived = true
      // Prepend to archive, avoiding duplicate IDs
      this.archivedTasks = [task, ...this.archivedTasks.filter((t) => t.id !== task.id)].slice(0, MAX_ARCHIVE_TASKS)
      await this.save()
      this.emit('changed')
      return true
    }
    return false
  }

  async archiveAllCompleted(): Promise<number> {
    const toKeep: WorkerTask[] = []
    const toArchive: WorkerTask[] = []

    for (const task of this.tasks) {
      if (task.id === this.activeTaskId || task.status === 'running' || task.status === 'queued') {
        toKeep.push(task)
      } else {
        toArchive.push({ ...task, archived: true })
      }
    }

    if (toArchive.length === 0) return 0

    this.tasks = toKeep
    const existingIds = new Set(this.archivedTasks.map((t) => t.id))
    for (const t of toArchive) {
      if (!existingIds.has(t.id)) {
        this.archivedTasks.unshift(t)
        existingIds.add(t.id)
      }
    }
    this.archivedTasks = this.archivedTasks.slice(0, MAX_ARCHIVE_TASKS)

    await this.save()
    this.emit('changed')
    return toArchive.length
  }

  async restoreTask(id: string): Promise<boolean> {
    const index = this.archivedTasks.findIndex((t) => t.id === id)
    if (index === -1) return false

    const [task] = this.archivedTasks.splice(index, 1)
    if (task) {
      task.archived = false
      this.tasks.unshift(task)
      this.enforceRetentionLimit()
      await this.save()
      this.emit('changed', task)
      return true
    }
    return false
  }

  private enforceRetentionLimit(): boolean {
    if (this.tasks.length <= ACTIVE_TASK_LIMIT) return false

    const keep: WorkerTask[] = []
    const toArchive: WorkerTask[] = []

    for (const task of this.tasks) {
      if (keep.length < ACTIVE_TASK_LIMIT || task.id === this.activeTaskId || task.status === 'running' || task.status === 'queued') {
        keep.push(task)
      } else {
        toArchive.push({ ...task, archived: true })
      }
    }

    if (toArchive.length > 0) {
      this.tasks = keep
      const existingIds = new Set(this.archivedTasks.map((t) => t.id))
      for (const t of toArchive) {
        if (!existingIds.has(t.id)) {
          this.archivedTasks.unshift(t)
          existingIds.add(t.id)
        }
      }
      this.archivedTasks = this.archivedTasks.slice(0, MAX_ARCHIVE_TASKS)
      return true
    }
    return false
  }

  async start(input: {
    providerId?: string
    mode?: string
    prompt?: string
    bounds?: Partial<WorkerBounds>
    model?: { provider: string; id: string }
    thinkingLevel?: string
  }): Promise<WorkerTask> {
    if (this.activeTaskId) throw new WorkerError('A worker is already executing another task', 409)

    const defaultProvider = this.options.defaultProviderId || (this.allowedProviderIds?.[0] ?? 'sub-pi')
    const providerId = input.providerId || defaultProvider
    const adapter = this.getAdapter(providerId)
    if (!adapter) throw new WorkerError(`Worker provider '${providerId}' is not available`, 404)

    const config = await this.options.rulesService.loadConfig()
    if (config.providersEnabled[providerId] === false) {
      throw new WorkerError(`Worker provider '${adapter.provider.name}' is currently disabled`, 403)
    }

    if (adapter.provider.status !== 'ready') {
      throw new WorkerError(adapter.provider.statusLabel || `Worker '${adapter.provider.name}' is not ready`, 409)
    }

    if (!WORKER_MODES.includes(input.mode as WorkerMode)) throw new WorkerError('Choose Research, Review, or Implement mode')
    const mode = input.mode as WorkerMode
    if (!adapter.provider.modes.includes(mode)) {
      throw new WorkerError(`${adapter.provider.name} does not support ${mode} mode`, 400)
    }

    const prompt = input.prompt?.trim() ?? ''
    if (!prompt) throw new WorkerError('Describe a bounded task for the worker')
    if (prompt.length > MAX_PROMPT_LENGTH) throw new WorkerError(`Worker prompts are limited to ${MAX_PROMPT_LENGTH.toLocaleString()} characters`, 413)

    const computedBounds: WorkerBounds = {
      turnLimit: Math.min(30, Math.max(1, input.bounds?.turnLimit ?? config.defaultBounds.turnLimit ?? this.options.bounds.turnLimit)),
      timeoutMs: Math.min(30 * 60_000, Math.max(60_000, input.bounds?.timeoutMs ?? config.defaultBounds.timeoutMs ?? this.options.bounds.timeoutMs)),
      resultLimitBytes: Math.min(64 * 1024, Math.max(1024, input.bounds?.resultLimitBytes ?? config.defaultBounds.resultLimitBytes ?? this.options.bounds.resultLimitBytes)),
    }

    const now = new Date().toISOString()
    const task: WorkerTask = {
      id: randomUUID(),
      providerId: adapter.provider.id,
      providerName: adapter.provider.name,
      mode,
      prompt,
      status: 'queued',
      progress: `Waiting for ${adapter.provider.name} to start.`,
      turns: 0,
      bounds: computedBounds,
      createdAt: now,
      updatedAt: now,
      changedFiles: [],
      archived: false,
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    }

    this.tasks.unshift(task)
    this.enforceRetentionLimit()
    this.activeTaskId = task.id
    this.activeAdapter = adapter
    await this.save()
    this.emit('changed', task)
    void this.execute(task, adapter)
    return { ...task, changedFiles: [] }
  }

  async cancel(id: string): Promise<WorkerTask> {
    const task = this.tasks.find((candidate) => candidate.id === id)
    if (!task) throw new WorkerError('Worker task not found', 404)
    if (this.activeTaskId !== id || (task.status !== 'queued' && task.status !== 'running')) throw new WorkerError('This worker task is not running', 409)
    if (this.activeAdapter) {
      await this.activeAdapter.cancel(id)
    }
    await this.finish(task, 'cancelled', { progress: 'Cancelled by the user.' })
    return { ...task, changedFiles: [...task.changedFiles] }
  }

  async shutdown(): Promise<void> {
    if (!this.activeTaskId || !this.activeAdapter) return
    await this.activeAdapter.cancel(this.activeTaskId).catch(() => undefined)
  }

  private async execute(task: WorkerTask, adapter: WorkerAdapter): Promise<void> {
    try {
      const defaults = await this.options.primaryDefaults()
      const ruleContext = await this.options.rulesService.getInjectedRulesForWorker(adapter.provider.id)

      await this.update(task, {
        status: 'running',
        progress: `${adapter.provider.name} started task in mode ${task.mode}.`,
        startedAt: new Date().toISOString(),
      })

      this.timer = setTimeout(() => {
        if (this.activeTaskId !== task.id) return
        void adapter.cancel(task.id).finally(() =>
          this.finish(task, 'timed-out', { progress: 'Stopped at the configured runtime limit.', error: 'Worker runtime limit reached.' }))
      }, task.bounds.timeoutMs)

      const output = await adapter.run({
        taskId: task.id,
        providerId: adapter.provider.id,
        mode: task.mode,
        prompt: task.prompt,
        bounds: task.bounds,
        ruleContext,
        ...defaults,
        ...(task.model ? { model: task.model } : {}),
        ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
      }, {
        onSession: (sessionId) => this.update(task, { sessionId }),
        onProgress: (progress, turns) => this.update(task, { progress, turns }),
      })

      if (this.activeTaskId !== task.id) return
      await this.finish(task, 'completed', {
        progress: `${adapter.provider.name} completed successfully. Primary PI remains responsible for review.`,
        result: output.result,
        resultTruncated: output.resultTruncated,
        changedFiles: output.changedFiles,
        resultEnvelope: output.resultEnvelope,
      })
    } catch (error) {
      if (this.activeTaskId !== task.id) return
      const message = error instanceof Error ? error.message : `${adapter.provider.name} failed`
      await this.finish(task, 'failed', { progress: `${adapter.provider.name} could not complete the task.`, error: message })
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
    if (this.activeTaskId === task.id) {
      this.activeTaskId = undefined
      this.activeAdapter = undefined
    }
    Object.assign(task, patch, { status, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    this.enforceRetentionLimit()
    await this.save()
    this.emit('changed', task)
  }

  private async save(): Promise<void> {
    const operation = this.saveChain.then(() => this.saveDirect(), () => this.saveDirect())
    this.saveChain = operation.catch(() => undefined)
    return operation
  }

  private async saveDirect(): Promise<void> {
    await mkdir(dirname(this.options.storePath), { recursive: true })
    await mkdir(dirname(this.options.archivePath), { recursive: true })

    // 1. Save active tasks
    const activeTemp = `${this.options.storePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(activeTemp, `${JSON.stringify({ schemaVersion: 1, tasks: this.tasks }, null, 2)}\n`, { mode: 0o600 })
    await rename(activeTemp, this.options.storePath)

    // 2. Save archived tasks
    const archiveTemp = `${this.options.archivePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(archiveTemp, `${JSON.stringify({ schemaVersion: 1, tasks: this.archivedTasks }, null, 2)}\n`, { mode: 0o600 })
    await rename(archiveTemp, this.options.archivePath)
  }
}
