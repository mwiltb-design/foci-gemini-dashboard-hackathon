import { homedir, tmpdir } from 'node:os'
import type { WebSocket } from 'ws'
import pty from '@homebridge/node-pty-prebuilt-multiarch'

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

    if (process.platform === 'win32') {
      command = 'powershell.exe'
      let cliCmd = ''
      if (providerId === 'antigravity-cli') {
        cliCmd = 'agy'
      } else if (providerId === 'codex-cli') {
        cliCmd = mode === 'login' ? 'codex login --device-auth' : 'codex'
      } else if (providerId === 'claude-cli') {
        cliCmd = mode === 'login' ? 'claude login' : 'claude'
      } else {
        cliCmd = 'pi'
      }
      args = ['-NoProfile', '-NoExit', '-Command', cliCmd]
    } else {
      command = '/bin/bash'
      let cliCmd = ''
      if (providerId === 'antigravity-cli') {
        cliCmd = 'exec agy'
      } else if (providerId === 'codex-cli') {
        cliCmd = mode === 'login' ? 'exec codex login --device-auth' : 'exec codex'
      } else if (providerId === 'claude-cli') {
        cliCmd = mode === 'login' ? 'exec claude login' : 'exec claude'
      } else {
        cliCmd = 'exec pi'
      }
      args = ['-lc', cliCmd]
    }

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
      if (browser.readyState === browser.OPEN) {
        browser.send(Buffer.from(data, 'utf8'))
      }
    })

    const finish = (code = 1000, reason = 'Worker console closed'): void => {
      if (this.ptyProcess === proc) this.ptyProcess = null
      if (this.browser === browser) this.browser = null
      if (browser.readyState === browser.OPEN) browser.close(code, reason.slice(0, 120))
    }

    proc.onExit(() => finish())

    browser.on('message', (data) => {
      if (this.ptyProcess !== proc) return
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : new TextDecoder().decode(data as ArrayBuffer)
      try {
        const parsed = JSON.parse(text)
        if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
          proc.resize(Math.max(20, Math.min(200, parsed.cols)), Math.max(5, Math.min(100, parsed.rows)))
          return
        }
        if (parsed.type === 'input' && typeof parsed.data === 'string') {
          proc.write(parsed.data)
          return
        }
      } catch {}
      proc.write(text)
    })

    browser.once('error', () => void this.stop())
    browser.once('close', () => void this.stop())
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
