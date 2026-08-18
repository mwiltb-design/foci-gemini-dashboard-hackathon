import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isSafePluginPath, type PluginManifestV1 } from '../../packages/plugin-sdk/src/index.js'

export class PluginHostError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
  }
}

export interface PluginHostStorage {
  readJson<T = unknown>(path: string, fallback?: T): Promise<T>
  writeJson(path: string, value: unknown): Promise<void>
  readText(path: string): Promise<string | null>
  writeText(path: string, value: string): Promise<void>
  transaction<T>(operation: (storage: Omit<PluginHostStorage, 'transaction'>) => Promise<T>): Promise<T>
}

export interface PluginHostContext {
  plugin: {
    id: string
    version: string
  }
  storage: PluginHostStorage
  json(body: unknown, status?: number, headers?: Record<string, string>): PluginHostResponse
  text(body: string, status?: number, headers?: Record<string, string>): PluginHostResponse
}

export interface PluginHostRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query: URLSearchParams
  headers: Record<string, string | string[] | undefined>
  body: unknown
  json<T = unknown>(): T
}

export interface PluginHostResponse {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

export interface PluginHostHandler {
  handle(request: PluginHostRequest, context: PluginHostContext): Promise<PluginHostResponse | void> | PluginHostResponse | void
}

function resolveStoragePath(dataDir: string, relativePath: string): string {
  if (!isSafePluginPath(relativePath)) {
    throw new PluginHostError(`Storage path "${relativePath}" must be a safe relative path`, 400)
  }
  const resolved = resolve(dataDir, relativePath)
  const resolvedDataDir = resolve(dataDir)
  if (resolved !== resolvedDataDir && !resolved.startsWith(`${resolvedDataDir}/`) && !resolved.startsWith(`${resolvedDataDir}\\`)) {
    throw new PluginHostError(`Storage path "${relativePath}" escapes plugin storage directory`, 400)
  }
  return resolved
}

function createStorage(dataDir: string): PluginHostStorage {
  let mutations = Promise.resolve()
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutations.then(operation, operation)
    mutations = result.then(() => undefined, () => undefined)
    return result
  }

  const storage: PluginHostStorage = {
    async readJson<T>(relativePath: string, fallback?: T): Promise<T> {
      const filePath = resolveStoragePath(dataDir, relativePath)
      try {
        const text = await readFile(filePath, 'utf8')
        return JSON.parse(text) as T
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && fallback !== undefined) {
          return fallback
        }
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new PluginHostError(`Storage file not found: ${relativePath}`, 404)
        }
        throw error
      }
    },

    async writeJson(relativePath: string, value: unknown): Promise<void> {
      const filePath = resolveStoragePath(dataDir, relativePath)
      await mutate(async () => {
        await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
        const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, filePath)
      })
    },

    async readText(relativePath: string): Promise<string | null> {
      const filePath = resolveStoragePath(dataDir, relativePath)
      try {
        return await readFile(filePath, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    },

    async writeText(relativePath: string, value: string): Promise<void> {
      const filePath = resolveStoragePath(dataDir, relativePath)
      await mutate(async () => {
        await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
        const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
        await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, filePath)
      })
    },

    async transaction<T>(operation: (transactionStorage: Omit<PluginHostStorage, 'transaction'>) => Promise<T>): Promise<T> {
      const transactionStorage = {
        readJson: storage.readJson.bind(storage),
        writeJson: async (relativePath: string, value: unknown): Promise<void> => {
          const filePath = resolveStoragePath(dataDir, relativePath)
          await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
          const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
          await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
          await rename(temporary, filePath)
        },
        readText: storage.readText.bind(storage),
        writeText: async (relativePath: string, value: string): Promise<void> => {
          const filePath = resolveStoragePath(dataDir, relativePath)
          await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
          const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
          await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
          await rename(temporary, filePath)
        },
      }
      return mutate(() => operation(transactionStorage))
    },
  }
  return storage
}

export class PluginHost {
  private readonly modules = new Map<string, { handler: PluginHostHandler; context: PluginHostContext }>()

  constructor(private readonly stateRoot: string) {}

