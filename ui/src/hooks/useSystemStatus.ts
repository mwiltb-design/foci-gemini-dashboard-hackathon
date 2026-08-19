import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

export interface AvailableModel {
  id: string
  provider: string
  name: string
  reasoning: boolean
  contextWindow?: number
}

interface SafeSettings {
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

interface FileStatus {
  label: string
  path: string
  exists: boolean
  bytes?: number
  modifiedAt?: string
}

interface ActivityError {
  id: string
  timestamp: string
  summary: string
  type: string
  severity: string
}

export interface SystemSnapshot {
  generatedAt: string
  backend: {
    status: 'online' | 'degraded'
    profile: 'core' | 'workbench'
    enabledFeatures: string[]
    optionalCapabilities: Array<{
      id: 'terminal' | 'workers'
      name: string
      description: string
      enabled: boolean
      status: 'disabled' | 'ready' | 'unavailable'
      statusLabel: string
      management: 'host-configuration'
      restartRequired: boolean
      dataPolicy: string
      windowsCommand: string
      unixCommand: string
    }>
    connectedClients: number
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
      settings: {
        schemaVersion: 1
        globalEnabled: boolean
        projectEnabled: boolean
        skillEnabled: boolean
      }
    }
    memoryCheckpoint: {
      settings: {
        schemaVersion: 1
        enabled: boolean
        mode: 'adaptive' | 'custom'
        customUserMessages: number
        customToolCalls: number
      }
      status: {
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
    }
  }
  pi: {
    rpcConnected: boolean
    error?: string
    state: {
      model?: { id?: string; provider?: string; name?: string } | null
      thinkingLevel?: string
      isStreaming?: boolean
      sessionId?: string
      sessionName?: string
      messageCount?: number
      error?: string
    }
    sessionStats?: {
      cost?: number
      totalMessages?: number
      toolCalls?: number
      contextUsage?: { tokens?: number | null; contextWindow?: number; percent?: number | null }
      error?: string
    }
    availableModels: AvailableModel[]
    thinkingLevels: string[]
  }
  workspace: {
    path: string
    git: { available: boolean; clean: boolean; branch?: string; commit?: string }
  }
  persistence: {
    sessionRoot: string
    activityPath: string
    sessions: number
  }
  recentErrors: ActivityError[]
  security: {
    authenticationEnabled: boolean
    frontendExpectedOnLocalhost: boolean
    backendNetworkScope: string
    processIsolation: string
    workspaceIsolationEnforced: boolean
    allowedOrigins: string[]
  }
}

async function request(url: string, options?: RequestInit): Promise<SystemSnapshot> {
  const response = await apiFetch(url, options)
  const body = await response.json() as SystemSnapshot & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

export function useSystemStatus(revision: string = '') {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    request('/api/system', { signal: controller.signal })
      .then((data) => { setSnapshot(data); setError('') })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load system status')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [revision, refreshToken])

  useEffect(() => {
    if (!snapshot?.backend.memoryCheckpoint.status.checkpointRunning) return
    const timer = window.setTimeout(() => setRefreshToken((value) => value + 1), 1500)
    return () => window.clearTimeout(timer)
  }, [snapshot])

  async function update(url: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    try {
      const data = await request(url, {
        method: 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      setSnapshot(data)
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update settings')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function resumeOnboarding(): Promise<boolean> {
    setBusy(true)
    try {
      const response = await apiFetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })
      const body = await response.json() as { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Unable to resume onboarding')
      window.location.reload()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to resume onboarding')
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    snapshot, loading, busy, error,
    refresh: () => setRefreshToken((value) => value + 1),
    updateActive: (provider: string, model: string, thinkingLevel: string) => update('/api/system/session', { provider, model, thinkingLevel }),
    updateDefaults: (provider: string, model: string, thinkingLevel: string) => update('/api/system/defaults', { provider, model, thinkingLevel }),
    updateCuratedMemory: (settings: { globalEnabled: boolean; projectEnabled: boolean; skillEnabled: boolean }) => update('/api/system/curated-memory', settings),
    updateMemoryCheckpoint: (settings: { enabled: boolean; mode: 'adaptive' | 'custom'; customUserMessages: number; customToolCalls: number }) => update('/api/system/memory-checkpoint', settings),
    runMemoryCheckpoint: () => update('/api/system/memory-checkpoint/run'),
    resetMemoryCheckpoint: () => update('/api/system/memory-checkpoint/reset'),
    resumeOnboarding,
    restartRpc: () => update('/api/system/restart-rpc'),
  }
}
