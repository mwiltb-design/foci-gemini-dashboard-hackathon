import { chmod, lstat, mkdir, rm } from 'node:fs/promises'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { dirname } from 'node:path'

const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/
const SOCKET_PROBE_TIMEOUT_MS = 500

export interface PluginRuntimeRequest {
  method: string
  path: string
  query: URLSearchParams
  headers: Readonly<Record<string, string | string[] | undefined>>
  body: Buffer
  json<T = unknown>(): T
}

export interface PluginRuntimeResponse {
  status?: number
  headers?: Record<string, string>
  body?: string | Buffer | Record<string, unknown> | unknown[] | null
}

export interface PluginRuntimeOptions {
  pluginId: string
  version: string
  socketPath: string
  dataPath: string
  socketMode?: 0o600 | 0o660
  handle(request: PluginRuntimeRequest): Promise<PluginRuntimeResponse> | PluginRuntimeResponse
}

export interface RunningPluginRuntime {
  pluginId: string
  socketPath: string
  dataPath: string
  close(): Promise<void>
}

export class PluginRuntimeRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new PluginRuntimeRequestError('Request body is too large', 413)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function send(response: ServerResponse, result: PluginRuntimeResponse): void {
  let payload: Buffer
  const headers = { ...(result.headers ?? {}) }
  if (Buffer.isBuffer(result.body)) payload = result.body
  else if (typeof result.body === 'string') payload = Buffer.from(result.body)
  else {
    payload = Buffer.from(JSON.stringify(result.body ?? null))
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json; charset=utf-8'
  }
  if (payload.length > MAX_RESPONSE_BYTES) throw new PluginRuntimeRequestError('Response body is too large', 500)
  response.writeHead(result.status ?? 200, { ...headers, 'content-length': String(payload.length) })
  response.end(payload)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function socketAcceptsConnections(socketPath: string, pluginId: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (active: boolean) => {
      if (settled) return
      settled = true
      resolve(active)
    }
    const request = httpRequest({
      socketPath, method: 'GET', path: '/_health', headers: { 'x-pi-dashboard-plugin-id': pluginId }, timeout: SOCKET_PROBE_TIMEOUT_MS,
    }, (response) => {
      response.resume()
      finish(true)
    })
    request.on('socket', (socket) => socket.once('connect', () => { finish(true); request.destroy() }))
    request.on('timeout', () => request.destroy())
    request.on('error', () => finish(false))
    request.end()
  })
}

async function prepareSocket(socketPath: string, pluginId: string): Promise<void> {
  try {
    const info = await lstat(socketPath)
    if (!info.isSocket()) throw new Error('Plugin runtime socket path already exists and is not a socket')
    if (await socketAcceptsConnections(socketPath, pluginId)) throw new Error('Plugin runtime socket is already active')
    await rm(socketPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function startPluginRuntime(options: PluginRuntimeOptions): Promise<RunningPluginRuntime> {
  if (!PLUGIN_ID_PATTERN.test(options.pluginId)) throw new Error('Plugin runtime id is invalid')
  if (!options.socketPath.replaceAll('\\', '/').endsWith(`/${options.pluginId}.sock`)) throw new Error('Plugin runtime socket must use its plugin id')
  await mkdir(options.dataPath, { recursive: true, mode: 0o700 })
  await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 })
  await prepareSocket(options.socketPath, options.pluginId)
  const startedAt = new Date().toISOString()

  const server = createServer(async (incoming, response) => {
    try {
      if (incoming.headers['x-pi-dashboard-plugin-id'] !== options.pluginId) throw new PluginRuntimeRequestError('Plugin identity header is missing or invalid', 403)
      const url = new URL(incoming.url ?? '/', 'http://plugin.local')
      if (url.pathname === '/_health') {
        send(response, { body: { ok: true, pluginId: options.pluginId, version: options.version, startedAt } })
        return
      }
      const requestBody = await body(incoming)
      const request: PluginRuntimeRequest = {
        method: incoming.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: incoming.headers, body: requestBody,
        json<T>() {
          try { return JSON.parse(requestBody.toString('utf8') || '{}') as T }
          catch { throw new PluginRuntimeRequestError('Request body is invalid JSON') }
        },
      }
      send(response, await options.handle(request))
    } catch (error) {
      const status = error instanceof PluginRuntimeRequestError ? error.status : 500
      const message = error instanceof PluginRuntimeRequestError ? error.message : 'Plugin runtime request failed'
      if (!response.headersSent) send(response, { status, body: { error: message } })
      else response.destroy()
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.socketPath, resolve) })
  if (process.platform !== 'win32') {
    await chmod(options.socketPath, options.socketMode ?? 0o600).catch(() => undefined)
  }

  let closed = false
  return {
    pluginId: options.pluginId,
    socketPath: options.socketPath,
    dataPath: options.dataPath,
    async close() {
      if (closed) return
      closed = true
      await closeServer(server)
      await rm(options.socketPath, { force: true })
    },
  }
}

export async function runPluginRuntime(options: PluginRuntimeOptions): Promise<void> {
  const runtime = await startPluginRuntime(options)
  const shutdown = async () => {
    await runtime.close().catch(() => undefined)
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())
}
