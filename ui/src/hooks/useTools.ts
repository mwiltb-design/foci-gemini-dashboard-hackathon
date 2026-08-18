import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api'

export type ToolAccess = 'read' | 'write' | 'execute' | 'custom'
export type ToolRisk = 'low' | 'medium' | 'high'
export type ToolCatalogMode = 'active' | 'available'

export interface RuntimeTool {
  name: string
  description: string
  active: boolean
  available: boolean
  source: string
  scope: string
  origin: string
  access: ToolAccess
  risk: ToolRisk
  parameterNames: string[]
  promptGuidelines: string[]
  piAccess: boolean
  status: string
  dependency?: {
    type: 'plugin'
    id: string
    name: string
    enabled: boolean
    access: 'read' | 'write'
    granted: boolean
  }
}

export interface ShellCapability {
  name: string
  label: string
  description: string
  available: boolean
  version?: string
  source: string
  piAccess: boolean
  status: string
}

interface ToolsResponse {
  capturedAt?: string
  tools: RuntimeTool[]
  shell: ShellCapability[]
}

export function useTools(revision: number, mode: ToolCatalogMode) {
  const [data, setData] = useState<ToolsResponse>({ tools: [], shell: [] })
  const [selectedName, setSelectedName] = useState<string>()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | ToolAccess>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    apiFetch('/api/tools', { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ToolsResponse & { error?: string }
        if (!response.ok) throw new Error(body.error ?? `Unable to load tools (${response.status})`)
        return body
      })
      .then((result) => {
        const catalogTools = result.tools.filter((tool) => mode === 'active' ? tool.active : !tool.active)
        setData({ ...result, tools: catalogTools })
        setSelectedName((selected) => selected && catalogTools.some((tool) => tool.name === selected) ? selected : catalogTools[0]?.name)
        setError('')
      })
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load tools')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [revision, refreshToken, mode])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return data.tools
      .filter((tool) => filter === 'all' ? true : filter === 'active' ? tool.active : tool.access === filter)
      .filter((tool) => !needle || `${tool.name} ${tool.description} ${tool.source}`.toLocaleLowerCase().includes(needle))
  }, [data.tools, filter, query])

  return {
    ...data,
    filtered,
    selected: data.tools.find((tool) => tool.name === selectedName),
    selectedName,
    setSelectedName,
    query,
    setQuery,
    filter,
    setFilter,
    loading,
    error,
    refresh: () => setRefreshToken((value) => value + 1),
  }
}
