import pty from '@homebridge/node-pty-prebuilt-multiarch'
import type { WebSocket } from 'ws'

export class NativeTerminalSession {
  private ptyProcess: any = null

  constructor(private readonly workspace: string) {}

  get active(): boolean {
    return this.ptyProcess !== null
  }

  attach(browser: WebSocket, requestedShell?: string): void {
    const isWindows = process.platform === 'win32'
    let shell = isWindows ? 'powershell.exe' : (process.env.SHELL || 'bash')
    
    if (requestedShell) {
      const normalized = requestedShell.toLowerCase().trim()
      if (isWindows) {
        if (normalized === 'cmd') shell = 'cmd.exe'
        else if (normalized === 'wsl' || normalized === 'linux') shell = 'wsl.exe'
        else if (normalized === 'gitbash' || normalized === 'bash') shell = 'bash.exe'
        else if (normalized === 'pwsh' || normalized === 'powershell') shell = 'powershell.exe'
      } else {
        if (normalized === 'zsh') shell = '/bin/zsh'
        else if (normalized === 'bash') shell = '/bin/bash'
        else if (normalized === 'sh') shell = '/bin/sh'
      }
    }

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

      let outputBuffer = ''
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flushOutput = () => {
        flushTimer = null
        if (!outputBuffer || browser.readyState !== 1 /* WebSocket.OPEN */) return
        const data = outputBuffer
        outputBuffer = ''
        browser.send(JSON.stringify({ type: 'output', data }))
      }
      const queueOutput = (data: string) => {
        outputBuffer += data
        if (outputBuffer.length >= 2048) {
          if (flushTimer) clearTimeout(flushTimer)
          flushOutput()
        } else if (!flushTimer) {
          flushTimer = setTimeout(flushOutput, 10)
        }
      }

      proc.onData((data: string) => {
        queueOutput(data)
      })

      proc.onExit(({ exitCode }: { exitCode: number }) => {
        if (flushTimer) clearTimeout(flushTimer)
        flushOutput()
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
        if (flushTimer) clearTimeout(flushTimer)
        outputBuffer = ''
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
