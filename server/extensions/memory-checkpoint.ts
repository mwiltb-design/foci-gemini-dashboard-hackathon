import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  DEFAULT_MEMORY_CHECKPOINT_SETTINGS,
  memoryCheckpointThresholds,
  normalizeMemoryCheckpointSettings,
  normalizeMemoryCheckpointStatus,
  type MemoryCheckpointSettings,
  type MemoryCheckpointStatus,
} from '../src/memory-checkpoint.js'

const defaultAgentDir = process.env.PI_AGENT_DIR ?? process.env.FOCI_AGENT_DIR ?? resolve(homedir(), '.pi/agent')
const memoryPath = process.env.PI_DASHBOARD_MEMORY_PATH ?? resolve(defaultAgentDir, 'MEMORY.md')
const settingsPath = process.env.PI_DASHBOARD_MEMORY_CHECKPOINT_SETTINGS_PATH ?? resolve(defaultAgentDir, 'dashboard/memory-checkpoint/settings.json')
const statusPath = process.env.PI_DASHBOARD_MEMORY_CHECKPOINT_STATUS_PATH ?? resolve(defaultAgentDir, 'dashboard/memory-checkpoint/status.json')

const REVIEW_PROMPT = `Memory checkpoint. This is a scheduled, lightweight review—not a new development task.

1. Review the useful facts and technical work from the recent conversation.
2. For Global MEMORY.md: If you learned a new cross-project collaboration or communication preference (e.g., how the user prefers answers, explanations, or code formatting), add or consolidate it in Global MEMORY.md. Keep it concise.
3. For Project MEMORY.md: Heavily review and update the active project's technical architecture. Prune out obsolete/completed notes, and record the current technical state, folder layout, and key implementation decisions.
4. For USER.md: DO NOT edit USER.md directly. If you discovered a personal fact (name, role, location, goals), mention it in your response and ask the user explicitly if they would like you to add it to USER.md.
5. If there is nothing worth saving, do nothing.
6. Report only a brief summary of what was updated, then wait for the user's next request.`

function jsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { return undefined }
}

function settings(): MemoryCheckpointSettings {
  return normalizeMemoryCheckpointSettings(jsonFile(settingsPath) ?? DEFAULT_MEMORY_CHECKPOINT_SETTINGS)
}

function memoryCharacters(): number {
  try { return readFileSync(memoryPath, 'utf8').length } catch { return 0 }
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

export default function (pi: ExtensionAPI) {
  const initialSettings = settings()
  const initialThresholds = memoryCheckpointThresholds(initialSettings, memoryCharacters())
  const restored = normalizeMemoryCheckpointStatus(jsonFile(statusPath), initialThresholds)
  let userMessages = restored.userMessages
  let toolCalls = restored.toolCalls
  let reviewDue = restored.reviewDue
  let checkpointRunning = false
  let lastCheckpointAt = restored.lastCheckpointAt

  const persist = () => {
    const currentSettings = settings()
    const thresholds = memoryCheckpointThresholds(currentSettings, memoryCharacters())
    const status: MemoryCheckpointStatus = {
      schemaVersion: 1,
      userMessages,
      toolCalls,
      effectiveUserMessages: thresholds.userMessages,
      effectiveToolCalls: thresholds.toolCalls,
      reviewDue,
      checkpointRunning,
      updatedAt: new Date().toISOString(),
      ...(lastCheckpointAt ? { lastCheckpointAt } : {}),
    }
    atomicJson(statusPath, status)
    return { currentSettings, thresholds }
  }

  const updateDue = () => {
    const currentSettings = settings()
    const thresholds = memoryCheckpointThresholds(currentSettings, memoryCharacters())
    reviewDue = currentSettings.enabled && (userMessages >= thresholds.userMessages || toolCalls >= thresholds.toolCalls)
    persist()
  }

  const startCheckpoint = () => {
    if (checkpointRunning) return false
    checkpointRunning = true
    reviewDue = false
    userMessages = 0
    toolCalls = 0
    persist()
    try {
      pi.sendUserMessage(REVIEW_PROMPT)
      return true
    } catch (error) {
      checkpointRunning = false
      persist()
      throw error
    }
  }

  pi.on('input', (event) => {
    const current = settings()
    if (current.enabled && !checkpointRunning && event.source !== 'extension' && event.text.trim()) {
      userMessages += 1
      updateDue()
    }
  })

  pi.on('tool_execution_end', () => {
    if (!settings().enabled || checkpointRunning) return
    toolCalls += 1
    updateDue()
  })

  const canRun = async (ctx: ExtensionContext) => {
    if (!ctx.model) return false
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)
    return auth.ok
  }

  pi.on('agent_settled', async (_event, ctx) => {
    if (checkpointRunning) {
      checkpointRunning = false
      lastCheckpointAt = new Date().toISOString()
      persist()
      return
    }
    const current = settings()
    if (!current.enabled) {
      reviewDue = false
      persist()
      return
    }
    updateDue()
    if (reviewDue && await canRun(ctx)) startCheckpoint()
    else persist()
  })

  pi.registerCommand('dashboard-memory-checkpoint-now', {
    description: 'Run the Dashboard memory checkpoint now',
    handler: async (_args, ctx) => {
      if (!ctx.isIdle() || checkpointRunning) {
        ctx.ui.notify('A memory checkpoint cannot start while Pi is busy.', 'warning')
        return
      }
      if (!await canRun(ctx)) {
        checkpointRunning = false
        persist()
        ctx.ui.notify('Sign in to an AI provider before running a memory checkpoint.', 'warning')
        return
      }
      startCheckpoint()
    },
  })

  pi.registerCommand('dashboard-memory-checkpoint-reset', {
    description: 'Reset Dashboard memory checkpoint counters',
    handler: async () => {
      userMessages = 0
      toolCalls = 0
      reviewDue = false
      persist()
    },
  })

  persist()
}
