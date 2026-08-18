import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api'

export type GitFileState = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflicted' | 'staged'
export type FileMode = 'rendered' | 'source' | 'edit' | 'diff'

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
  hidden: boolean
  gitState?: GitFileState
}

export interface FilePreview {
  path: string
  name: string
  size: number
  modifiedAt: string
  content: string | null
  binary: boolean
  truncated: boolean
  language: string
  revision: string | null
}

export interface FileSearchResult {
  path: string
  name: string
  matches: Array<{ line: number; text: string }>
  nameMatch: boolean
}

export interface GitStatusEntry {
  path: string
  index: string
  workingTree: string
  state: GitFileState
}

export interface GitStatus {
  available: boolean
  branch?: string
  commit?: string
  clean: boolean
  entries: GitStatusEntry[]
  counts: Record<GitFileState, number>
}

interface ListingResponse {
  path: string
  entries: FileEntry[]
  git: { available: boolean; clean: boolean; branch?: string; commit?: string }
}

interface FileWriteResult {
  created: boolean
  file: FilePreview
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { signal })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

async function mutateJson<T>(url: string, method: 'POST' | 'PUT', body: unknown): Promise<T> {
  const response = await apiFetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
  return result
}

export function useFiles(workspaceRevision: number, editingEnabled: boolean) {
  const [path, setPathState] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selectedPath, setSelectedPath] = useState<string>()
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [draft, setDraft] = useState('')
  const [diff, setDiff] = useState('')
  const [diffTruncated, setDiffTruncated] = useState(false)
  const [mode, setModeState] = useState<FileMode>('source')
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)
  const dirty = mode === 'edit' && preview?.content !== null && draft !== preview?.content

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all([
      getJson<ListingResponse>(`/api/files?path=${encodeURIComponent(path)}`, controller.signal),
      getJson<GitStatus>('/api/git/status', controller.signal),
    ]).then(([listing, status]) => {
      setEntries(listing.entries)
      setGitStatus(status)
      setError('')
    }).catch((reason: unknown) => {
      if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load files')
    }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [path, refreshToken, workspaceRevision])

  useEffect(() => {
    if (!selectedPath || mode === 'diff' || dirty) return
    const controller = new AbortController()
    getJson<FilePreview>(`/api/files/content?path=${encodeURIComponent(selectedPath)}`, controller.signal)
      .then((data) => {
        setPreview(data)
        setDraft(data.content ?? '')
        setError('')
        if (data.language === 'markdown' && mode === 'source') setModeState('rendered')
        if (data.language !== 'markdown' && mode === 'rendered') setModeState('source')
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') { setPreview(null); setError(reason instanceof Error ? reason.message : 'Unable to preview file') }
      })
    return () => controller.abort()
  }, [selectedPath, mode === 'diff', dirty, refreshToken, workspaceRevision])

  useEffect(() => {
    if (!selectedPath || mode !== 'diff') return
    const controller = new AbortController()
    getJson<{ diff: string; truncated: boolean }>(`/api/git/diff?path=${encodeURIComponent(selectedPath)}`, controller.signal)
      .then((data) => { setDiff(data.diff); setDiffTruncated(data.truncated); setError('') })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') { setDiff(''); setError(reason instanceof Error ? reason.message : 'Unable to load diff') }
      })
    return () => controller.abort()
  }, [selectedPath, mode, refreshToken, workspaceRevision])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2) {
      setSearchResults([])
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      getJson<{ results: FileSearchResult[] }>(`/api/files/search?q=${encodeURIComponent(needle)}`, controller.signal)
        .then((data) => { setSearchResults(data.results); setError('') })
        .catch((reason: unknown) => {
          if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Search failed')
        })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, workspaceRevision])

  const breadcrumbs = useMemo(() => {
    const segments = path.split('/').filter(Boolean)
    return [{ label: 'project', path: '' }, ...segments.map((segment, index) => ({ label: segment, path: segments.slice(0, index + 1).join('/') }))]
  }, [path])

  function allowDiscard(): boolean {
    return !dirty || window.confirm('Discard your unsaved changes?')
  }

  function setPath(nextPath: string) {
    if (!allowDiscard()) return
    setPathState(nextPath)
  }

  function setMode(nextMode: FileMode) {
    if (mode === 'edit' && nextMode !== 'edit' && !allowDiscard()) return
    if (mode === 'edit' && nextMode !== 'edit') setDraft(preview?.content ?? '')
    setModeState(nextMode)
    setNotice('')
  }

  function openEntry(entry: FileEntry) {
    if (!allowDiscard()) return
    if (entry.type === 'directory') {
      setPathState(entry.path)
      setQuery('')
    } else {
      setPreview(null)
      setSelectedPath(entry.path)
      setModeState('source')
    }
  }

  function selectChangedFile(filePath: string) {
    if (!allowDiscard()) return
    setDiff('')
    setSelectedPath(filePath)
    setModeState('diff')
  }

  function selectSearchResult(result: FileSearchResult) {
    if (!allowDiscard()) return
    setPreview(null)
    setSelectedPath(result.path)
    setPathState(result.path.includes('/') ? result.path.slice(0, result.path.lastIndexOf('/')) : '')
    setModeState('source')
    setQuery('')
  }

  async function save() {
    if (!editingEnabled || !selectedPath || !preview?.revision) return
    setSaving(true)
    setNotice('')
    try {
      const result = await mutateJson<FileWriteResult>(`/api/files/content?path=${encodeURIComponent(selectedPath)}`, 'PUT', { content: draft, revision: preview.revision })
      setPreview(result.file)
      setDraft(result.file.content ?? '')
      setNotice('Saved')
      setError('')
      setRefreshToken((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save file')
    } finally {
      setSaving(false)
    }
  }

  async function createFile(name: string) {
    if (!editingEnabled || !allowDiscard()) return false
    const filePath = path ? `${path}/${name}` : name
    setSaving(true)
    setNotice('')
    try {
      const result = await mutateJson<FileWriteResult>('/api/files', 'POST', { path: filePath, content: '' })
      setSelectedPath(result.file.path)
      setPreview(result.file)
      setDraft('')
      setModeState('edit')
      setNotice('File created')
      setError('')
      setRefreshToken((value) => value + 1)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create file')
      return false
    } finally {
      setSaving(false)
    }
  }

  function refresh() {
    if (!allowDiscard()) return
    setRefreshToken((value) => value + 1)
    setNotice('')
  }

  return {
    path, setPath, entries, selectedPath, preview, draft, setDraft, dirty, saving, diff, diffTruncated, mode, setMode, gitStatus,
    query, setQuery, searchResults, loading, error, notice, breadcrumbs, openEntry, selectChangedFile, selectSearchResult,
    editingEnabled, canEdit: editingEnabled && Boolean(preview?.revision) && !preview?.binary && !preview?.truncated,
    save, createFile, refresh,
  }
}
