import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'

export type WorkerConsoleMode = 'login' | 'manage'

function socketUrl(providerId: string, mode: WorkerConsoleMode): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/workers/${encodeURIComponent(providerId)}/${mode}`
}

export function WorkerConsole({ providerId, providerName, mode, onClose, onStatusChange }: {
  providerId: string
  providerName: string
  mode: WorkerConsoleMode
  onClose: () => void
  onStatusChange: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const socket = useRef<WebSocket | null>(null)
  const onStatusChangeRef = useRef(onStatusChange)
  const [links, setLinks] = useState<string[]>([])
  const [error, setError] = useState('')
  onStatusChangeRef.current = onStatusChange

  useEffect(() => {
    const element = host.current
    if (!element) return
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      scrollback: 3_000,
      theme: { background: '#07100d', foreground: '#d8e4df', cursor: '#63e6be', selectionBackground: '#245c4d' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    const observer = new ResizeObserver(() => { try { fit.fit() } catch { /* hidden or unmounted */ } })
    observer.observe(element)
    fit.fit()
    terminal.writeln(`\x1b[38;5;245mOpening ${providerName} ${mode === 'login' ? 'connection' : 'management'} console inside Dashboard…\x1b[0m`)
    const connection = new WebSocket(socketUrl(providerId, mode))
    connection.binaryType = 'arraybuffer'
    socket.current = connection
    const decoder = new TextDecoder()
    let linkBuffer = ''
    connection.onmessage = (event) => {
      const bytes = typeof event.data === 'string' ? new TextEncoder().encode(event.data) : new Uint8Array(event.data as ArrayBuffer)
      terminal.write(bytes)
      linkBuffer = `${linkBuffer}${decoder.decode(bytes, { stream: true })}`.slice(-8_000)
      const found = linkBuffer.match(/https?:\/\/[^\s\x1b<>"']+/g) ?? []
      if (found.length) setLinks((current) => [...new Set([...current, ...found])].slice(-3))
    }
    connection.onerror = () => setError(`${providerName} console could not connect.`)
    connection.onclose = (event) => {
      socket.current = null
      if (event.code !== 1000) setError(event.reason || `${providerName} console closed unexpectedly.`)
      onStatusChangeRef.current()
    }
    const input = terminal.onData((data) => { if (connection.readyState === WebSocket.OPEN) connection.send(data) })
    return () => {
      input.dispose()
      observer.disconnect()
      if (connection.readyState === WebSocket.OPEN || connection.readyState === WebSocket.CONNECTING) connection.close()
      socket.current = null
      terminal.dispose()
    }
  }, [providerId, providerName, mode])

  return (
    <section className="worker-console">
      <header>
        <div>
          <span className="eyebrow">{mode === 'login' ? 'Connect account' : 'Manage worker'}</span>
          <h2>{providerName}</h2>
          <p>{mode === 'login' ? 'Follow the provider’s normal sign-in instructions. Credentials stay in your local environment.' : 'Manage this worker’s skills, MCP servers, tools, and configurations.'}</p>
        </div>
        <button className="button button--quiet" type="button" onClick={onClose}>Close</button>
      </header>
      <div className="worker-console__terminal" ref={host} aria-label={`${providerName} ${mode} console`} />
      {links.length > 0 && (
        <div className="worker-console__links">
          <strong>Sign-in links</strong>
          {links.map((link) => <a href={link} target="_blank" rel="noreferrer" key={link}>Open provider sign-in ↗</a>)}
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <footer>
        <span>{mode === 'login' ? 'After sign-in finishes, close this console and the provider status will refresh.' : 'Changes are saved in your local configuration.'}</span>
        <button className="button button--primary" type="button" onClick={onClose}>{mode === 'login' ? 'I’ve finished' : 'Done'}</button>
      </footer>
    </section>
  )
}
