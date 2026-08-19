import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'

export interface ProjectSummary {
  id: string
  name: string
  path: string
  hasMemory: boolean
  hasNotes: boolean
  lastModified?: string
  fileCount: number
}

export interface ProjectsData {
  rootDir: string
  activeWorkspace: string
  activeProjectSlug: string
  projects: ProjectSummary[]
}

export function useProjects() {
  const [data, setData] = useState<ProjectsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  const refresh = useCallback(() => setRefreshToken((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/projects')
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load projects')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  async function createProject(name: string, template = 'standard'): Promise<ProjectSummary | null> {
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/projects/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, template }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create project')
      refresh()
      return json as ProjectSummary
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create project')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function switchProject(projectPath: string): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      const res = await apiFetch('/api/projects/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to switch project')
      refresh()
      window.location.reload()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to switch project')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function openProjectInNewWindow(projectPath: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/projects/open-window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      })
      const json = await res.json()
      return res.ok && Boolean(json.success)
    } catch {
      return false
    }
  }

  async function createDesktopShortcut(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await apiFetch('/api/system/create-shortcut', { method: 'POST' })
      const json = await res.json()
      return json
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Failed to create shortcut' }
    }
  }

  return {
    data,
    loading,
    busy,
    error,
    refresh,
    createProject,
    switchProject,
    openProjectInNewWindow,
    createDesktopShortcut,
  }
}
