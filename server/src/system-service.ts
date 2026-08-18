import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import {
  DASHBOARD_REFERENCE_MEMORY,
  GLOBAL_MEMORY_TEMPLATE,
  PROJECT_MEMORY_TEMPLATE,
  USER_PROFILE_TEMPLATE,
  normalizeCuratedMemorySettings,
  type CuratedMemorySettings,
} from './curated-memory.js'
import {
  memoryCheckpointThresholds,
  normalizeMemoryCheckpointSettings,
  normalizeMemoryCheckpointStatus,
  type MemoryCheckpointSettings,
  type MemoryCheckpointStatus,
} from './memory-checkpoint.js'

const execute = promisify(execFile)
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ThinkingLevel = typeof THINKING_LEVELS[number]

interface RawSettings extends Record<string, unknown> {
  defaultProvider?: unknown
  defaultModel?: unknown
  defaultThinkingLevel?: unknown
  theme?: unknown
  defaultProjectTrust?: unknown
  steeringMode?: unknown
  followUpMode?: unknown
  transport?: unknown
  sessionDir?: unknown
  enableInstallTelemetry?: unknown
  compaction?: unknown
  retry?: unknown
}

export interface SafeSettings {
  defaultProvider?: string
  defaultModel?: string
  defaultThinkingLevel?: string
  theme?: string
  defaultProjectTrust?: string
  steeringMode?: string
  followUpMode?: string
  transport?: string
  sessionDir?: string
  enableInstallTelemetry?: boolean
  compactionEnabled?: boolean
  retryEnabled?: boolean
}

export interface FileStatus {
  label: string
  path: string
  exists: boolean
  bytes?: number
  modifiedAt?: string
}

export interface SystemInfo {
  dashboardVersion: string
  piVersion: string
  nodeVersion: string
  platform: string
  startedAt: string
  uptimeSeconds: number
  configuration: {
    globalPath: string
    projectPath: string
    global: SafeSettings
    project: SafeSettings
    effectiveDefaults: { provider?: string; model?: string; thinkingLevel?: string }
    projectOverridesDefaults: boolean
  }
  files: FileStatus[]
  curatedMemory: {
    settings: CuratedMemorySettings
  }
  memoryCheckpoint: {
    settings: MemoryCheckpointSettings
    status: MemoryCheckpointStatus
  }
}

export interface DefaultSettingsInput {
  provider?: unknown
  model?: unknown
  thinkingLevel?: unknown
}

export interface CuratedMemorySettingsInput {
  globalEnabled?: unknown
  projectEnabled?: unknown
  skillEnabled?: unknown
}

export interface MemoryCheckpointSettingsInput {
  enabled?: unknown
  mode?: unknown
  customUserMessages?: unknown
  customToolCalls?: unknown
}

export class SystemError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function optionalString(value: unknown, maximum = 500): string | undefined {
  return typeof value === 'string' && value.length <= maximum ? value : undefined
}

function safeSettings(settings: RawSettings): SafeSettings {
  const compaction = settings.compaction && typeof settings.compaction === 'object' ? settings.compaction as Record<string, unknown> : undefined
  const retry = settings.retry && typeof settings.retry === 'object' ? settings.retry as Record<string, unknown> : undefined
  return {
    ...(optionalString(settings.defaultProvider, 100) ? { defaultProvider: settings.defaultProvider as string } : {}),
    ...(optionalString(settings.defaultModel, 200) ? { defaultModel: settings.defaultModel as string } : {}),
    ...(optionalString(settings.defaultThinkingLevel, 20) ? { defaultThinkingLevel: settings.defaultThinkingLevel as string } : {}),
    ...(optionalString(settings.theme, 100) ? { theme: settings.theme as string } : {}),
    ...(optionalString(settings.defaultProjectTrust, 20) ? { defaultProjectTrust: settings.defaultProjectTrust as string } : {}),
    ...(optionalString(settings.steeringMode, 30) ? { steeringMode: settings.steeringMode as string } : {}),
    ...(optionalString(settings.followUpMode, 30) ? { followUpMode: settings.followUpMode as string } : {}),
    ...(optionalString(settings.transport, 30) ? { transport: settings.transport as string } : {}),
    ...(optionalString(settings.sessionDir, 500) ? { sessionDir: settings.sessionDir as string } : {}),
    ...(typeof settings.enableInstallTelemetry === 'boolean' ? { enableInstallTelemetry: settings.enableInstallTelemetry } : {}),
    ...(typeof compaction?.enabled === 'boolean' ? { compactionEnabled: compaction.enabled } : {}),
    ...(typeof retry?.enabled === 'boolean' ? { retryEnabled: retry.enabled } : {}),
  }
}

