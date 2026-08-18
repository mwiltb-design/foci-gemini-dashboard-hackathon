import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api'

export interface SkillFile {
  path: string
  size: number
  executable: boolean
  kind: 'instructions' | 'script' | 'reference' | 'asset' | 'file'
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  category: string
  enabled: boolean
  valid: boolean
  scope: 'user' | 'project' | 'runtime' | 'plugin'
  source: 'pi' | 'agents' | 'settings' | 'runtime' | 'plugin' | 'draft'
  filePath: string
  disableModelInvocation: boolean
  warningCount: number
  canToggle: boolean
  piAccess: boolean
  status: string
  storageLocation: string
  plugin?: {
    id: string
    name: string
    enabled: boolean
    access?: 'read' | 'write'
    granted: boolean
  }
  review?: {
    required: true
    destination: 'user' | 'project' | 'plugin'
    pluginId?: string
  }
}

export interface SkillDetail extends SkillSummary {
  content: string
  license?: string
  compatibility?: string
  allowedTools?: string
  metadata: Record<string, unknown>
  warnings: string[]
  files: SkillFile[]
}

export interface SkillReview {
  digest: string
  sourcePath: string
  name: string
  description: string
  category: string
  content: string
  warnings: string[]
  files: SkillFile[]
  executableCount: number
  valid: boolean
}

export type SkillCatalogMode = 'installed' | 'available'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, options)
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

export function useSkills(revision: number, mode: SkillCatalogMode) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    request<{ skills: SkillSummary[] }>('/api/skills', { signal: controller.signal })
      .then((data) => {
        const catalogSkills = data.skills.filter((skill) => mode === 'installed' ? skill.enabled : !skill.enabled)
        setSkills(catalogSkills)
        setSelectedId((selected) => selected && catalogSkills.some((skill) => skill.id === selected) ? selected : catalogSkills[0]?.id)
        setError('')
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load skills')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [revision, refreshToken, mode])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    const controller = new AbortController()
    request<SkillDetail>(`/api/skills/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then((data) => { setDetail(data); setError('') })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load skill')
      })
    return () => controller.abort()
  }, [selectedId, revision, refreshToken])

  const categories = useMemo(() => ['All', ...Array.from(new Set(skills.map((skill) => skill.category))).sort()], [skills])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return skills.filter((skill) => category === 'All' || skill.category === category)
      .filter((skill) => !needle || `${skill.name} ${skill.description} ${skill.category}`.toLocaleLowerCase().includes(needle))
  }, [skills, query, category])

  async function toggle(skill: SkillSummary) {
    setBusy(true)
    try {
      await request(`/api/skills/${encodeURIComponent(skill.id)}/toggle`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !skill.enabled }),
      })
      setRefreshToken((value) => value + 1)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update skill')
    } finally {
      setBusy(false)
    }
  }

  async function review(path: string): Promise<SkillReview | null> {
    setBusy(true)
    try {
      const result = await request<SkillReview>('/api/skills/review', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
      })
      setError('')
      return result
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to review skill')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function adopt(reviewed: SkillReview, scope: 'user' | 'project'): Promise<boolean> {
    setBusy(true)
    try {
      const adopted = await request<SkillDetail>('/api/skills/adopt', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: reviewed.sourcePath, digest: reviewed.digest, scope }),
      })
      setSelectedId(adopted.id)
      setRefreshToken((value) => value + 1)
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to adopt skill')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function readSkillFile(skillId: string, path: string): Promise<{ path: string; content: string | null; binary: boolean; truncated: boolean } | null> {
    try {
      const result = await request<{ path: string; content: string | null; binary: boolean; truncated: boolean }>(`/api/skills/${encodeURIComponent(skillId)}/file?path=${encodeURIComponent(path)}`)
      setError('')
      return result
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to read skill file')
      return null
    }
  }

  return {
    skills, filtered, categories, selectedId, setSelectedId, detail, query, setQuery, category, setCategory,
    loading, busy, error, toggle, review, adopt, readSkillFile, refresh: () => setRefreshToken((value) => value + 1),
  }
}
