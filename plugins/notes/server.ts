import { randomUUID } from 'node:crypto'
import type { PluginHostContext, PluginHostRequest, PluginHostResponse } from '../../server/src/plugin-host.js'

const MAX_NOTES = 200
const MAX_TEXT = 240

interface Note {
  id: string
  text: string
  createdAt: string
}

function textFrom(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw { status: 400, message: 'Note body must be an object' }
  }
  const rawText = (body as Record<string, unknown>).text
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  if (!text || text.length > MAX_TEXT) {
    throw { status: 400, message: `Note text must contain 1-${MAX_TEXT} characters` }
  }
  return text
}

function idFrom(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw { status: 400, message: 'Delete body must be an object' }
  }
  const id = (body as Record<string, unknown>).id
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
    throw { status: 400, message: 'Note ID is invalid' }
  }
  return id
}

export default {
  async handle(request: PluginHostRequest, context: PluginHostContext): Promise<PluginHostResponse> {
    const path = request.path
    const method = request.method

    if ((path === '/notes' || path === '/agent/notes') && method === 'GET') {
      const notes = await context.storage.readJson<Note[]>('notes.json', [])
      return context.json({ notes })
    }

    if ((path === '/notes' || path === '/agent/notes') && method === 'POST') {
      const text = textFrom(request.json())
      const note = await context.storage.transaction(async (storage) => {
        const notes = await storage.readJson<Note[]>('notes.json', [])
        if (notes.length >= MAX_NOTES) {
          throw { status: 409, message: `Shared Notes is limited to ${MAX_NOTES} items` }
        }
        const created: Note = { id: randomUUID(), text, createdAt: new Date().toISOString() }
        notes.unshift(created)
        await storage.writeJson('notes.json', notes)
        return created
      })
      return context.json({ note }, 201)
    }

    if ((path === '/notes' || path === '/agent/notes') && method === 'DELETE') {
      const id = idFrom(request.json())
      await context.storage.transaction(async (storage) => {
        const notes = await storage.readJson<Note[]>('notes.json', [])
        const remaining = notes.filter((n) => n.id !== id)
        if (remaining.length === notes.length) {
          throw { status: 404, message: 'Note not found' }
        }
        await storage.writeJson('notes.json', remaining)
      })
      return context.json({ ok: true, id })
    }

    return context.json({ error: 'Shared Notes route not found' }, 404)
  },
}
