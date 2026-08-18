export const MEMORY_CHECKPOINT_SCHEMA_VERSION = 1
export const DEFAULT_MEMORY_CHECKPOINT_SETTINGS: MemoryCheckpointSettings = {
  schemaVersion: MEMORY_CHECKPOINT_SCHEMA_VERSION,
  enabled: true,
  mode: 'adaptive',
  customUserMessages: 20,
  customToolCalls: 40,
}

export interface MemoryCheckpointSettings {
  schemaVersion: 1
  enabled: boolean
  mode: 'adaptive' | 'custom'
  customUserMessages: number
  customToolCalls: number
}

export interface MemoryCheckpointStatus {
  schemaVersion: 1
  userMessages: number
  toolCalls: number
  effectiveUserMessages: number
  effectiveToolCalls: number
  reviewDue: boolean
  checkpointRunning: boolean
  updatedAt: string
  lastCheckpointAt?: string
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

export function normalizeMemoryCheckpointSettings(value: unknown): MemoryCheckpointSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_MEMORY_CHECKPOINT_SETTINGS }
  const raw = value as Record<string, unknown>
  return {
    schemaVersion: MEMORY_CHECKPOINT_SCHEMA_VERSION,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_MEMORY_CHECKPOINT_SETTINGS.enabled,
    mode: raw.mode === 'custom' || raw.mode === 'adaptive' ? raw.mode : DEFAULT_MEMORY_CHECKPOINT_SETTINGS.mode,
    customUserMessages: boundedInteger(raw.customUserMessages, DEFAULT_MEMORY_CHECKPOINT_SETTINGS.customUserMessages, 1, 100),
    customToolCalls: boundedInteger(raw.customToolCalls, DEFAULT_MEMORY_CHECKPOINT_SETTINGS.customToolCalls, 5, 500),
  }
}

export function memoryCheckpointThresholds(settings: MemoryCheckpointSettings, memoryCharacters: number): { userMessages: number; toolCalls: number } {
  if (settings.mode === 'custom') return { userMessages: settings.customUserMessages, toolCalls: settings.customToolCalls }
  const usage = Math.max(0, memoryCharacters) / 4000
  if (usage >= 0.9) return { userMessages: 5, toolCalls: 25 }
  if (usage >= 0.75) return { userMessages: 20, toolCalls: 100 }
  if (usage >= 0.5) return { userMessages: 12, toolCalls: 60 }
  if (usage >= 0.25) return { userMessages: 8, toolCalls: 40 }
  return { userMessages: 15, toolCalls: 25 }
}

export function normalizeMemoryCheckpointStatus(value: unknown, thresholds: { userMessages: number; toolCalls: number }): MemoryCheckpointStatus {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    schemaVersion: MEMORY_CHECKPOINT_SCHEMA_VERSION,
    userMessages: boundedInteger(raw.userMessages, 0, 0, 1_000_000),
    toolCalls: boundedInteger(raw.toolCalls, 0, 0, 1_000_000),
    effectiveUserMessages: thresholds.userMessages,
    effectiveToolCalls: thresholds.toolCalls,
    reviewDue: raw.reviewDue === true,
    checkpointRunning: raw.checkpointRunning === true,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
    ...(typeof raw.lastCheckpointAt === 'string' ? { lastCheckpointAt: raw.lastCheckpointAt } : {}),
  }
}
