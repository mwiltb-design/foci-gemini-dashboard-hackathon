import pty from '@homebridge/node-pty-prebuilt-multiarch'
import type { WebSocket } from 'ws'

export class NativeTerminalSession {
  private ptyProcess: any = null

  constructor(private readonly workspace: string) {}

  get active(): boolean {
    return this.ptyProcess !== null
  }

  attach(browser: WebSocket): void {
    const isWindows = process.platform === 'win32'
    const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || 'bash')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLUMNS: '100',
      LINES: '28',
    }
    delete env.PI_DASHBOARD_AUTH_TOKEN

    try {
      const ptyModule = (pty as any).default || pty
      const proc = ptyModule.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd: this.workspace,
        env,
      })

      this.ptyProcess = proc

      proc.onData((data: string) => {
        if (browser.readyState === 1 /* WebSocket.OPEN */) {
          browser.send(JSON.stringify({ type: 'output', data }))
        }
      })

      proc.onExit(({ exitCode }: { exitCode: number }) => {
        if (browser.readyState === 1) {
          browser.send(JSON.stringify({ type: 'exit', exitCode }))
        }
        this.ptyProcess = null
      })

      browser.on('message', (raw: string | Buffer) => {
        try {
          const text = typeof raw === 'string' ? raw : raw.toString('utf8')
          const message = JSON.parse(text) as { type?: string; data?: string; cols?: number; rows?: number }
          if (message.type === 'input' && typeof message.data === 'string') {
            proc.write(message.data)
          } else if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
            try {
              proc.resize(Math.max(10, Math.min(300, message.cols)), Math.max(5, Math.min(100, message.rows)))
            } catch {}
          } else if (message.type === 'close') {
            proc.kill()
          }
        } catch {}
      })

      browser.on('close', () => {
        if (this.ptyProcess) {
          try { this.ptyProcess.kill() } catch {}
          this.ptyProcess = null
        }
      })

      // Send initial ready signal
      if (browser.readyState === 1) {
        browser.send(JSON.stringify({ type: 'ready' }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to spawn terminal process'
      if (browser.readyState === 1) {
        browser.send(JSON.stringify({ type: 'error', message }))
      }
    }
  }
}
