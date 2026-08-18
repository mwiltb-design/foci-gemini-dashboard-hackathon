import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Chip, Panel } from './Panel'

type TerminalStatus = 'connecting' | 'ready' | 'closed' | 'error'

function terminalSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/terminal`
}

function TerminalSession({ onStatus }: { onStatus: (status: TerminalStatus, message?: string) => void }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      disableStdin: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      scrollback: 5_000,
      theme: { background: '#07100d', foreground: '#d8e4df', cursor: '#63e6be', selectionBackground: '#245c4d' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    terminal.writeln('\x1b[38;5;245mConnecting to isolated project terminal…\x1b[0m')
    const socket = new WebSocket(terminalSocketUrl())
    let ready = false
    let failed = false

    const sendResize = () => {
      if (!ready || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
    const resize = () => {
      try { fit.fit(); sendResize() } catch { /* hidden or unmounted */ }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    requestAnimationFrame(resize)

    const input = terminal.onData((data) => {
      if (ready && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      try {
        const message = JSON.parse(event.data) as { type?: string; data?: string; message?: string; exitCode?: number }
        if (message.type === 'ready') {
          ready = true
          terminal.options.disableStdin = false
          terminal.clear()
          onStatus('ready')
          resize()
          terminal.focus()
        } else if (message.type === 'output' && typeof message.data === 'string') terminal.write(message.data)
        else if (message.type === 'error') {
          failed = true
          terminal.writeln(`\r\n\x1b[31m${message.message ?? 'Terminal error'}\x1b[0m`)
          onStatus('error', message.message)
        } else if (message.type === 'exit') {
          terminal.writeln(`\r\n\x1b[38;5;245mShell exited${typeof message.exitCode === 'number' ? ` with code ${message.exitCode}` : ''}.\x1b[0m`)
          onStatus('closed')
        }
      } catch { terminal.writeln('\r\n\x1b[31mInvalid terminal response.\x1b[0m') }
    })
    socket.addEventListener('open', () => onStatus('connecting'))
    socket.addEventListener('error', () => {
      failed = true
      onStatus('error', 'Unable to connect to the project terminal service')
    })
    socket.addEventListener('close', () => {
      ready = false
      terminal.options.disableStdin = true
      if (!failed) onStatus('closed')
    })

    return () => {
      observer.disconnect()
      input.dispose()
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'close' }))
      socket.close()
      terminal.dispose()
    }
  }, [onStatus])

  return <div className="terminal-screen" ref={host} aria-label="Project Linux terminal" />
}

export function TerminalBrowser() {
  const [generation, setGeneration] = useState(0)
  const [active, setActive] = useState(true)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [message, setMessage] = useState('')
  const updateStatus = useCallback((next: TerminalStatus, detail = '') => { setStatus(next); setMessage(detail) }, [])
  const restart = () => { setMessage(''); setStatus('connecting'); setActive(true); setGeneration((value) => value + 1) }

  return <Panel eyebrow="Project workspace" title="Terminal" action={<Chip tone={status === 'ready' ? 'accent' : status === 'error' ? 'warning' : undefined}>{status}</Chip>} fullWidth className="terminal-panel">
    <div className="terminal-tabs" role="tablist" aria-label="Terminal environments">
      <button className="terminal-tab is-active" type="button" role="tab" aria-selected="true">Project Linux</button>
      <button className="terminal-tab terminal-tab--locked" type="button" role="tab" aria-selected="false" disabled title="Advanced optional package; not installed">Windows PowerShell <span>locked</span></button>
      <div className="terminal-actions">
        <button className="button button--quiet" type="button" onClick={restart}>Restart</button>
        <button className="button button--quiet" type="button" disabled={!active} onClick={() => { setActive(false); setStatus('closed') }}>Close</button>
      </div>
    </div>
    <div className="terminal-safety"><strong>Isolated project shell</strong><span>Can modify the mounted project. Pi credentials, dashboard state, Docker, host files, and network access are not available.</span></div>
    {message && <div className="connection-banner">{message}</div>}
    {active ? <TerminalSession key={generation} onStatus={updateStatus} /> : <div className="terminal-closed"><p>Terminal closed. Project files were preserved.</p><button className="button button--primary" type="button" onClick={restart}>Open new terminal</button></div>}
  </Panel>
}
