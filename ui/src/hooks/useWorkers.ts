import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'

export type WorkerMode = 'research' | 'review' | 'implement'
export type WorkerStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed-out'

export interface WorkerProvider {
  id: string
  name: string
  description: string
  kind: 'built-in' | 'external'
  status: 'ready' | 'disabled' | 'unavailable' | 'planned'
  statusLabel: string
  modes: WorkerMode[]
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
  bounds: { timeoutMs: number; turnLimit: number; resultLimitBytes: number }
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  sessionId?: string
  result?: string
  resultTruncated?: boolean
  error?: string
  changedFiles: Array<{ path: string; state: string }>
}

interface WorkerSnapshot {
  providers: WorkerProvider[]
  activeTaskId?: string
  tasks: WorkerTask[]
}

async function request(url: string, init?: RequestInit): Promise<WorkerSnapshot | WorkerTask> {
  const response = await apiFetch(url, init)
  const body = await response.json() as (WorkerSnapshot | WorkerTask) & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Worker request failed (${response.status})`)
  return body
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
    request('/api/workers', { signal: controller.signal })
      .then((data) => {
        const next = data as WorkerSnapshot
        setSnapshot(next)
        setSelectedId((current) => current && next.tasks.some((task) => task.id === current) ? current : next.activeTaskId ?? next.tasks[0]?.id)
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

  async function start(mode: WorkerMode, prompt: string, model?: { provider: string; id: string }, thinkingLevel?: string): Promise<boolean> {
    setBusy(true)
    try {
      const task = await request('/api/workers/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: 'sub-pi',
          mode,
          prompt,
          ...(model ? { model } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        }),
      }) as WorkerTask
      setSelectedId(task.id)
      setError('')
      refresh()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start Sub PI')
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
      setError(reason instanceof Error ? reason.message : 'Unable to cancel Sub PI')
    } finally {
      setBusy(false)
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
    refresh,
  }
}
