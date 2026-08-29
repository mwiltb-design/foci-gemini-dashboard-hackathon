import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { apiFetch } from '../api'

interface ProviderStatus {
  active: boolean
  providers: string[]
  modelCount: number
}

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/provider-login`
}

export function ProviderLogin() {
  const host = useRef<HTMLDivElement>(null)
  const socket = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [links, setLinks] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void apiFetch('/api/provider-login/status')
      .then(async (response) => {
        const body = await response.json() as ProviderStatus & { error?: string }
        if (!response.ok) throw new Error(body.error ?? 'Unable to inspect Gemini login')
        setStatus(body)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to inspect Gemini login'))
  }, [])

  useEffect(() => {
    const element = host.current
    if (!consoleOpen || !element) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 3_000,
      theme: { background: '#07100d', foreground: '#d8e4df', cursor: '#63e6be', selectionBackground: '#245c4d' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)

    const connection = new WebSocket(socketUrl())
    connection.binaryType = 'arraybuffer'
    socket.current = connection
    const decoder = new TextDecoder()
    let linkBuffer = ''

    const sendResize = () => {
      if (connection.readyState === WebSocket.OPEN) {
        connection.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
      }
    }

    const resize = () => {
      try {
        fit.fit()
        sendResize()
      } catch { /* hidden or unmounted */ }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    terminal.focus()

    connection.onopen = () => {
      resize()
      terminal.writeln('\x1b[38;5;245mConnected to Gemini provider login.\x1b[0m\r\n')
    }

    connection.onmessage = (event) => {
      const bytes = typeof event.data === 'string' ? new TextEncoder().encode(event.data) : new Uint8Array(event.data as ArrayBuffer)
      try {
        terminal.write(bytes)
      } catch (err) {
        console.warn('[ProviderLogin] write error:', err)
      }
      linkBuffer = `${linkBuffer}${decoder.decode(bytes, { stream: true })}`.slice(-8_000)
      const found = linkBuffer.match(/https?:\/\/[^\s\x1b<>"']+/g) ?? []
      if (found.length) setLinks((current) => [...new Set([...current, ...found])].slice(-3))
    }
    connection.onerror = () => setError('The embedded Gemini login console could not connect.')
    connection.onclose = (event) => {
      socket.current = null
      if (event.code !== 1000) setError(event.reason || 'The embedded Gemini login console closed unexpectedly.')
    }
    const input = terminal.onData((data) => {
      if (connection.readyState === WebSocket.OPEN) connection.send(data)
    })

    return () => {
      input.dispose()
      observer.disconnect()
      if (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING) connection.close()
      socket.current = null
      terminal.dispose()
    }
  }, [consoleOpen])

  async function finishLogin() {
    setBusy(true)
    setError('')
    try {
      const response = await apiFetch('/api/provider-login/complete', { method: 'POST' })
      const body = await response.json() as ProviderStatus & { error?: string }
      if (!response.ok) throw new Error(body.error ?? 'Unable to refresh Gemini after login')
      socket.current?.close()
      setConsoleOpen(false)
      setStatus(body)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to refresh Gemini after login')
    } finally {
      setBusy(false)
    }
  }

  const connected = Boolean(status?.providers.length)
  return <div className="provider-login">
    <div className={`provider-login__status ${connected ? 'is-connected' : ''}`}>
      <div><strong>{connected ? 'Gemini is connected' : 'Connect Gemini to an AI provider'}</strong><p>{connected ? `${status?.providers.join(', ')} · ${status?.modelCount} models available` : 'Gemini will guide you through its supported provider login without opening a host terminal.'}</p></div>
      <span>{connected ? 'Connected' : 'Not connected'}</span>
    </div>

    {!consoleOpen && <button className="button button--primary" type="button" onClick={() => { setError(''); setLinks([]); setConsoleOpen(true) }}>{connected ? 'Sign in to another provider' : 'Start Gemini login'}</button>}

    {consoleOpen && <>
      <p className="provider-login__help">The <code>/login</code> command has been started for you. Choose a provider below and follow Gemini’s prompts.</p>
      <div className="provider-login__terminal" ref={host} aria-label="Gemini provider login console" />
      {links.length > 0 && <div className="provider-login__links"><strong>Provider sign-in links</strong>{links.map((link) => <a href={link} target="_blank" rel="noreferrer" key={link}>Open provider sign-in ↗</a>)}</div>}
      <div className="provider-login__actions"><button className="button button--quiet" type="button" disabled={busy} onClick={() => setConsoleOpen(false)}>Cancel</button><button className="button button--primary" type="button" disabled={busy} onClick={() => void finishLogin()}>{busy ? 'Refreshing Gemini…' : 'I’ve finished signing in'}</button></div>
    </>}
    {error && <div className="form-error">{error}</div>}
    <p className="provider-login__note">Provider credentials remain in Dashboard’s private Gemini data volume. The isolated project terminal still cannot access them.</p>
  </div>
}
