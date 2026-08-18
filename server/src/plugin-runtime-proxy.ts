import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'

const MAX_REQUEST_BYTES = 1024 * 1024
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const RUNTIME_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 2_000
const MAX_HEALTH_BYTES = 32 * 1024
const REQUEST_HEADERS = new Set(['accept', 'content-type', 'if-match'])
const RESPONSE_HEADERS = new Set(['content-type', 'etag', 'last-modified', 'cache-control'])

export class PluginRuntimeError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
  }
}

export async function probePluginRuntime(options: { pluginId: string; version: string; socketPath: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest({
      socketPath: options.socketPath,
      method: 'GET',
      path: '/_health',
      headers: { 'x-pi-dashboard-plugin-id': options.pluginId },
      timeout: HEALTH_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_HEALTH_BYTES) response.destroy(new PluginRuntimeError('Plugin health response is too large'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new PluginRuntimeError('Plugin runtime is not healthy', 503)
          const health = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          if (health.ok !== true || health.pluginId !== options.pluginId || health.version !== options.version) {
            throw new PluginRuntimeError('Plugin runtime identity or version does not match', 409)
          }
          resolve()
        } catch (error) {
          reject(error instanceof PluginRuntimeError ? error : new PluginRuntimeError('Plugin health response is invalid'))
        }
      })
    })
    request.on('timeout', () => request.destroy(new PluginRuntimeError('Plugin health check timed out', 504)))
    request.on('error', (error) => reject(error instanceof PluginRuntimeError ? error : new PluginRuntimeError('Plugin runtime is unavailable', 503)))
    request.end()
  })
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_REQUEST_BYTES) throw new PluginRuntimeError('Plugin request body is too large', 413)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function proxyPluginRuntime(
  request: IncomingMessage,
  response: ServerResponse,
  options: { pluginId: string; socketPath: string; path: string },
): Promise<void> {
  if (!options.path.startsWith('/') || options.path.startsWith('//')) throw new PluginRuntimeError('Plugin runtime path is invalid', 400)
  const body = await requestBody(request)
  const headers: Record<string, string> = {
    'content-length': String(body.length),
    'x-pi-dashboard-plugin-id': options.pluginId,
  }
  for (const [name, value] of Object.entries(request.headers)) {
    if (!REQUEST_HEADERS.has(name) || value === undefined) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }

  await new Promise<void>((resolve, reject) => {
    const upstream = httpRequest({
      socketPath: options.socketPath,
      method: request.method,
      path: options.path,
      headers,
      timeout: RUNTIME_TIMEOUT_MS,
    }, (result) => {
      const safeHeaders: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(result.headers)) {
        if (RESPONSE_HEADERS.has(name) && value !== undefined) safeHeaders[name] = value
      }
      const chunks: Buffer[] = []
      let size = 0
      result.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) result.destroy(new PluginRuntimeError('Plugin response is too large', 502))
        else chunks.push(chunk)
      })
      result.on('error', reject)
      result.on('end', () => {
        if (response.headersSent) return resolve()
        response.writeHead(result.statusCode ?? 502, safeHeaders)
        response.end(Buffer.concat(chunks))
        resolve()
      })
    })
    upstream.on('timeout', () => upstream.destroy(new PluginRuntimeError('Plugin runtime timed out', 504)))
    upstream.on('error', (error) => reject(error instanceof PluginRuntimeError ? error : new PluginRuntimeError('Plugin runtime is unavailable', 503)))
    upstream.end(body)
  })
}
