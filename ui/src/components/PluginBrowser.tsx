import { useEffect, useRef, useState } from 'react'
import { isPluginHostMessage, isPluginRuntimeRequestMessage, parsePluginNavigationTarget, type PluginRuntimeResponseMessage } from '../../../packages/plugin-sdk/src/index'
import { apiFetch } from '../api'
import type { PluginSummary } from '../types'

interface PluginBrowserProps {
  plugin: PluginSummary
  onDisable: () => Promise<void>
  onManage: () => void
  onOpenChatSession: (sessionId: string) => void
}

export function PluginBrowser({ plugin, onDisable, onManage, onOpenChatSession }: PluginBrowserProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const frameRef = useRef<HTMLIFrameElement>(null)
  const pendingRequests = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    const respond = (message: PluginRuntimeResponseMessage) => {
      if (active) frameRef.current?.contentWindow?.postMessage(message, '*')
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (isPluginHostMessage(event.data, plugin.id)) {
        const target = event.data.type === 'navigate' && plugin.source === 'bundled' ? parsePluginNavigationTarget(event.data.value) : undefined
        if (target?.type === 'session') onOpenChatSession(target.sessionId)
        return
      }
      if (!isPluginRuntimeRequestMessage(event.data, plugin.id)) return
      const request = event.data
      if (pendingRequests.current.has(request.requestId) || pendingRequests.current.size >= 8) {
        respond({ schemaVersion: 1, pluginId: plugin.id, type: 'runtime-response', requestId: request.requestId, status: 429, body: { error: 'Plugin request limit reached' } })
        return
      }
      pendingRequests.current.add(request.requestId)
      void (async () => {
        try {
          const response = await apiFetch(`/api/plugins/${encodeURIComponent(plugin.id)}/runtime${request.path}`, {
            method: request.method,
            headers: request.body === undefined ? undefined : { 'content-type': 'application/json' },
            body: request.body === undefined ? undefined : JSON.stringify(request.body),
          })
          const text = await response.text()
          let body: unknown = null
          if (text) {
            try { body = JSON.parse(text) }
            catch { body = text }
          }
          respond({ schemaVersion: 1, pluginId: plugin.id, type: 'runtime-response', requestId: request.requestId, status: response.status, body })
        } catch {
          respond({ schemaVersion: 1, pluginId: plugin.id, type: 'runtime-response', requestId: request.requestId, status: 502, body: { error: 'Plugin runtime request failed' } })
        } finally { pendingRequests.current.delete(request.requestId) }
      })()
    }
    window.addEventListener('message', onMessage)
    return () => { active = false; pendingRequests.current.clear(); window.removeEventListener('message', onMessage) }
  }, [onOpenChatSession, plugin.id, plugin.source])

  async function action(callback: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError('')
    try { await callback() }
    catch (reason) { setError(reason instanceof Error ? reason.message : fallback) }
    finally { setBusy(false) }
  }

  return <section className="panel panel--full plugin-panel">
    <header className="panel__header">
      <div><span className="eyebrow">Sandboxed plugin · v{plugin.version}</span><h1>{plugin.name}</h1></div>
      <div className="plugin-panel__actions">
        <button className="button button--quiet" type="button" disabled={busy} onClick={onManage}>Manage plugin</button>
        <button className="button button--quiet" type="button" disabled={busy} onClick={() => void action(onDisable, 'Unable to disable plugin')}>{busy ? 'Working…' : 'Disable'}</button>
      </div>
    </header>
    {error && <div className="form-error plugin-error">{error}</div>}
    <iframe
      ref={frameRef}
      className="plugin-frame"
      title={plugin.name}
      src={plugin.frontendUrl}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      onLoad={() => frameRef.current?.contentWindow?.postMessage({ schemaVersion: 1, pluginId: plugin.id, type: 'host-ready' }, '*')}
    />
  </section>
}
