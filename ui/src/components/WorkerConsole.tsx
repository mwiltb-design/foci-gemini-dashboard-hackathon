import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

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
      disableStdin: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5_000,
      theme: {
        background: '#07100d',
        foreground: '#d8e4df',
        cursor: '#63e6be',
        selectionBackground: '#245c4d',
      },
    })

    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    terminal.writeln(`\x1b[38;5;245mOpening ${providerName} ${mode === 'login' ? 'connection' : 'management'} console inside Dashboard…\x1b[0m`)

    const socket = new WebSocket(socketUrl(providerId, mode))
    let ready = false
    let linkBuffer = ''

    const sendResize = () => {
      if (!ready || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }

    const resize = () => {
      try {
        fit.fit()
        sendResize()
      } catch {
        /* hidden or unmounted */
      }
    }

    const observer = new ResizeObserver(resize)
    observer.observe(element)
    requestAnimationFrame(resize)

    const input = terminal.onData((data) => {
      if (ready && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as { type?: string; data?: string; message?: string; exitCode?: number }
        if (message.type === 'ready') {
          ready = true
          terminal.options.disableStdin = false
          terminal.clear()
          resize()
          terminal.focus()
        } else if (message.type === 'output' && typeof message.data === 'string') {
          terminal.write(message.data)
          linkBuffer = `${linkBuffer}${message.data}`.slice(-8_000)
          const found = linkBuffer.match(/https?:\/\/[^\s\x1b<>"']+/g) ?? []
          if (found.length) setLinks((current) => [...new Set([...current, ...found])].slice(-4))
        } else if (message.type === 'error') {
          setError(message.message ?? `${providerName} console error`)
          terminal.writeln(`\r\n\x1b[31m${message.message ?? 'Console error'}\x1b[0m`)
        } else if (message.type === 'exit') {
          terminal.writeln(`\r\n\x1b[38;5;245mConsole session ended${typeof message.exitCode === 'number' ? ` with code ${message.exitCode}` : ''}.\x1b[0m`)
          onStatusChangeRef.current()
        }
      } catch {
        terminal.writeln('\r\n\x1b[31mInvalid console response.\x1b[0m')
      }
    })

    socket.addEventListener('error', () => {
      setError(`Unable to connect to ${providerName} console service`)
    })

    socket.addEventListener('close', (event) => {
      ready = false
      terminal.options.disableStdin = true
      if (event.code !== 1000 && !event.wasClean) {
        setError(event.reason || `${providerName} console closed.`)
      }
      onStatusChangeRef.current()
    })

    return () => {
      observer.disconnect()
      input.dispose()
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'close' }))
      }
      socket.close()
      terminal.dispose()
    }
  }, [providerId, providerName, mode])

  return (
    <section className="worker-console">
      <header>
        <div>
          <span className="eyebrow">{mode === 'login' ? 'Connect account' : 'Manage worker'}</span>
          <h2>{providerName}</h2>
          <p>{mode === 'login' ? 'Follow the provider’s sign-in instructions. Credentials stay in your local environment.' : 'Interactive management console for tools, MCP servers, models, and settings.'}</p>
        </div>
        <button className="button button--quiet" type="button" onClick={onClose}>Close</button>
      </header>

      <div className="worker-console__terminal" ref={host} aria-label={`${providerName} ${mode} console`} />

      {links.length > 0 && (
        <div className="worker-console__links">
          <strong>Sign-in / Auth links:</strong>
          {links.map((link) => (
            <a href={link} target="_blank" rel="noreferrer" key={link} className="button button--quiet" style={{ fontSize: '11px', padding: '3px 8px', color: 'var(--accent)' }}>
              Open sign-in link ↗
            </a>
          ))}
        </div>
      )}

      {error && <div className="form-error" style={{ margin: '8px 12px' }}>{error}</div>}

      <footer>
        <span>{mode === 'login' ? 'After sign-in finishes, close this console and the provider status will refresh.' : 'Interactive session connected directly to your environment.'}</span>
        <button className="button button--primary" type="button" onClick={onClose}>{mode === 'login' ? 'I’ve finished' : 'Done'}</button>
      </footer>
    </section>
  )
}
