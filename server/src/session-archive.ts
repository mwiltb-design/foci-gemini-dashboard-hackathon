import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface ArchiveDocument {
  version: 1
  archived: Record<string, string>
}

export class SessionArchiveService {
  private document: ArchiveDocument = { version: 1, archived: {} }

  constructor(private readonly path: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<ArchiveDocument>
      if (parsed.version !== 1 || !parsed.archived || typeof parsed.archived !== 'object' || Array.isArray(parsed.archived)) throw new Error('Invalid session archive data')
      this.document = { version: 1, archived: Object.fromEntries(Object.entries(parsed.archived).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  isArchived(id: string): boolean { return Boolean(this.document.archived[id]) }
  count(): number { return Object.keys(this.document.archived).length }

  async archive(id: string): Promise<void> {
    if (this.isArchived(id)) return
    this.document.archived[id] = new Date().toISOString()
    await this.save()
  }

  async restore(id: string): Promise<void> {
    if (!this.isArchived(id)) return
    delete this.document.archived[id]
    await this.save()
  }

  async archiveInactive(sessions: Array<{ id: string; updatedAt: string }>, activeSessionId?: string, days = 30): Promise<void> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    let changed = false
    for (const session of sessions) {
      if (session.id === activeSessionId || this.isArchived(session.id) || Date.parse(session.updatedAt) >= cutoff) continue
      this.document.archived[session.id] = new Date().toISOString()
      changed = true
    }
    if (changed) await this.save()
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, 'utf8')
    await rename(temporary, this.path)
  }
}