async function fileStatus(label: string, path: string): Promise<FileStatus> {
  try {
    const info = await stat(path)
    return { label, path, exists: true, bytes: info.size, modifiedAt: info.mtime.toISOString() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { label, path, exists: false }
    throw error
  }
}

export class SystemService {
  private readonly globalSettingsPath: string
  private readonly projectSettingsPath: string
  private readonly curatedMemorySettingsPath: string
  private readonly memoryCheckpointSettingsPath: string
  private readonly memoryCheckpointStatusPath: string
  private readonly userProfilePath: string
  private readonly memoryPath: string
  private readonly projectMemoryPath: string
  private readonly startedAt = new Date().toISOString()
  private versions: Promise<{ dashboardVersion: string; piVersion: string }> | undefined

  constructor(private readonly workspace: string, private readonly agentDir: string) {
    this.globalSettingsPath = join(agentDir, 'settings.json')
    this.projectSettingsPath = join(workspace, '.pi', 'settings.json')
    this.curatedMemorySettingsPath = join(agentDir, 'dashboard', 'curated-memory', 'settings.json')
    this.memoryCheckpointSettingsPath = join(agentDir, 'dashboard', 'memory-checkpoint', 'settings.json')
    this.memoryCheckpointStatusPath = join(agentDir, 'dashboard', 'memory-checkpoint', 'status.json')
    this.userProfilePath = join(agentDir, 'USER.md')
    this.memoryPath = join(agentDir, 'MEMORY.md')
    this.projectMemoryPath = join(workspace, 'MEMORY.md')
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.createTextFile(this.userProfilePath, USER_PROFILE_TEMPLATE),
      this.createTextFile(this.memoryPath, GLOBAL_MEMORY_TEMPLATE),
      this.createTextFile(this.projectMemoryPath, PROJECT_MEMORY_TEMPLATE),
      this.createJsonFile(this.curatedMemorySettingsPath, normalizeCuratedMemorySettings(undefined)),
    ])
    await this.ensureDashboardReferenceMemory()
  }

  async get(): Promise<SystemInfo> {
    const [globalRaw, projectRaw, versions, files, curatedMemory, memoryCheckpoint] = await Promise.all([
      this.readSettings(this.globalSettingsPath),
      this.readSettings(this.projectSettingsPath),
      this.getVersions(),
      Promise.all([
        fileStatus('Global memory', this.memoryPath),
        fileStatus('User profile', this.userProfilePath),
        fileStatus('Project memory', this.projectMemoryPath),
        fileStatus('Global settings', this.globalSettingsPath),
        fileStatus('Project settings', this.projectSettingsPath),
      ]),
      this.curatedMemory(),
      this.memoryCheckpoint(),
    ])
    const global = safeSettings(globalRaw)
    const project = safeSettings(projectRaw)
    const provider = project.defaultProvider ?? global.defaultProvider
    const model = project.defaultModel ?? global.defaultModel
    const thinkingLevel = project.defaultThinkingLevel ?? global.defaultThinkingLevel

    return {
      ...versions,
      nodeVersion: process.version,
      platform: `${process.platform}/${process.arch}`,
      startedAt: this.startedAt,
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - new Date(this.startedAt).getTime()) / 1_000)),
      configuration: {
        globalPath: this.globalSettingsPath,
        projectPath: this.projectSettingsPath,
        global,
        project,
        effectiveDefaults: { ...(provider ? { provider } : {}), ...(model ? { model } : {}), ...(thinkingLevel ? { thinkingLevel } : {}) },
        projectOverridesDefaults: Boolean(project.defaultProvider || project.defaultModel || project.defaultThinkingLevel),
      },
      files,
      curatedMemory,
      memoryCheckpoint,
    }
  }

  async updateCuratedMemory(input: CuratedMemorySettingsInput): Promise<SystemInfo> {
    if (typeof input.globalEnabled !== 'boolean' || typeof input.projectEnabled !== 'boolean' || typeof input.skillEnabled !== 'boolean') {
      throw new SystemError('Choose whether global memory, project memory, and the Curated Memory skill are enabled')
    }
    const settings: CuratedMemorySettings = {
      schemaVersion: 1,
      globalEnabled: input.globalEnabled,
      projectEnabled: input.projectEnabled,
      skillEnabled: input.skillEnabled,
    }
    await this.writeJson(this.curatedMemorySettingsPath, settings)
    return this.get()
  }

  async updateMemoryCheckpoint(input: MemoryCheckpointSettingsInput): Promise<SystemInfo> {
    if (typeof input.enabled !== 'boolean') throw new SystemError('Choose whether automatic memory checkpoints are enabled')
    if (input.mode !== 'adaptive' && input.mode !== 'custom') throw new SystemError('Memory checkpoint mode must be adaptive or custom')
    if (!Number.isInteger(input.customUserMessages) || (input.customUserMessages as number) < 1 || (input.customUserMessages as number) > 100) throw new SystemError('User-message threshold must be from 1 through 100')
    if (!Number.isInteger(input.customToolCalls) || (input.customToolCalls as number) < 5 || (input.customToolCalls as number) > 500) throw new SystemError('Tool-call threshold must be from 5 through 500')
    const settings: MemoryCheckpointSettings = {
      schemaVersion: 1,
      enabled: input.enabled,
      mode: input.mode,
      customUserMessages: input.customUserMessages as number,
      customToolCalls: input.customToolCalls as number,
    }
    await this.writeJson(this.memoryCheckpointSettingsPath, settings)
    return this.get()
  }

  async updateDefaults(input: DefaultSettingsInput): Promise<SystemInfo> {
    const provider = optionalString(input.provider, 100)?.trim()
    const model = optionalString(input.model, 200)?.trim()
    const thinkingLevel = optionalString(input.thinkingLevel, 20)?.trim()
    if (!provider || !model) throw new SystemError('Provider and model are required')
    if (!thinkingLevel || !THINKING_LEVELS.includes(thinkingLevel as ThinkingLevel)) throw new SystemError('Thinking level is invalid')

    const settings = await this.readSettings(this.globalSettingsPath)
    settings.defaultProvider = provider
    settings.defaultModel = model
    settings.defaultThinkingLevel = thinkingLevel
    await this.writeJson(this.globalSettingsPath, settings)
    return this.get()
  }

  private async curatedMemory(): Promise<SystemInfo['curatedMemory']> {
    return { settings: normalizeCuratedMemorySettings(await this.readJson(this.curatedMemorySettingsPath)) }
  }

  private async memoryCheckpoint(): Promise<SystemInfo['memoryCheckpoint']> {
    const settings = normalizeMemoryCheckpointSettings(await this.readJson(this.memoryCheckpointSettingsPath))
    let characters = 0
    try { characters = (await readFile(this.memoryPath, 'utf8')).length } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const thresholds = memoryCheckpointThresholds(settings, characters)
    const status = normalizeMemoryCheckpointStatus(await this.readJson(this.memoryCheckpointStatusPath), thresholds)
    status.effectiveUserMessages = thresholds.userMessages
    status.effectiveToolCalls = thresholds.toolCalls
    if (!settings.enabled) status.reviewDue = false
    return { settings, status }
  }

  private async readJson(path: string): Promise<unknown> {
    try { return JSON.parse(await readFile(path, 'utf8')) as unknown }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new SystemError(`Unable to read ${path}: ${error instanceof Error ? error.message : 'invalid JSON'}`, 500)
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.dashboard-${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  }

  private async createTextFile(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    try { await writeFile(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }

  private async ensureDashboardReferenceMemory(): Promise<void> {
    const current = await readFile(this.memoryPath, 'utf8')
    if (current.includes('<!-- pi-dashboard-reference -->')) return
    const updated = `${current.trimEnd()}\n\n${DASHBOARD_REFERENCE_MEMORY.trim()}\n`
    const temporary = `${this.memoryPath}.dashboard-${process.pid}.tmp`
    await writeFile(temporary, updated, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.memoryPath)
  }

  private async createJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    try { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }

  private async readSettings(path: string): Promise<RawSettings> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object')
      return parsed as RawSettings
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new SystemError(`Unable to read ${path}: ${error instanceof Error ? error.message : 'invalid JSON'}`, 500)
    }
  }

  private getVersions(): Promise<{ dashboardVersion: string; piVersion: string }> {
    if (!this.versions) {
      this.versions = Promise.all([
        readFile(new URL('../package.json', import.meta.url), 'utf8').then((source) => {
          const value = (JSON.parse(source) as { version?: unknown }).version
          return typeof value === 'string' ? value : 'unknown'
        }).catch(() => 'unknown'),
        execute('pi', ['--version'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 16 * 1024 })
          .then(({ stdout }) => stdout.trim().split(/\r?\n/, 1)[0] || 'unknown')
          .catch(() => 'unavailable'),
      ]).then(([dashboardVersion, piVersion]) => ({ dashboardVersion, piVersion }))
    }
    return this.versions
  }
}
