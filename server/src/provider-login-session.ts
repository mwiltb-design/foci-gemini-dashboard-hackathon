import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebSocket } from 'ws'
import pty from '@homebridge/node-pty-prebuilt-multiarch'

const LOGIN_ARGS = ['--no-context-files', '--no-extensions', '--no-skills', '--no-prompt-templates']

function resolvePiCli(): string {
  try {
    const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
    return resolve(dirname(fileURLToPath(mainUrl)), 'cli.js')
  } catch {
    return resolve(process.cwd(), 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js')
  }
}

export class ProviderLoginSession {
  private ptyProcess: any = null
  private browser: WebSocket | null = null
  private loginTimer: NodeJS.Timeout | null = null

  get active(): boolean {
    return this.ptyProcess !== null
  }

  attach(browser: WebSocket): void {
    if (this.active) {
      browser.close(1013, 'A provider login is already open')
      return
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLUMNS: '100',
      LINES: '28',
    }
    delete env.PI_DASHBOARD_AUTH_TOKEN

    const cliPath = resolvePiCli()
    const ptyModule = (pty as any).default || pty
    const proc = ptyModule.spawn(process.execPath, [cliPath, ...LOGIN_ARGS], {
      name: 'xterm-256color',
      cols: 100,
      rows: 28,
      cwd: tmpdir(),
      env,
    })

    this.ptyProcess = proc
    this.browser = browser

    proc.onData((data: string) => {
      if (browser.readyState === browser.OPEN) {
        browser.send(Buffer.from(data, 'utf8'))
      }
    })

    this.loginTimer = setTimeout(() => {
      if (this.ptyProcess === proc) {
        proc.write('/login\r')
      }
    }, 1_800)

    const finish = (code = 1000, reason = 'Provider login console closed'): void => {
      if (this.loginTimer) clearTimeout(this.loginTimer)
      this.loginTimer = null
      if (this.ptyProcess === proc) this.ptyProcess = null
      if (this.browser === browser) this.browser = null
      if (browser.readyState === browser.OPEN) browser.close(code, reason.slice(0, 120))
    }

    proc.onExit(() => finish())

    browser.on('message', (data) => {
      if (this.ptyProcess !== proc) return
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : new TextDecoder().decode(data as ArrayBuffer)
      proc.write(text)
    })

    browser.once('error', () => void this.stop())
    browser.once('close', () => void this.stop())
  }

  async stop(): Promise<void> {
    const proc = this.ptyProcess
    if (!proc) return
    if (this.loginTimer) clearTimeout(this.loginTimer)
    this.loginTimer = null
    this.ptyProcess = null
    this.browser = null
    try {
      proc.kill()
    } catch {}
  }
}
