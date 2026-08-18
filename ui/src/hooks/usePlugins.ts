import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'
import type { PluginReview, PluginSummary } from '../types'

async function responseBody<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? fallback)
  return body
}

export function usePlugins(enabled: boolean) {
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!enabled) { setPlugins([]); setLoading(false); return }
    setLoading(true)
    try {
      const response = await apiFetch('/api/plugins')
      const body = await responseBody<{ plugins?: PluginSummary[] }>(response, 'Unable to load plugins')
      setPlugins(body.plugins ?? [])
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load plugins')
    } finally { setLoading(false) }
  }, [enabled])

  useEffect(() => { void refresh() }, [refresh])

  const setEnabled = useCallback(async (id: string, nextEnabled: boolean) => {
    const response = await apiFetch(`/api/plugins/${encodeURIComponent(id)}/enable`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: nextEnabled }),
    })
    const body = await responseBody<PluginSummary>(response, 'Unable to update plugin')
    setPlugins((current) => current.map((plugin) => plugin.id === id ? body : plugin))
  }, [])

  const reviewRepository = useCallback(async (url: string) => {
    const response = await apiFetch('/api/plugins/review', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
    })
    return responseBody<PluginReview>(response, 'Unable to review repository')
  }, [])

  const setAgentAccess = useCallback(async (id: string, access: { read: boolean; write: boolean }) => {
    const response = await apiFetch(`/api/plugins/${encodeURIComponent(id)}/agent-access`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(access),
    })
    const body = await responseBody<PluginSummary>(response, 'Unable to update Pi access')
    setPlugins((current) => current.map((plugin) => plugin.id === id ? body : plugin))
  }, [])

  const install = useCallback(async (review: PluginReview) => {
    const response = await apiFetch('/api/plugins/install', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reviewId: review.reviewId, digest: review.digest }),
    })
    const plugin = await responseBody<PluginSummary>(response, 'Unable to install plugin')
    setPlugins((current) => [...current.filter((candidate) => candidate.id !== plugin.id), plugin].sort((left, right) => left.name.localeCompare(right.name)))
    return plugin
  }, [])

  const rollback = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/plugins/${encodeURIComponent(id)}/rollback`, { method: 'POST' })
    const plugin = await responseBody<PluginSummary>(response, 'Unable to roll back plugin')
    setPlugins((current) => current.map((candidate) => candidate.id === id ? plugin : candidate))
    return plugin
  }, [])

  const remove = useCallback(async (id: string, deleteData = false) => {
    const response = await apiFetch(`/api/plugins/${encodeURIComponent(id)}?deleteData=${deleteData}`, { method: 'DELETE' })
    await responseBody<{ ok: boolean }>(response, 'Unable to remove plugin')
    setPlugins((current) => current.filter((plugin) => plugin.id !== id))
  }, [])

  return { plugins, loading, error, refresh, setEnabled, setAgentAccess, reviewRepository, install, rollback, remove }
}
