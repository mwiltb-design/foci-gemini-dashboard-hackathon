import { createHash, randomUUID } from 'node:crypto'
import { chmod, link, lstat, open, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'

const MAX_PREVIEW_BYTES = 1024 * 1024
const MAX_SEARCH_FILE_BYTES = 256 * 1024
const MAX_SEARCH_FILES = 5_000
const MAX_SEARCH_RESULTS = 200
const EXCLUDED_SEGMENTS = new Set(['.git', 'node_modules', 'dist'])
const SENSITIVE_NAMES = new Set(['.env', 'auth.json', 'credentials.json', 'secrets.json'])

function isSensitiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return SENSITIVE_NAMES.has(lower) || (lower.startsWith('.env.') && lower !== '.env.example') || (lower.startsWith('.pi-dashboard-') && lower.endsWith('.tmp')) || /\.(pem|key|p12|pfx)$/.test(lower)
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number
  modifiedAt: string
  hidden: boolean
}

export interface FilePreview {
  path: string
  name: string
  size: number
  modifiedAt: string
  content: string | null
  binary: boolean
  truncated: boolean
  language: string
  revision: string | null
}

export interface FileWriteResult {
  created: boolean
  file: FilePreview
}

export interface FileSearchResult {
  path: string
  name: string
  matches: Array<{ line: number; text: string }>
  nameMatch: boolean
}

export class FileAccessError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function slash(path: string): string {
  return path.split(sep).join('/')
}

function languageFor(path: string): string {
  const extension = path.includes('.') ? path.split('.').at(-1)?.toLowerCase() : ''
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', json: 'json', css: 'css', html: 'html',
    md: 'markdown', yml: 'yaml', yaml: 'yaml', sh: 'shell', bash: 'shell', py: 'python', txt: 'text',
  }
  return languages[extension ?? ''] ?? 'text'
}

function contentRevision(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return false
  } catch {
    return true
  }
}

export class FileService {
  private readonly root: string
  private mutationChain = Promise.resolve()

  constructor(root: string) {
    this.root = resolve(root)
  }

