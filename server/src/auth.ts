import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

const COOKIE_NAME = 'pi_dashboard_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000

function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function cookieValue(headers: IncomingHttpHeaders): string | undefined {
  const cookie = headers.cookie ?? ''
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE_NAME) return decodeURIComponent(value.join('='))
  }
  return undefined
}

export class DashboardAuth {
  private readonly sessions = new Map<string, number>()
  private token: string | undefined = undefined

  constructor(initialToken?: string) {
    if (initialToken) {
      this.setToken(initialToken)
    }
  }

  get enabled(): boolean {
    return this.token !== undefined
  }

  setToken(token: string | undefined): void {
    const clean = token?.trim()
    this.token = clean ? clean : undefined
  }

  authenticate(request: { headers: IncomingHttpHeaders }): boolean {
    if (!this.enabled) return true
    const session = cookieValue(request.headers)
    const expiresAt = session ? this.sessions.get(session) : undefined
    if (!session || !expiresAt || expiresAt <= Date.now()) {
      if (session) this.sessions.delete(session)
      return false
    }
    this.sessions.set(session, Date.now() + SESSION_TTL_MS)
    return true
  }

  login(request: { headers: IncomingHttpHeaders }, response: ServerResponse, suppliedToken: unknown): boolean {
    if (!this.enabled) return true
    if (typeof suppliedToken !== 'string' || suppliedToken.length > 512) return false
    const supplied = tokenDigest(suppliedToken)
    const expected = tokenDigest(this.token!)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false
    const session = randomBytes(32).toString('base64url')
    this.sessions.set(session, Date.now() + SESSION_TTL_MS)
    response.setHeader('set-cookie', `${COOKIE_NAME}=${encodeURIComponent(session)}; HttpOnly; Path=/; SameSite=Strict${this.isSecure(request) ? '; Secure' : ''}`)
    return true
  }

  logout(request: { headers: IncomingHttpHeaders }, response: ServerResponse): void {
    const session = cookieValue(request.headers)
    if (session) this.sessions.delete(session)
    response.setHeader('set-cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict${this.isSecure(request) ? '; Secure' : ''}`)
  }

  originAllowed(request: { headers: IncomingHttpHeaders }, allowedOrigins: Set<string>, required = false): boolean {
    const origin = request.headers.origin
    if (typeof origin !== 'string') return false
    let isAllowed = allowedOrigins.has(origin)
    if (!isAllowed) {
      try {
        const url = new URL(origin)
        if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) isAllowed = true
      } catch {}
    }
    return isAllowed && (!required || this.authenticate(request))
  }

  private isSecure(request: { headers: IncomingHttpHeaders }): boolean {
    return request.headers['x-forwarded-proto'] === 'https'
  }
}

export const authCookieName = COOKIE_NAME
