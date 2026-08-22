import { homedir } from 'node:os'
import type { WebSocket } from 'ws'
import pty from '@homebridge/node-pty-prebuilt-multiarch'
import { resolveExecutable } from './process-control.js'

export class WorkerConsoleSession {
  private ptyProcess: any = null
  private browser: WebSocket | null = null

  get active(): boolean {
    return this.ptyProcess !== null
  }

  attach(browser: WebSocket, providerId: string, mode: 'login' | 'manage', cwd: string): void {
    if (this.active) {
      browser.close(1013, 'A worker console is already open')
      return
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLUMNS: '100',
      LINES: '28',
    }
    delete env.PI_DASHBOARD_AUTH_TOKEN
    delete env.OPENROUTER_API_KEY
    delete env.PI_DASHBOARD_WORKER_INTERNAL_TOKEN

    let command: string
    let args: string[] = []

    if (providerId === 'antigravity-cli') {
      command = resolveExecutable('agy')
      args = []
    } else if (providerId === 'codex-cli') {
      command = resolveExecutable('codex')
      args = mode === 'login' ? ['login', '--device-auth'] : []
    } else if (providerId === 'claude-cli') {
      command = resolveExecutable('claude')
      args = mode === 'login' ? ['login'] : []
    } else {
      command = resolveExecutable('pi')
      args = []
    }

    try {
      const ptyModule = (pty as any).default || pty
      const proc = ptyModule.spawn(command, args, {
        name: 'xterm-256color',
        cols: 100,
        rows: 28,
        cwd: cwd || homedir(),
        env,
      })

      this.ptyProcess = proc
      this.browser = browser

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
        if (this.browser === browser) this.browser = null
      })

      // Send initial ready signal
      if (browser.readyState === 1) {
        browser.send(JSON.stringify({ type: 'ready' }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to spawn worker console process'
      if (browser.readyState === 1) {
        browser.send(JSON.stringify({ type: 'error', message }))
      }
    }
  }

  async stop(): Promise<void> {
    const proc = this.ptyProcess
    if (!proc) return
    this.ptyProcess = null
    this.browser = null
    try {
      proc.kill()
    } catch {}
  }
}