  async loadPlugin(pluginDirectory: string, manifest: PluginManifestV1): Promise<void> {
    if (manifest.entry.backend?.protocol !== 'host-module') {
      throw new PluginHostError(`Plugin ${manifest.id} does not use host-module protocol`, 400)
    }

    const moduleRelative = manifest.entry.backend.module ?? 'server.ts'
    if (!isSafePluginPath(moduleRelative)) {
      throw new PluginHostError(`Invalid module path for plugin ${manifest.id}`, 400)
    }

    const moduleFile = join(pluginDirectory, moduleRelative)
    const dataDir = join(this.stateRoot, 'data', manifest.id)
    await mkdir(dataDir, { recursive: true, mode: 0o700 })

    const storage = createStorage(dataDir)
    const context: PluginHostContext = {
      plugin: {
        id: manifest.id,
        version: manifest.version,
      },
      storage,
      json(body: unknown, status = 200, headers?: Record<string, string>): PluginHostResponse {
        return {
          status,
          headers: { 'content-type': 'application/json; charset=utf-8', ...(headers ?? {}) },
          body,
        }
      },
      text(body: string, status = 200, headers?: Record<string, string>): PluginHostResponse {
        return {
          status,
          headers: { 'content-type': 'text/plain; charset=utf-8', ...(headers ?? {}) },
          body,
        }
      },
    }

    try {
      const url = `${pathToFileURL(resolve(moduleFile)).href}?version=${encodeURIComponent(manifest.version)}&loaded=${randomUUID()}`
      const imported = await import(url) as unknown
      const handlerCandidate = (imported as Record<string, unknown>).default ?? imported
      if (!handlerCandidate || typeof handlerCandidate !== 'object' || typeof (handlerCandidate as Record<string, unknown>).handle !== 'function') {
        throw new PluginHostError(`Module "${moduleRelative}" in plugin "${manifest.id}" must export a default object with a handle(request, context) function`, 500)
      }

      this.modules.set(manifest.id, {
        handler: handlerCandidate as PluginHostHandler,
        context,
      })
    } catch (error) {
      if (error instanceof PluginHostError) throw error
      throw new PluginHostError(`Failed to load plugin module for ${manifest.id}: ${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }

  unloadPlugin(pluginId: string): void {
    this.modules.delete(pluginId)
  }

  isLoaded(pluginId: string): boolean {
    return this.modules.has(pluginId)
  }

  async handleRequest(
    pluginId: string,
    rawRequest: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      path: string
      query?: URLSearchParams
      headers?: Record<string, string | string[] | undefined>
      body?: unknown
    },
  ): Promise<PluginHostResponse> {
    const entry = this.modules.get(pluginId)
    if (!entry) {
      throw new PluginHostError(`Hosted plugin "${pluginId}" is not loaded`, 404)
    }

    const request: PluginHostRequest = {
      method: rawRequest.method,
      path: rawRequest.path,
      query: rawRequest.query ?? new URLSearchParams(),
      headers: rawRequest.headers ?? {},
      body: rawRequest.body,
      json<T>(): T {
        if (rawRequest.body && typeof rawRequest.body === 'object') return rawRequest.body as T
        if (typeof rawRequest.body === 'string') {
          try { return JSON.parse(rawRequest.body) as T } catch { throw new PluginHostError('Request body is invalid JSON', 400) }
        }
        if (Buffer.isBuffer(rawRequest.body)) {
          try { return JSON.parse(rawRequest.body.toString('utf8')) as T } catch { throw new PluginHostError('Request body is invalid JSON', 400) }
        }
        return (rawRequest.body ?? {}) as T
      },
    }

    try {
      const result = await entry.handler.handle(request, entry.context)
      if (!result) return { status: 200 }
      return {
        status: result.status ?? 200,
        headers: result.headers,
        body: result.body,
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && typeof (error as Record<string, unknown>).status === 'number') {
        const errObj = error as Record<string, unknown>
        return {
          status: errObj.status as number,
          body: { error: typeof errObj.message === 'string' ? errObj.message : 'Plugin request failed' },
        }
      }
      if (error instanceof PluginHostError) {
        return { status: error.status, body: { error: error.message } }
      }
      throw error
    }
  }
}
