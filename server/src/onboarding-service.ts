import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { USER_PROFILE_TEMPLATE } from './curated-memory.js'

export interface OnboardingState {
  schemaVersion: 1
  completed: boolean
  dismissed: boolean
  updatedAt?: string
  userProfileEditable: boolean
  appName?: string
  features?: {
    terminal?: boolean
    workers?: boolean
  }
}

export class OnboardingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function normalizedState(value: unknown): Omit<OnboardingState, 'userProfileEditable'> {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    schemaVersion: 1,
    completed: raw.completed === true,
    dismissed: raw.dismissed === true,
    appName: typeof raw.appName === 'string' ? raw.appName : 'Pi-Dashboard',
    features: {
      terminal: (raw.features as any)?.terminal === true,
      workers: (raw.features as any)?.workers === true,
    },
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
  }
}

function profileItems(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 12) throw new OnboardingError('User profile answers must be a short list')
  return value.map((item) => {
    if (typeof item !== 'string') throw new OnboardingError('Each user profile answer must be text')
    const clean = item.trim().replaceAll(/\s+/g, ' ')
    if (!clean || clean.length > 240 || clean.includes('\n')) throw new OnboardingError('Each user profile answer must be 1 through 240 characters')
    return clean
  })
}

export class OnboardingService {
  private readonly statePath: string
  private readonly userProfilePath: string
  private readonly globalMemoryPath: string

  constructor(private readonly workspace: string, agentDir: string) {
    this.statePath = join(agentDir, 'dashboard', 'onboarding', 'state.json')
    this.userProfilePath = join(agentDir, 'USER.md')
    this.globalMemoryPath = join(agentDir, 'MEMORY.md')
  }

  async get(): Promise<OnboardingState & { workspace: string }> {
    const state = normalizedState(await this.readJson())
    return { ...state, userProfileEditable: await this.userProfileEditable(), workspace: this.workspace }
  }

  async skip(): Promise<OnboardingState & { workspace: string }> {
    const current = normalizedState(await this.readJson())
    await this.writeState({ ...current, dismissed: true, updatedAt: new Date().toISOString() })
    return this.get()
  }

  async resume(): Promise<OnboardingState & { workspace: string }> {
    const current = normalizedState(await this.readJson())
    await this.writeState({ ...current, completed: false, dismissed: false, updatedAt: new Date().toISOString() })
    return this.get()
  }

  async complete(input: {
    appName?: string
    importedUserProfile?: string
    importedGlobalMemory?: string
    profileItems?: unknown
    profileApproved?: unknown
    features?: { terminal?: boolean; workers?: boolean }
  }): Promise<OnboardingState & { workspace: string }> {
    // 1. Handle Direct USER.md Import
    if (typeof input.importedUserProfile === 'string' && input.importedUserProfile.trim()) {
      await this.writeText(this.userProfilePath, input.importedUserProfile.trim() + '\n')
    } else {
      const items = profileItems(input.profileItems)
      if (items.length) {
        if (input.profileApproved !== true) throw new OnboardingError('Review and approve the user profile before saving it')
        const content = `${USER_PROFILE_TEMPLATE.trimEnd()}\n${items.map((item) => `- ${item}`).join('\n')}\n`
        await this.writeText(this.userProfilePath, content)
      }
    }

    // 2. Handle Direct Global MEMORY.md Import
    if (typeof input.importedGlobalMemory === 'string' && input.importedGlobalMemory.trim()) {
      await this.writeText(this.globalMemoryPath, input.importedGlobalMemory.trim() + '\n')
    }

    const appName = typeof input.appName === 'string' && input.appName.trim() ? input.appName.trim() : 'Pi-Dashboard'
    const features = {
      terminal: input.features?.terminal === true,
      workers: input.features?.workers === true,
    }

    await this.writeState({
      schemaVersion: 1,
      completed: true,
      dismissed: false,
      appName,
      features,
      updatedAt: new Date().toISOString(),
    })

    return this.get()
  }

  private async userProfileEditable(): Promise<boolean> {
    try { return await readFile(this.userProfilePath, 'utf8') === USER_PROFILE_TEMPLATE }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
      throw error
    }
  }

  private async readJson(): Promise<unknown> {
    try { return JSON.parse(await readFile(this.statePath, 'utf8')) as unknown }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new OnboardingError('Onboarding state is invalid', 500)
    }
  }

  private async writeState(state: Omit<OnboardingState, 'userProfileEditable'>): Promise<void> {
    await this.writeText(this.statePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  private async writeText(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.dashboard-${process.pid}.tmp`
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  }
}
