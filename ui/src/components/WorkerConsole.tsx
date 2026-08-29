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
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let resizeRaf: number | null = null

    const sendResize = (cols: number, rows: number) => {
      if (!ready || socket.readyState !== WebSocket.OPEN) return
      if (cols <= 0 || rows <= 0) return
      if (cols === lastCols && rows === lastRows) return
      lastCols = cols
      lastRows = rows
      socket.send(JSON.stringify({ type: 'resize', cols, rows }))
    }

    const performFit = () => {
      try {
        if (!element.isConnected || element.clientWidth <= 0 || element.clientHeight <= 0) return
        fit.fit()
        if (terminal.cols > 0 && terminal.rows > 0) {
          sendResize(terminal.cols, terminal.rows)
        }
      } catch {
        /* hidden or unmounted */
      }
    }

    const scheduleResize = () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null
        if (resizeTimer !== null) clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => {
          resizeTimer = null
          performFit()
        }, 50)
      })
    }

    const observer = new ResizeObserver(() => {
      scheduleResize()
    })
    observer.observe(element)
    requestAnimationFrame(() => {
      performFit()
    })

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
          try {
            terminal.clear()
          } catch {}
          performFit()
          try {
            terminal.focus()
          } catch {}
        } else if (message.type === 'output' && typeof message.data === 'string') {
          try {
            terminal.write(message.data)
          } catch (writeErr) {
            console.warn(`[WorkerConsole] Terminal write parser error for ${providerName}:`, writeErr)
          }
          if (message.data.includes('http://') || message.data.includes('https://') || linkBuffer.includes('http')) {
            linkBuffer = `${linkBuffer}${message.data}`.slice(-8_000)
            const found = linkBuffer.match(/https?:\/\/[^\s\x1b<>"']+/g) ?? []
            if (found.length) {
              setLinks((current) => {
                const merged = [...new Set([...current, ...found])].slice(-4)
                if (merged.length === current.length && merged.every((val, idx) => val === current[idx])) {
                  return current
                }
                return merged
              })
            }
          }
        } else if (message.type === 'error') {
          setError(message.message ?? `${providerName} console error`)
          try {
            terminal.writeln(`\r\n\x1b[31m${message.message ?? 'Console error'}\x1b[0m`)
          } catch {}
        } else if (message.type === 'exit') {
          try {
            terminal.writeln(`\r\n\x1b[38;5;245mConsole session ended${typeof message.exitCode === 'number' ? ` with code ${message.exitCode}` : ''}.\x1b[0m`)
          } catch {}
          onStatusChangeRef.current()
        }
      } catch {
        try {
          terminal.writeln('\r\n\x1b[31mInvalid console response.\x1b[0m')
        } catch {}
      }
    })

    socket.addEventListener('error', () => {
      setError(`Unable to connect to ${providerName} console service`)
    })

    socket.addEventListener('close', (event) => {
      ready = false
      try {
        terminal.options.disableStdin = true
      } catch {}
      if (event.code !== 1000 && !event.wasClean) {
        setError(event.reason || `${providerName} console closed.`)
      }
      onStatusChangeRef.current()
    })

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      observer.disconnect()
      input.dispose()
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'close' }))
      }
      socket.close()
      try {
        terminal.dispose()
      } catch {}
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
