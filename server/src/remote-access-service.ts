import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export interface RemoteAccessState {
  enabled: boolean
  tailnetHost: string
  httpsPort: number
  tokenConfigured: boolean
  allowedOrigin: string
  serveCommand: string
  statusMessage: string
}

export class RemoteAccessService {
  private readonly configPath: string
  private data: {
    enabled: boolean
    tailnetHost: string
    httpsPort: number
    authToken?: string
  }

  constructor(customPath?: string) {
    const dataDir = resolve(homedir(), '.pi-dashboard')
    try { mkdirSync(dataDir, { recursive: true }) } catch {}
    this.configPath = customPath ?? resolve(dataDir, 'remote-access.json')
    this.data = this.load()
  }

  private load() {
    try {
      if (existsSync(this.configPath)) {
        const parsed = JSON.parse(readFileSync(this.configPath, 'utf8'))
        return {
          enabled: Boolean(parsed.enabled),
          tailnetHost: typeof parsed.tailnetHost === 'string' ? parsed.tailnetHost.trim() : '',
          httpsPort: typeof parsed.httpsPort === 'number' ? parsed.httpsPort : 8443,
          authToken: typeof parsed.authToken === 'string' && parsed.authToken.trim() ? parsed.authToken.trim() : undefined,
        }
      }
    } catch {}

    // Fallback to process.env if present
    const envToken = process.env.PI_DASHBOARD_AUTH_TOKEN?.trim()
    const envOrigin = process.env.PI_DASHBOARD_ALLOWED_ORIGINS?.split(',')[0]?.trim() || ''
    let envHost = process.env.DASHBOARD_ALLOWED_HOSTS?.split(',')[0]?.trim() || ''
    let envPort = 8443
    if (envOrigin) {
      try {
        const u = new URL(envOrigin)
        envHost = u.hostname
        envPort = u.port ? Number(u.port) : 8443
      } catch {}
    }

    const isTailnetHost = Boolean(envHost && !['localhost', '127.0.0.1'].includes(envHost))
    return {
      enabled: Boolean(envToken || isTailnetHost),
      tailnetHost: isTailnetHost ? envHost : '',
      httpsPort: envPort,
      authToken: envToken,
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), 'utf8')
    } catch {}
  }

  get(uiPort = 5173): RemoteAccessState {
    const host = this.data.tailnetHost || 'my-computer.tailnet.ts.net'
    const httpsPort = this.data.httpsPort || 8443
    const origin = this.data.tailnetHost ? `https://${this.data.tailnetHost}:${httpsPort}` : ''
    const serveCmd = `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${uiPort}`

    let statusMessage = 'Local-only mode. Password not required.'
    if (this.data.enabled) {
      if (this.data.authToken) {
        statusMessage = 'Protected. Password authentication active for remote access.'
      } else {
        statusMessage = 'Warning: Remote access enabled without a password token!'
      }
    }

    return {
      enabled: this.data.enabled,
      tailnetHost: this.data.tailnetHost,
      httpsPort,
      tokenConfigured: Boolean(this.data.authToken),
      allowedOrigin: origin,
      serveCommand: serveCmd,
      statusMessage,
    }
  }

  getToken(): string | undefined {
    return this.data.authToken
  }

  getAllowedOrigin(): string | undefined {
    if (!this.data.enabled || !this.data.tailnetHost) return undefined
    return `https://${this.data.tailnetHost}:${this.data.httpsPort || 8443}`
  }

  getTailnetHost(): string | undefined {
    if (!this.data.enabled || !this.data.tailnetHost) return undefined
    return this.data.tailnetHost
  }

  update(input: {
    enabled?: boolean
    tailnetHost?: string
    httpsPort?: number
    password?: string
  }, uiPort = 5173): RemoteAccessState {
    if (typeof input.enabled === 'boolean') {
      this.data.enabled = input.enabled
    }
    if (typeof input.tailnetHost === 'string') {
      this.data.tailnetHost = input.tailnetHost.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/:.*$/, '')
    }
    if (typeof input.httpsPort === 'number' && input.httpsPort > 0 && input.httpsPort <= 65535) {
      this.data.httpsPort = input.httpsPort
    }
    if (input.password !== undefined) {
      const cleanPass = input.password.trim()
      this.data.authToken = cleanPass ? cleanPass : undefined
    }

    this.persist()
    return this.get(uiPort)
  }
}
