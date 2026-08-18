import type { IncomingHttpHeaders } from 'node:http'

const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

export function safePreviewHeaders(source: IncomingHttpHeaders, host = 'preview.internal'): IncomingHttpHeaders {
  const safe: IncomingHttpHeaders = {}
  for (const [name, value] of Object.entries(source)) {
    if (!HOP_BY_HOP_HEADERS.has(name) && name !== 'cookie' && name !== 'authorization' && name !== 'host') safe[name] = value
  }
  safe.host = host
  return safe
}