  validateRelative(input = ''): string {
    if (typeof input !== 'string' || input.includes('\0')) throw new FileAccessError('Invalid path')
    const normalized = input.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..')) throw new FileAccessError('Path is outside the workspace', 403)
    const segments = normalized.split('/').filter(Boolean)
    if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment) || isSensitiveName(segment))) throw new FileAccessError('This path is not available in the dashboard', 403)
    return segments.join('/')
  }

  async list(path = ''): Promise<FileEntry[]> {
    const safePath = this.validateRelative(path)
    const absolute = await this.existingPath(safePath)
    const info = await stat(absolute)
    if (!info.isDirectory()) throw new FileAccessError('Path is not a directory')

    const entries = await readdir(absolute, { withFileTypes: true })
    const result: FileEntry[] = []
    for (const entry of entries) {
      if (EXCLUDED_SEGMENTS.has(entry.name) || isSensitiveName(entry.name) || entry.isSymbolicLink()) continue
      if (!entry.isFile() && !entry.isDirectory()) continue
      const entryPath = safePath ? `${safePath}/${entry.name}` : entry.name
      const entryInfo = await lstat(resolve(absolute, entry.name))
      result.push({
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? entryInfo.size : 0,
        modifiedAt: entryInfo.mtime.toISOString(),
        hidden: entry.name.startsWith('.'),
      })
    }
    return result.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
  }

  async preview(path: string): Promise<FilePreview> {
    const safePath = this.validateRelative(path)
    if (!safePath) throw new FileAccessError('Select a file')
    const absolute = await this.existingPath(safePath)
    const info = await stat(absolute)
    if (!info.isFile()) throw new FileAccessError('Path is not a file')

    const handle = await open(absolute, 'r')
    const bytesToRead = Math.min(info.size, MAX_PREVIEW_BYTES + 1)
    const buffer = Buffer.alloc(bytesToRead)
    let bytesRead = 0
    try {
      bytesRead = (await handle.read(buffer, 0, bytesToRead, 0)).bytesRead
    } finally {
      await handle.close()
    }
    const sample = buffer.subarray(0, Math.min(bytesRead, MAX_PREVIEW_BYTES))
    const binary = isBinary(sample)
    return {
      path: safePath,
      name: basename(safePath),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      content: binary ? null : sample.toString('utf8'),
      binary,
      truncated: info.size > MAX_PREVIEW_BYTES,
      language: languageFor(safePath),
      revision: binary || info.size > MAX_PREVIEW_BYTES ? null : contentRevision(sample),
    }
  }

  async save(path: string, content: unknown, expectedRevision: unknown): Promise<FileWriteResult> {
    return this.mutate(async () => {
      const safePath = this.validateWriteInput(path, content)
      if (typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
        throw new FileAccessError('Refresh the file before saving it', 428)
      }
      const absolute = await this.existingPath(safePath)
      const info = await stat(absolute)
      if (!info.isFile()) throw new FileAccessError('Path is not a file')
      if (info.size > MAX_PREVIEW_BYTES) throw new FileAccessError('Files larger than 1 MB cannot be edited in the dashboard', 413)
      const current = await readFile(absolute)
      if (isBinary(current)) throw new FileAccessError('Binary files cannot be edited in the dashboard')
      if (contentRevision(current) !== expectedRevision) throw new FileAccessError('This file changed after you opened it. Refresh before saving.', 409)

      const temporary = resolve(dirname(absolute), `.pi-dashboard-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, content as string, { flag: 'wx', mode: info.mode })
        await chmod(temporary, info.mode)
        if (contentRevision(await readFile(absolute)) !== expectedRevision) throw new FileAccessError('This file changed while it was being saved. Refresh and try again.', 409)
        await rename(temporary, absolute)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
      }
      return { created: false, file: await this.preview(safePath) }
    })
  }

  async create(path: string, content: unknown = ''): Promise<FileWriteResult> {
    return this.mutate(async () => {
      const safePath = this.validateWriteInput(path, content)
      const parentPath = dirname(safePath) === '.' ? '' : dirname(safePath)
      const parent = await this.existingPath(parentPath)
      if (!(await stat(parent)).isDirectory()) throw new FileAccessError('Parent path is not a directory')
      const absolute = resolve(parent, basename(safePath))
      const temporary = resolve(parent, `.pi-dashboard-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, content as string, { flag: 'wx' })
        await link(temporary, absolute)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FileAccessError('A file with that name already exists', 409)
        throw error
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      return { created: true, file: await this.preview(safePath) }
    })
  }

  async search(query: string): Promise<FileSearchResult[]> {
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length < 2) throw new FileAccessError('Search must contain at least two characters')
    if (needle.length > 100) throw new FileAccessError('Search is too long')

    const files = await this.walk(this.root)
    const results: FileSearchResult[] = []
    for (const absolute of files) {
      if (results.length >= MAX_SEARCH_RESULTS) break
      const path = slash(relative(this.root, absolute))
      const name = basename(path)
      const nameMatch = name.toLocaleLowerCase().includes(needle)
      const info = await stat(absolute)
      const matches: Array<{ line: number; text: string }> = []
      if (info.size <= MAX_SEARCH_FILE_BYTES) {
        const buffer = await readFile(absolute)
        if (!isBinary(buffer)) {
          const lines = buffer.toString('utf8').split('\n')
          for (let index = 0; index < lines.length && matches.length < 5; index += 1) {
            if (lines[index].toLocaleLowerCase().includes(needle)) matches.push({ line: index + 1, text: lines[index].trim().slice(0, 240) })
          }
        }
      }
      if (nameMatch || matches.length) results.push({ path, name, nameMatch, matches })
    }
    return results
  }

  private validateWriteInput(path: string, content: unknown): string {
    const safePath = this.validateRelative(path)
    if (!safePath) throw new FileAccessError('Choose a file name')
    if (typeof content !== 'string') throw new FileAccessError('File content must be text')
    if (Buffer.byteLength(content) > MAX_PREVIEW_BYTES) throw new FileAccessError('Files are limited to 1 MB in the dashboard', 413)
    return safePath
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.then(operation)
    this.mutationChain = result.then(() => undefined, () => undefined)
    return result
  }

  private async existingPath(path: string): Promise<string> {
    const candidate = resolve(this.root, path)
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${sep}`)) throw new FileAccessError('Path is outside the workspace', 403)
    let canonical: string
    try {
      canonical = await realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FileAccessError('Path not found', 404)
      throw error
    }
    const canonicalRoot = await realpath(this.root)
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${sep}`)) throw new FileAccessError('Path is outside the workspace', 403)
    return canonical
  }

  private async walk(directory: string, results: string[] = []): Promise<string[]> {
    if (results.length >= MAX_SEARCH_FILES) return results
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (results.length >= MAX_SEARCH_FILES) break
      if (EXCLUDED_SEGMENTS.has(entry.name) || isSensitiveName(entry.name) || entry.isSymbolicLink()) continue
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await this.walk(path, results)
      else if (entry.isFile()) results.push(path)
    }
    return results
  }
}
