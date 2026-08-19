import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Chip, Panel } from './Panel'

type TerminalStatus = 'connecting' | 'ready' | 'closed' | 'error'

export type ShellType = 'powershell' | 'cmd' | 'wsl' | 'bash' | 'zsh'

const SHELLS: { id: ShellType; label: string; platformNote?: string }[] = [
  { id: 'powershell', label: 'PowerShell' },
  { id: 'cmd', label: 'Command Prompt' },
  { id: 'wsl', label: 'WSL / Linux' },
  { id: 'bash', label: 'Bash / macOS' },
]

function terminalSocketUrl(shell: ShellType): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws/terminal?shell=${encodeURIComponent(shell)}`
}

function TerminalSession({ shell, onStatus }: { shell: ShellType; onStatus: (status: TerminalStatus, message?: string) => void }) {
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
    terminal.writeln(`\x1b[38;5;245mConnecting to native ${shell} session…\x1b[0m`)
    const socket = new WebSocket(terminalSocketUrl(shell))
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
      onStatus('error', `Unable to connect to the ${shell} terminal service`)
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
  }, [shell, onStatus])

  return <div className="terminal-screen" ref={host} aria-label={`Project ${shell} terminal`} />
}

export function TerminalBrowser() {
  const [selectedShell, setSelectedShell] = useState<ShellType>('powershell')
  const [generation, setGeneration] = useState(0)
  const [active, setActive] = useState(true)
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [message, setMessage] = useState('')
  const updateStatus = useCallback((next: TerminalStatus, detail = '') => { setStatus(next); setMessage(detail) }, [])
  const restart = () => { setMessage(''); setStatus('connecting'); setActive(true); setGeneration((value) => value + 1) }

  const switchShell = (shell: ShellType) => {
    if (shell === selectedShell && active) return
    setSelectedShell(shell)
    setMessage('')
    setStatus('connecting')
    setActive(true)
    setGeneration((value) => value + 1)
  }

  return <Panel eyebrow="Project workspace" title="Terminal" action={<Chip tone={status === 'ready' ? 'accent' : status === 'error' ? 'warning' : undefined}>{status}</Chip>} fullWidth className="terminal-panel">
    <div className="terminal-tabs" role="tablist" aria-label="Terminal environments">
      <div style={{ display: 'flex', gap: '6px' }}>
        {SHELLS.map((shell) => (
          <button
            key={shell.id}
            className={`terminal-tab ${selectedShell === shell.id ? 'is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={selectedShell === shell.id}
            onClick={() => switchShell(shell.id)}
          >
            {shell.label}
          </button>
        ))}
      </div>
      <div className="terminal-actions">
        <button className="button button--quiet" type="button" onClick={restart}>Restart</button>
        <button className="button button--quiet" type="button" disabled={!active} onClick={() => { setActive(false); setStatus('closed') }}>Close</button>
      </div>
    </div>
    <div className="terminal-safety">
      <strong>Native {selectedShell.toUpperCase()} shell</strong>
      <span>Running directly inside your project workspace. Full interactive terminal with ANSI color support.</span>
    </div>
    {message && <div className="connection-banner">{message}</div>}
    {active ? <TerminalSession key={`${selectedShell}-${generation}`} shell={selectedShell} onStatus={updateStatus} /> : <div className="terminal-closed"><p>Terminal closed. Project files were preserved.</p><button className="button button--primary" type="button" onClick={restart}>Open new terminal</button></div>}
  </Panel>
}
