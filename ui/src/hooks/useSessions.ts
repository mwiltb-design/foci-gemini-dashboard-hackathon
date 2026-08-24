import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api'

export interface SessionSummary {
  id: string
  name: string
  explicitName: boolean
  createdAt: string
  updatedAt: string
  cwd: string
  parentSession: boolean
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  toolCallCount: number
  errorCount: number
  contextTokens?: number
  archived?: boolean
  model?: string
}

export type SessionTimelineItem =
  | { kind: 'message'; id: string; entryId?: string; timestamp?: string; role: 'user' | 'assistant'; text: string; thinking?: string; model?: string; stopReason?: string }
  | { kind: 'tool'; id: string; timestamp?: string; name: string; args?: unknown; output: string; isError: boolean }
  | { kind: 'notice'; id: string; timestamp?: string; noticeType: string; text: string }

export interface SessionDetail {
  summary: SessionSummary
  timeline: SessionTimelineItem[]
  forkPoints: Array<{ entryId: string; text: string; timestamp?: string }>
}

interface SessionListResponse {
  sessions: SessionSummary[]
  currentSessionId?: string
  archiveAfterDays?: number
}

export function useSessions(revision: number) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshRevision, setRefreshRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    apiFetch('/api/sessions', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load sessions (${response.status})`)
        return response.json() as Promise<SessionListResponse>
      })
      .then((data) => {
        setSessions(data.sessions)
        setCurrentSessionId(data.currentSessionId)
        setSelectedId((selected) => selected && data.sessions.some((session) => session.id === selected)
          ? selected
          : data.currentSessionId ?? data.sessions[0]?.id)
        setError('')
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load sessions')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [revision, refreshRevision])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    const controller = new AbortController()
    apiFetch(`/api/sessions/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load session (${response.status})`)
        return response.json() as Promise<SessionDetail>
      })
      .then((data) => {
        setDetail(data)
        setError('')
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load session')
      })
    return () => controller.abort()
  }, [selectedId, revision])

  const activeSessions = useMemo(() => sessions.filter((session) => !session.archived), [sessions])
  const archivedSessions = useMemo(() => sessions.filter((session) => session.archived), [sessions])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return activeSessions
    return activeSessions.filter((session) => `${session.name} ${session.model ?? ''}`.toLocaleLowerCase().includes(needle))
  }, [activeSessions, query])

  async function setArchived(id: string, archived: boolean): Promise<void> {
    const response = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/${archived ? 'archive' : 'restore'}`, { method: 'POST' })
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(body?.error ?? `Unable to ${archived ? 'archive' : 'restore'} session`)
    }
    setRefreshRevision((current) => current + 1)
  }

  async function renameSession(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim()
    if (!trimmed) return false
    try {
      const response = await apiFetch(`/api/sessions/${encodeURIComponent(id)}/rename`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error ?? `Unable to rename session (${response.status})`)
      }
      setSessions((current) => current.map((s) => s.id === id ? { ...s, name: trimmed, explicitName: true } : s))
      if (detail && detail.summary.id === id) {
        setDetail({ ...detail, summary: { ...detail.summary, name: trimmed, explicitName: true } })
      }
      setRefreshRevision((current) => current + 1)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rename session')
      return false
    }
  }

  return {
    sessions: activeSessions,
    filtered,
    archivedSessions,
    currentSessionId,
    selectedId,
    setSelectedId,
    detail,
    query,
    setQuery,
    setArchived,
    renameSession,
    loading,
    error,
  }
}
