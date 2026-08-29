import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'

export type WorkerMode = 'research' | 'review' | 'implement'
export type WorkerStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed-out'

export interface WorkerBounds {
  timeoutMs: number
  turnLimit: number
  resultLimitBytes: number
}

export interface WorkerProvider {
  id: string
  name: string
  description: string
  kind: 'built-in' | 'external'
  status: 'ready' | 'disabled' | 'unavailable' | 'planned'
  statusLabel: string
  modes: WorkerMode[]
  enabled: boolean
  loginCommand?: string
  manageCommand?: string
}

export interface WorkerResultEnvelope {
  summary: string
  actionsTaken: string[]
  changedFiles: Array<{ path: string; state: string }>
  warnings: string[]
  artifactLinks?: string[]
  sessionId?: string
}

export interface WorkerTask {
  id: string
  providerId: string
  providerName: string
  mode: WorkerMode
  prompt: string
  status: WorkerStatus
  progress: string
  turns: number
  bounds: WorkerBounds
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  sessionId?: string
  result?: string
  resultTruncated?: boolean
  error?: string
  model?: { provider: string; id: string }
  thinkingLevel?: string
  changedFiles: Array<{ path: string; state: string }>
  resultEnvelope?: WorkerResultEnvelope
  archived?: boolean
}

export interface WorkerConfiguration {
  schemaVersion: 1
  providersEnabled: Record<string, boolean>
  showRulesEditor?: boolean
  defaultBounds: WorkerBounds
  subPi?: {
    model?: { provider: string; id: string }
    thinkingLevel?: string
  }
}

export interface WorkerRuleFile {
  id: string
  title: string
  fileName: string
  level: 1 | 2
  providerId?: string
  content: string
  updatedAt: string
}

export interface WorkerSnapshot {
  providers: WorkerProvider[]
  activeTaskId?: string
  tasks: WorkerTask[]
  archivedCount: number
  archivePath: string
  configuration: WorkerConfiguration
  rules: WorkerRuleFile[]
  isFiltered?: boolean
  profileLabel?: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init)
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Worker request failed (${response.status})`)
  return body as T
}

export function useWorkers() {
  const [snapshot, setSnapshot] = useState<WorkerSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    request<WorkerSnapshot>('/api/workers', { signal: controller.signal })
      .then((data) => {
        setSnapshot(data)
        setSelectedId((current) => current && data.tasks.some((task) => task.id === current) ? current : data.activeTaskId ?? data.tasks[0]?.id)
        setError('')
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load Workers')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [refreshToken])

  useEffect(() => {
    if (!snapshot?.activeTaskId) return
    const timer = window.setInterval(refresh, 2_000)
    return () => window.clearInterval(timer)
  }, [snapshot?.activeTaskId, refresh])

  async function start(input: {
    providerId: string
    mode: WorkerMode
    prompt: string
    bounds?: Partial<WorkerBounds>
    model?: { provider: string; id: string }
    thinkingLevel?: string
  }): Promise<boolean> {
    setBusy(true)
    try {
      const task = await request<WorkerTask>('/api/workers/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      setSelectedId(task.id)
      setError('')
      refresh()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start worker')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function cancel(id: string): Promise<void> {
    setBusy(true)
    try {
      await request(`/api/workers/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
      setError('')
      refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to cancel worker')
    } finally {
      setBusy(false)
    }
  }

  async function updateConfig(updates: Partial<WorkerConfiguration>): Promise<boolean> {
    setBusy(true)
    try {
      const next = await request<WorkerSnapshot>('/api/workers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      })
      setSnapshot(next)
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update worker configuration')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveRule(ruleId: string, content: string): Promise<boolean> {
    setBusy(true)
    try {
      await request<WorkerRuleFile>(`/api/workers/rules/${encodeURIComponent(ruleId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      setError('')
      refresh()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save worker rule')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function archiveTask(taskId: string): Promise<boolean> {
    setBusy(true)
    try {
      const next = await request<WorkerSnapshot>('/api/workers/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      setSnapshot(next)
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to archive worker task')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function archiveAllCompleted(): Promise<boolean> {
    setBusy(true)
    try {
      const next = await request<WorkerSnapshot>('/api/workers/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allCompleted: true }),
      })
      setSnapshot(next)
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to archive completed tasks')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function restoreTask(taskId: string): Promise<boolean> {
    setBusy(true)
    try {
      const next = await request<WorkerSnapshot>('/api/workers/archive/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      setSnapshot(next)
      setSelectedId(taskId)
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to restore worker task')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function loadArchivedTasks(): Promise<WorkerTask[]> {
    try {
      const res = await request<{ tasks: WorkerTask[] }>('/api/workers/archive')
      return res.tasks ?? []
    } catch {
      return []
    }
  }

  return {
    snapshot,
    selected: snapshot?.tasks.find((task) => task.id === selectedId),
    selectedId,
    setSelectedId,
    loading,
    busy,
    error,
    start,
    cancel,
    updateConfig,
    saveRule,
    archiveTask,
    archiveAllCompleted,
    restoreTask,
    loadArchivedTasks,
    refresh,
  }
}
