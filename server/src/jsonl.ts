import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

export function attachJsonlReader(stream: Readable, onLine: (line: string) => void): () => void {
  const decoder = new StringDecoder('utf8')
  let buffer = ''

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    drain()
  }

  const drain = () => {
    while (true) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) return
      let line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      if (line.length > 0) onLine(line)
    }
  }

  const onEnd = () => {
    buffer += decoder.end()
    if (buffer.length > 0) onLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer)
    buffer = ''
  }

  stream.on('data', onData)
  stream.on('end', onEnd)

  return () => {
    stream.off('data', onData)
    stream.off('end', onEnd)
  }
}
