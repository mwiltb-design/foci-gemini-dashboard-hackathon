import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { WebSocket } from 'ws'
import pty from '@homebridge/node-pty-prebuilt-multiarch'
import { findExecutable, resolveExecutable } from './process-control.js'
import { syncGeminiAuth } from './gemini-auth-sync.js'

export class WorkerConsoleSession {
  private ptyProcess: any = null
  private browser: WebSocket | null = null

  get active(): boolean {
    return this.ptyProcess !== null
  }

  attach(browser: WebSocket, providerId: string, mode: 'login' | 'manage', cwd: string): void {
    if (this.active) {
      // Cloud/browser reconnects can leave an orphaned PTY for a moment. Prefer the newest console.
      const previous = this.ptyProcess
      this.ptyProcess = null
      if (this.browser?.readyState === 1) {
        try { this.browser.close(1012, 'Replaced by a new worker console') } catch {}
      }
      this.browser = null
      try { previous.kill() } catch {}
      if (providerId === 'antigravity-cli') syncGeminiAuth('persist')
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

    let rawBinary = 'pi'
    let args: string[] = []

    if (providerId === 'antigravity-cli') {
      rawBinary = 'agy'
      args = []
      syncGeminiAuth('restore')
      const persistentGeminiDir = process.env.PI_DASHBOARD_ANTIGRAVITY_HOME || process.env.ANTIGRAVITY_HOME || resolve(homedir(), '.gemini')
      const localGeminiDir = resolve(homedir(), '.gemini')
      try {
        mkdirSync(persistentGeminiDir, { recursive: true })
        mkdirSync(resolve(persistentGeminiDir, 'antigravity-cli'), { recursive: true })
        mkdirSync(resolve(persistentGeminiDir, 'antigravity-cli', 'log'), { recursive: true })
        mkdirSync(resolve(persistentGeminiDir, 'antigravity-cli', 'crashes'), { recursive: true })
        mkdirSync(localGeminiDir, { recursive: true })
        mkdirSync(resolve(localGeminiDir, 'antigravity-cli'), { recursive: true })
        mkdirSync(resolve(localGeminiDir, 'antigravity-cli', 'log'), { recursive: true })
        mkdirSync(resolve(localGeminiDir, 'antigravity-cli', 'crashes'), { recursive: true })
      } catch {}
      env.HOME = homedir()
      env.ANTIGRAVITY_HOME = persistentGeminiDir
      delete env.GEMINI_API_KEY
      delete env.GOOGLE_API_KEY
    } else if (providerId === 'codex-cli') {
      rawBinary = 'codex'
      args = mode === 'login' ? ['login', '--device-auth'] : []
    } else if (providerId === 'claude-cli') {
      rawBinary = 'claude'
      args = mode === 'login' ? ['login'] : []
    }

    const command = resolveExecutable(rawBinary)
    const executableFound = Boolean(findExecutable(rawBinary))

    if (!executableFound && rawBinary !== 'pi') {
      const friendlyName = providerId === 'antigravity-cli' ? 'Antigravity CLI' : providerId === 'codex-cli' ? 'Codex CLI' : 'Claude CLI'
      const banner = [
        '\r\n\x1b[36m─────────────────────────────────────────────────────────────────────────────\x1b[0m\r\n',
        `\x1b[1;33m  ✦  ${friendlyName} (\`${rawBinary}\`) is not installed on this server.\x1b[0m\r\n\r\n`,
        '  \x1b[32m✔\x1b[0m \x1b[1mIn Google Cloud Run:\x1b[0m Use the built-in \x1b[36mGemini Worker\x1b[0m for autonomous tasks.\r\n',
        `  \x1b[32m✔\x1b[0m \x1b[1mFor ${friendlyName}:\x1b[0m Run Foci Dashboard on your local computer where the CLI is installed.\r\n`,
        '\x1b[36m─────────────────────────────────────────────────────────────────────────────\x1b[0m\r\n\r\n',
      ].join('')

      this.browser = browser
      setTimeout(() => {
        if (browser.readyState === 1 /* WebSocket.OPEN */) {
          browser.send(JSON.stringify({ type: 'ready' }))
          browser.send(JSON.stringify({ type: 'output', data: banner }))
          browser.send(JSON.stringify({ type: 'exit', exitCode: 0 }))
        }
      }, 50)
      return
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
        if (providerId === 'antigravity-cli') syncGeminiAuth('persist')
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
        if (this.browser === browser) this.browser = null
        if (providerId === 'antigravity-cli') syncGeminiAuth('persist')
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
    syncGeminiAuth('persist')
  }
}
