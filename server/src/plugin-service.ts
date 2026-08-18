import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  PLUGIN_ID_PATTERN,
  comparePluginVersions,
  isSafePluginPath,
  satisfiesPluginDashboardVersion,
  validatePluginManifest,
  type PluginBackendProtocol,
  type PluginManifestV1 as PluginManifest,
  type PluginPermission,
} from '../../packages/plugin-sdk/src/index.js'
import { processGroupOptions, terminateProcess } from './process-control.js'
import { PluginRuntimeError, probePluginRuntime } from './plugin-runtime-proxy.js'
import { PluginHost } from './plugin-host.js'

const BUNDLED_PLUGIN_PERMISSIONS: PluginPermission[] = ['plugin-data:read', 'plugin-data:write', 'dashboard-theme:read', 'dashboard-notifications:write']
const DASHBOARD_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version
const GITHUB_REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/
const LOCAL_REPOSITORY = /^local:([A-Za-z0-9._/-]+)$/
const WORKSPACE_REPOSITORY = /^workspace:([A-Za-z0-9._/-]+)$/
const MAX_MANIFEST_BYTES = 32 * 1024
const MAX_ASSET_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024
const MAX_PACKAGE_FILES = 200
const REVIEW_TTL_MS = 30 * 60_000

export interface PluginSummary {
  id: string
  name: string
  version: string
  dashboardVersion?: string
  description: string
  icon: string
  enabled: boolean
  frontendUrl: string
  permissions: string[]
  source: 'bundled' | 'repository'
  removable: boolean
  repository?: string
  commit?: string
  digest?: string
  rollbackAvailable: boolean
  backend: boolean
  runtimeStatus?: 'not-applicable' | 'disabled' | 'healthy' | 'unavailable' | 'version-mismatch'
  storageBytes?: number
  agentTools: Array<{ name: string; label: string; description: string; access: 'read' | 'write'; parameterNames: string[] }>
  agentSkills: Array<{ name: string; description: string; access?: 'read' | 'write' }>
  agentAccess: { read: boolean; write: boolean }
}

export interface PluginSkillCatalogItem {
  path: string
  name: string
  description: string
  enabled: boolean
  plugin: {
    id: string
    name: string
    enabled: boolean
    access?: 'read' | 'write'
    granted: boolean
  }
}

export interface PluginReview {
  reviewId: string
  digest: string
  repository: string
  commit: string
  plugin: Pick<PluginSummary, 'id' | 'name' | 'version' | 'dashboardVersion' | 'description' | 'icon' | 'permissions'>
  files: Array<{ path: string; size: number }>
  totalBytes: number
  expiresAt: string
  operation: 'install' | 'upgrade'
  currentVersion?: string
}

interface PluginSource {
  repository: string
  commit: string
  digest?: string
}

interface InstalledPlugin {
  directory: string
  manifest: PluginManifest
  source: 'bundled' | 'repository'
  provenance?: PluginSource
}

interface StagedReview {
  review: PluginReview
  packageDirectory: string
  stagingDirectory: string
}

interface PluginRegistry {
  schemaVersion: 1
  enabled: Record<string, boolean>
  agentAccess: Record<string, { read: boolean; write: boolean }>
}

export interface PluginServiceOptions {
  bundledRoot: string
  stateRoot: string
  localRepositoryRoot?: string
  workspaceRoot?: string
  runtimeSocketRoot?: string
  assetCapability?: string
}

export class PluginError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message)
  }
}

function safeRelativePath(value: unknown, field: string): string {
  if (!isSafePluginPath(value)) throw new PluginError(`Plugin ${field} must be a safe relative path`)
  return value
}

function parseManifest(raw: unknown, options: { expectedId?: string; bundled?: boolean; hostedRepository?: boolean; requireDashboardVersion?: boolean } = {}): PluginManifest {
  const result = validatePluginManifest(raw, {
    ...(options.expectedId ? { expectedId: options.expectedId } : {}),
    supportedPermissions: options.bundled || options.hostedRepository ? BUNDLED_PLUGIN_PERMISSIONS : [],
    allowBackend: options.bundled || options.hostedRepository,
    allowAgent: options.bundled || options.hostedRepository,
    requireDashboardVersion: options.requireDashboardVersion,
  })
  if (!result.success) throw new PluginError(result.errors[0] ?? 'Plugin manifest is invalid')
  if (options.hostedRepository && result.manifest.entry.backend?.protocol === 'http-unix-v1') {
    throw new PluginError('Repository plugins must use the hosted backend runtime', 409)
  }
  return result.manifest
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8', '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  }
  return types[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

async function git(args: string[], cwd?: string, maxBytes = MAX_PACKAGE_BYTES + 1024 * 1024): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      ...processGroupOptions(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise(Buffer.concat(stdout))
    }
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        terminateProcess(child, 'SIGKILL')
        finish(new PluginError('Repository output exceeds the installer limit', 413))
      } else target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', (error) => finish(new PluginError(`Unable to run Git: ${error.message}`, 502)))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) finish(new PluginError(`Git could not read the repository: ${Buffer.concat(stderr).toString('utf8').trim().slice(0, 500) || `exit ${code}`}`, 422))
      else finish()
    })
    const timer = setTimeout(() => {
      terminateProcess(child, 'SIGKILL')
      finish(new PluginError('Repository review timed out', 504))
    }, 60_000)
  })
}

function parseTree(output: string): Array<{ path: string; size: number; mode: string }> {
  return output.trim().split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+) blob [0-9a-f]+ +(\d+)\t(.+)$/)
    if (!match) throw new PluginError('Repository contains unsupported entries')
    return { mode: match[1], size: Number(match[2]), path: safeRelativePath(match[3], 'repository path') }
  })
}

export class PluginService {
  readonly pluginHost: PluginHost
  private installed = new Map<string, InstalledPlugin>()
  private reviews = new Map<string, StagedReview>()
  private registry: PluginRegistry = { schemaVersion: 1, enabled: {}, agentAccess: {} }
  private readonly installedRoot: string
  private readonly stagingRoot: string
  private readonly rollbackRoot: string
  private readonly dataRoot: string
  private readonly registryPath: string
  private rollbackIds = new Set<string>()

  constructor(private readonly options: PluginServiceOptions) {
    this.pluginHost = new PluginHost(options.stateRoot)
    this.installedRoot = join(options.stateRoot, 'installed')
    this.stagingRoot = join(options.stateRoot, 'staging')
    this.rollbackRoot = join(options.stateRoot, 'backups', 'code')
    this.dataRoot = join(options.stateRoot, 'data')
    this.registryPath = join(options.stateRoot, 'registry.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.installedRoot, { recursive: true })
    await mkdir(this.rollbackRoot, { recursive: true })
    await rm(this.stagingRoot, { recursive: true, force: true })
    await mkdir(this.stagingRoot, { recursive: true })
    await this.discover()
    await this.discoverRollbacks()
    try {
      const parsed = JSON.parse(await readFile(this.registryPath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || (parsed as PluginRegistry).schemaVersion !== 1 || !(parsed as PluginRegistry).enabled || typeof (parsed as PluginRegistry).enabled !== 'object') throw new Error('invalid registry')
      const registry = parsed as PluginRegistry
      this.registry = { ...registry, agentAccess: registry.agentAccess && typeof registry.agentAccess === 'object' ? registry.agentAccess : {} }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new PluginError('Plugin registry is invalid', 500)
    }
    for (const [id, plugin] of this.installed) {
      if (this.registry.enabled[id] === true && plugin.manifest.entry.backend?.protocol === 'host-module') {
        try {
          await this.loadHostedPlugin(plugin)
        } catch {
          // If a hosted plugin fails to load, leave it unloaded
        }
      }
    }
  }

  private async discoverRoot(root: string, source: InstalledPlugin['source'], discovered: Map<string, InstalledPlugin>): Promise<void> {
    let entries
    try { entries = await readdir(root, { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const entry of entries) {
      if (!entry.isDirectory() || !PLUGIN_ID_PATTERN.test(entry.name) || discovered.has(entry.name)) continue
      const directory = resolve(root, entry.name)
      try {
        const manifestFile = await open(resolve(directory, 'plugin.json'), 'r')
        try {
          const info = await manifestFile.stat()
          if (info.size > MAX_MANIFEST_BYTES) throw new PluginError('Plugin manifest is too large')
          const manifest = parseManifest(JSON.parse(await manifestFile.readFile('utf8')), {
            expectedId: entry.name,
            bundled: source === 'bundled',
            hostedRepository: source === 'repository',
          })
          if (manifest.dashboardVersion && !satisfiesPluginDashboardVersion(DASHBOARD_VERSION, manifest.dashboardVersion)) throw new PluginError('Plugin is incompatible with this Dashboard')
          const frontendInfo = await stat(resolve(directory, manifest.entry.frontend))
          if (!frontendInfo.isFile()) throw new PluginError('Plugin frontend entry is not a file')
          for (const skill of manifest.agent?.skills ?? []) {
            const skillInfo = await stat(resolve(directory, skill.path, 'SKILL.md'))
            if (!skillInfo.isFile()) throw new PluginError(`Plugin skill ${skill.name} is missing SKILL.md`)
          }
          let provenance: PluginSource | undefined
          if (source === 'repository') {
            const raw = JSON.parse(await readFile(resolve(directory, '.dashboard-source.json'), 'utf8')) as PluginSource
            if (typeof raw.repository !== 'string' || typeof raw.commit !== 'string' || (raw.digest !== undefined && typeof raw.digest !== 'string')) throw new Error('invalid provenance')
            provenance = raw
          }
          discovered.set(manifest.id, { directory, manifest, source, ...(provenance ? { provenance } : {}) })
        } finally { await manifestFile.close() }
      } catch {
        // Invalid packages are intentionally excluded from runtime discovery.
      }
    }
  }

  private async discover(): Promise<void> {
    const discovered = new Map<string, InstalledPlugin>()
    await this.discoverRoot(this.options.bundledRoot, 'bundled', discovered)
    await this.discoverRoot(this.installedRoot, 'repository', discovered)
    for (const id of this.installed.keys()) if (!discovered.has(id)) this.pluginHost.unloadPlugin(id)
    this.installed = discovered
  }

  private async discoverRollbacks(): Promise<void> {
    const ids = new Set<string>()
    let entries
    try { entries = await readdir(this.rollbackRoot, { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.rollbackIds = ids; return }; throw error }
    for (const entry of entries) {
      if (!entry.isDirectory() || !PLUGIN_ID_PATTERN.test(entry.name)) continue
      const directory = join(this.rollbackRoot, entry.name, 'rollback')
      try {
        const manifest = parseManifest(JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8')), {
          expectedId: entry.name,
          hostedRepository: true,
        })
        const source = JSON.parse(await readFile(join(directory, '.dashboard-source.json'), 'utf8')) as PluginSource
        if (manifest.id === entry.name && typeof source.repository === 'string' && typeof source.commit === 'string') ids.add(entry.name)
      } catch { /* Invalid rollback packages are intentionally unavailable. */ }
    }
    this.rollbackIds = ids
  }

  private assetCapabilityFor(id: string): string | undefined {
    return this.options.assetCapability ? createHmac('sha256', this.options.assetCapability).update(id).digest('base64url') : undefined
  }

  list(): PluginSummary[] {
    return [...this.installed.values()].map(({ manifest, source, provenance }) => ({
      id: manifest.id, name: manifest.navigation.label, version: manifest.version, ...(manifest.dashboardVersion ? { dashboardVersion: manifest.dashboardVersion } : {}), description: manifest.description,
      icon: manifest.navigation.icon, enabled: this.registry.enabled[manifest.id] === true,
      frontendUrl: this.options.assetCapability
        ? `/plugin-assets/${encodeURIComponent(this.assetCapabilityFor(manifest.id)!)}/${encodeURIComponent(manifest.id)}/`
        : `/plugins/${encodeURIComponent(manifest.id)}/`,
      permissions: manifest.permissions,
      source, removable: source === 'repository', rollbackAvailable: this.rollbackIds.has(manifest.id), backend: Boolean(manifest.entry.backend), ...(provenance ? { repository: provenance.repository, commit: provenance.commit, ...(provenance.digest ? { digest: provenance.digest } : {}) } : {}),
      agentTools: (manifest.agent?.tools ?? []).map(({ name, label, description, access, parameters }) => ({
        name,
        label,
        description,
        access,
        parameterNames: parameters.properties && typeof parameters.properties === 'object'
          ? Object.keys(parameters.properties as Record<string, unknown>)
          : [],
      })),
      agentSkills: (manifest.agent?.skills ?? []).map(({ name, description, access }) => ({
        name,
        description,
        ...(access ? { access } : {}),
      })),
      agentAccess: { read: this.registry.agentAccess[manifest.id]?.read === true, write: this.registry.agentAccess[manifest.id]?.write === true },
    })).sort((left, right) => left.name.localeCompare(right.name))
  }

  skillCatalog(): PluginSkillCatalogItem[] {
    const catalog: PluginSkillCatalogItem[] = []
    for (const { directory, manifest } of this.installed.values()) {
      const pluginEnabled = this.registry.enabled[manifest.id] === true
      for (const skill of manifest.agent?.skills ?? []) {
        const granted = skill.access ? this.registry.agentAccess[manifest.id]?.[skill.access] === true : true
        catalog.push({
          path: resolve(directory, skill.path),
          name: skill.name,
          description: skill.description,
          enabled: pluginEnabled && granted,
          plugin: {
            id: manifest.id,
            name: manifest.navigation.label,
            enabled: pluginEnabled,
            ...(skill.access ? { access: skill.access } : {}),
            granted,
          },
        })
      }
    }
    return catalog.sort((left, right) => left.name.localeCompare(right.name))
  }

  private async storageBytes(id: string): Promise<number> {
    const root = join(this.dataRoot, id)
    let entries = 0
    const visit = async (directory: string): Promise<number> => {
      let children
      try { children = await readdir(directory, { withFileTypes: true }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
      let total = 0
      for (const child of children) {
        entries += 1
        if (entries > 10_000) throw new PluginError('Plugin storage contains too many entries', 413)
        const path = join(directory, child.name)
        if (child.isDirectory()) total += await visit(path)
        else if (child.isFile()) total += (await lstat(path)).size
      }
      return total
    }
    return visit(root)
  }

  async listDetailed(): Promise<PluginSummary[]> {
    return Promise.all(this.list().map((summary) => this.detailed(summary)))
  }

  private async detailed(summary: PluginSummary): Promise<PluginSummary> {
    let runtimeStatus: PluginSummary['runtimeStatus'] = summary.backend ? 'disabled' : 'not-applicable'
    if (summary.backend && summary.enabled) {
      const installedPlugin = this.installed.get(summary.id)
      if (installedPlugin?.manifest.entry.backend?.protocol === 'host-module') {
        runtimeStatus = this.pluginHost.isLoaded(summary.id) ? 'healthy' : 'unavailable'
      } else {
        try {
          await probePluginRuntime({ pluginId: summary.id, version: summary.version, socketPath: this.runtimeSocketPath(summary.id) })
          runtimeStatus = 'healthy'
        } catch (error) { runtimeStatus = error instanceof PluginRuntimeError && error.status === 409 ? 'version-mismatch' : 'unavailable' }
      }
    }
    return { ...summary, runtimeStatus, storageBytes: await this.storageBytes(summary.id) }
  }

  private async detailedById(id: string): Promise<PluginSummary> {
    const summary = this.list().find((candidate) => candidate.id === id)
    if (!summary) throw new PluginError('Plugin not found', 404)
    return this.detailed(summary)
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginSummary> {
    const plugin = this.installed.get(id)
    if (!plugin) throw new PluginError('Plugin not found', 404)
    if (enabled && plugin.manifest.entry.backend) {
      if (plugin.manifest.entry.backend.protocol === 'host-module') {
        try {
          await this.loadHostedPlugin(plugin)
        } catch (error) {
          throw new PluginError(`Failed to load plugin backend: ${error instanceof Error ? error.message : String(error)}`, 409)
        }
      } else {
        if (plugin.source !== 'bundled' || !this.options.runtimeSocketRoot) throw new PluginError('Plugin backend runtime is unavailable', 409)
        try {
          await probePluginRuntime({ pluginId: id, version: plugin.manifest.version, socketPath: this.runtimeSocketPath(id) })
        } catch { throw new PluginError('Start the matching plugin service before enabling this plugin', 409) }
      }
    } else if (!enabled && plugin.manifest.entry.backend?.protocol === 'host-module') {
      this.pluginHost.unloadPlugin(id)
    }
    this.registry.enabled[id] = enabled
    await this.saveRegistry()
    return (await this.listDetailed()).find((summary) => summary.id === id) as PluginSummary
  }

  async setAgentAccess(id: string, requested: { read: boolean; write: boolean }): Promise<PluginSummary> {
    const plugin = this.installed.get(id)
    if (!plugin) throw new PluginError('Plugin not found', 404)
    const tools = plugin.manifest.agent?.tools ?? []
    if (requested.read && !tools.some((tool) => tool.access === 'read')) throw new PluginError('Plugin does not provide Pi read tools', 409)
    if (requested.write && !tools.some((tool) => tool.access === 'write')) throw new PluginError('Plugin does not provide Pi write tools', 409)
    this.registry.agentAccess[id] = { read: requested.read, write: requested.write }
    await this.saveRegistry()
    return this.detailedById(id)
  }

  async reviewRepository(input: string): Promise<PluginReview> {
    await this.expireReviews()
    const source = await this.repositorySource(input)
    const stagingDirectory = await mkdtemp(join(this.stagingRoot, 'review-'))
    const checkout = join(stagingDirectory, 'checkout')
    try {
      await git(['clone', '--depth=1', '--filter=blob:none', '--no-tags', '--single-branch', source.cloneUrl, checkout])
      const commit = (await git(['rev-parse', 'HEAD'], checkout, 1024)).toString('utf8').trim()
      if (!/^[0-9a-f]{40}$/.test(commit)) throw new PluginError('Repository commit could not be verified')
      const files = parseTree((await git(['ls-tree', '-r', '-l', '--full-tree', 'HEAD'], checkout)).toString('utf8'))
      if (!files.length || files.length > MAX_PACKAGE_FILES) throw new PluginError(`Plugin repositories must contain 1-${MAX_PACKAGE_FILES} files`, 413)
      if (files.some((file) => file.mode !== '100644')) throw new PluginError('Plugin repositories can contain only non-executable regular files')
      if (files.some((file) => file.path === '.dashboard-source.json')) throw new PluginError('Plugin repository contains a reserved Dashboard file')
      const totalBytes = files.reduce((total, file) => total + file.size, 0)
      if (totalBytes > MAX_PACKAGE_BYTES || files.some((file) => file.size > MAX_ASSET_BYTES)) throw new PluginError('Plugin repository exceeds the 5 MB package limit', 413)
      const manifestEntry = files.find((file) => file.path === 'plugin.json')
      if (!manifestEntry || manifestEntry.size > MAX_MANIFEST_BYTES) throw new PluginError('Repository root must contain a valid plugin.json')
      const manifestBuffer = await git(['show', 'HEAD:plugin.json'], checkout, MAX_MANIFEST_BYTES)
      let manifestRaw: unknown
      try { manifestRaw = JSON.parse(manifestBuffer.toString('utf8')) } catch { throw new PluginError('Plugin manifest is invalid JSON') }
      const manifest = parseManifest(manifestRaw, { requireDashboardVersion: true, hostedRepository: true })
      if (manifest.dashboardVersion && !satisfiesPluginDashboardVersion(DASHBOARD_VERSION, manifest.dashboardVersion)) throw new PluginError(`Plugin requires Dashboard ${manifest.dashboardVersion}; this Dashboard is ${DASHBOARD_VERSION}`, 409)
      const existing = this.installed.get(manifest.id)
      if (existing?.source === 'bundled') throw new PluginError(`Plugin ${manifest.id} is bundled and cannot be replaced`, 409)
      if (existing) {
        if (existing.provenance?.repository !== source.displayUrl) throw new PluginError('Plugin upgrades must come from the originally approved repository', 409)
        if (comparePluginVersions(manifest.version, existing.manifest.version) <= 0) throw new PluginError(`Plugin upgrade version must be newer than ${existing.manifest.version}`, 409)
      }
      if (!files.some((file) => file.path === manifest.entry.frontend)) throw new PluginError('Plugin frontend entry does not exist in the repository')
      if (manifest.entry.backend?.protocol === 'host-module') {
        const modulePath = manifest.entry.backend.module
        if (!files.some((file) => file.path === modulePath)) throw new PluginError('Plugin hosted backend module does not exist in the repository')
      }
      for (const skill of manifest.agent?.skills ?? []) {
        if (!files.some((file) => file.path === `${skill.path}/SKILL.md`)) throw new PluginError(`Plugin skill ${skill.name} is missing SKILL.md`)
      }

      const packageDirectory = join(stagingDirectory, manifest.id)
      await mkdir(packageDirectory)
      const digest = createHash('sha256').update(commit)
      for (const file of files) {
        const body = file.path === 'plugin.json' ? manifestBuffer : await git(['show', `HEAD:${file.path}`], checkout, file.size + 1024)
        if (body.length !== file.size) throw new PluginError(`Repository file changed while reviewing: ${file.path}`, 409)
        digest.update(file.path).update('\0').update(body)
        const destination = resolve(packageDirectory, file.path)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, body, { mode: 0o600 })
      }
      await rm(checkout, { recursive: true, force: true })
      const reviewId = randomUUID()
      const review: PluginReview = {
        reviewId, digest: digest.digest('hex'), repository: source.displayUrl, commit,
        plugin: {
          id: manifest.id,
          name: manifest.navigation.label,
          version: manifest.version,
          dashboardVersion: manifest.dashboardVersion,
          description: manifest.description,
          icon: manifest.navigation.icon,
          permissions: manifest.permissions,
        },
        files: files.map(({ path, size }) => ({ path, size })), totalBytes,
        expiresAt: new Date(Date.now() + REVIEW_TTL_MS).toISOString(),
        operation: existing ? 'upgrade' : 'install',
        ...(existing ? { currentVersion: existing.manifest.version } : {}),
      }
      this.reviews.set(reviewId, { review, packageDirectory, stagingDirectory })
      return review
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async install(reviewId: string, digest: string): Promise<PluginSummary> {
    await this.expireReviews()
    const staged = this.reviews.get(reviewId)
    if (!staged || staged.review.digest !== digest) throw new PluginError('Plugin review expired or changed. Review the repository again.', 409)
    const id = staged.review.plugin.id
    const target = join(this.installedRoot, id)
    const sourceRecord = { repository: staged.review.repository, commit: staged.review.commit, digest: staged.review.digest }
    await writeFile(join(staged.packageDirectory, '.dashboard-source.json'), `${JSON.stringify(sourceRecord, null, 2)}\n`, { mode: 0o600 })

    if (staged.review.operation === 'install') {
      if (this.installed.has(id)) throw new PluginError(`Plugin ${id} is already installed`, 409)
      try { await stat(target); throw new PluginError(`Plugin ${id} is already installed`, 409) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await rename(staged.packageDirectory, target)
    } else {
      const current = this.installed.get(id)
      if (!current || current.source !== 'repository' || current.manifest.version !== staged.review.currentVersion) throw new PluginError('Installed plugin changed after review. Review the upgrade again.', 409)
      const rollback = join(this.rollbackRoot, id, 'rollback')
      const wasEnabled = this.registry.enabled[id] === true
      this.registry.enabled[id] = false
      await this.saveRegistry()
      await mkdir(dirname(rollback), { recursive: true })
      await rm(rollback, { recursive: true, force: true })
      await rename(target, rollback)
      try {
        await rename(staged.packageDirectory, target)
        await this.discover()
        const upgraded = this.installed.get(id)
        if (!upgraded || upgraded.manifest.version !== staged.review.plugin.version) throw new PluginError('Upgraded plugin failed validation', 500)
        this.registry.enabled[id] = wasEnabled
        await this.saveRegistry()
        if (wasEnabled && upgraded.manifest.entry.backend?.protocol === 'host-module') await this.loadHostedPlugin(upgraded)
      } catch (error) {
        await rm(target, { recursive: true, force: true })
        await rename(rollback, target).catch(() => undefined)
        this.registry.enabled[id] = wasEnabled
        await this.saveRegistry().catch(() => undefined)
        await this.discover()
        throw error
      }
    }

    await rm(staged.stagingDirectory, { recursive: true, force: true })
    this.reviews.delete(reviewId)
    await this.discover()
    await this.discoverRollbacks()
    const installed = this.installed.get(id)
    if (installed && this.registry.enabled[id] === true && installed.manifest.entry.backend?.protocol === 'host-module') await this.loadHostedPlugin(installed)
    try { return await this.detailedById(id) }
    catch (error) {
      if (error instanceof PluginError && error.status === 404) throw new PluginError('Installed plugin failed validation', 500)
      throw error
    }
  }

  async rollback(id: string): Promise<PluginSummary> {
    const plugin = this.installed.get(id)
    if (!plugin || plugin.source !== 'repository') throw new PluginError('Repository plugin not found', 404)
    const target = join(this.installedRoot, id)
    const rollback = join(this.rollbackRoot, id, 'rollback')
    if (!this.rollbackIds.has(id)) throw new PluginError('No plugin rollback is available', 409)
    const swap = join(this.rollbackRoot, id, `swap-${randomUUID()}`)
    const wasEnabled = this.registry.enabled[id] === true
    this.registry.enabled[id] = false
    delete this.registry.agentAccess[id]
    await this.saveRegistry()
    await rename(target, swap)
    try {
      await rename(rollback, target)
      await rename(swap, rollback)
      await this.discover()
      await this.discoverRollbacks()
      const restored = this.list().find((candidate) => candidate.id === id)
      if (!restored) throw new PluginError('Rolled-back plugin failed validation', 500)
      this.registry.enabled[id] = wasEnabled
      await this.saveRegistry()
      const restoredPlugin = this.installed.get(id)
      if (wasEnabled && restoredPlugin?.manifest.entry.backend?.protocol === 'host-module') await this.loadHostedPlugin(restoredPlugin)
      return this.detailedById(id)
    } catch (error) {
      const exists = (path: string) => stat(path).then(() => true).catch(() => false)
      if (await exists(swap)) {
        if (await exists(target) && !await exists(rollback)) await rename(target, rollback).catch(() => undefined)
        await rename(swap, target).catch(() => undefined)
      } else if (await exists(target) && await exists(rollback)) {
        const reverse = join(this.rollbackRoot, id, `reverse-${randomUUID()}`)
        await rename(target, reverse).catch(() => undefined)
        await rename(rollback, target).catch(() => undefined)
        await rename(reverse, rollback).catch(() => undefined)
      }
      this.registry.enabled[id] = wasEnabled
      await this.saveRegistry().catch(() => undefined)
      await this.discover()
      await this.discoverRollbacks()
      throw error
    }
  }

  async remove(id: string, deleteData = false): Promise<void> {
    const plugin = this.installed.get(id)
    if (!plugin) throw new PluginError('Plugin not found', 404)
    if (plugin.source !== 'repository') throw new PluginError('Bundled plugins cannot be removed', 409)
    this.registry.enabled[id] = false
    await this.saveRegistry()
    if (plugin.manifest.entry.backend?.protocol === 'host-module') this.pluginHost.unloadPlugin(id)
    await rm(plugin.directory, { recursive: true, force: true })
    await rm(join(this.rollbackRoot, id), { recursive: true, force: true })
    if (deleteData) await rm(join(this.dataRoot, id), { recursive: true, force: true })
    await this.discover()
    await this.discoverRollbacks()
  }

  private async repositorySource(input: string): Promise<{ cloneUrl: string; displayUrl: string }> {
    const url = input.trim()
    const github = url.match(GITHUB_REPOSITORY)
    if (github) {
      const canonical = `https://github.com/${github[1]}/${github[2]}`
      return { cloneUrl: `${canonical}.git`, displayUrl: canonical }
    }
    const local = url.match(LOCAL_REPOSITORY)
    if (local && this.options.localRepositoryRoot) {
      const safePath = safeRelativePath(local[1], 'local repository')
      const root = await realpath(this.options.localRepositoryRoot)
      let repository: string
      try { repository = await realpath(resolve(root, safePath)) } catch { throw new PluginError('Local preview repository was not found', 404) }
      const escaped = relative(root, repository)
      if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) throw new PluginError('Local preview repository is outside the disposable project', 403)
      return { cloneUrl: repository, displayUrl: `local:${safePath}` }
    }
    const workspaceRepository = url.match(WORKSPACE_REPOSITORY)
    if (workspaceRepository && this.options.workspaceRoot) {
      const safePath = safeRelativePath(workspaceRepository[1], 'workspace repository')
      const root = await realpath(this.options.workspaceRoot)
      let repository: string
      try { repository = await realpath(resolve(root, safePath)) } catch { throw new PluginError('Workspace repository was not found', 404) }
      const escaped = relative(root, repository)
      if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) throw new PluginError('Workspace repository is outside the project', 403)
      return { cloneUrl: repository, displayUrl: `workspace:${safePath}` }
    }
    throw new PluginError('Enter a public GitHub URL or a workspace: path to a plugin repository.')
  }

  private async expireReviews(): Promise<void> {
    const now = Date.now()
    for (const [id, staged] of this.reviews) {
      if (Date.parse(staged.review.expiresAt) > now) continue
      this.reviews.delete(id)
      await rm(staged.stagingDirectory, { recursive: true, force: true })
    }
  }

  private async saveRegistry(): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true })
    const temporary = `${this.registryPath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.registry, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.registryPath)
  }

  private runtimeSocketPath(id: string): string {
    return join(this.options.runtimeSocketRoot ?? '/run/pi-dashboard-plugins', id, `${id}.sock`)
  }

  private async loadHostedPlugin(plugin: InstalledPlugin): Promise<void> {
    this.pluginHost.unloadPlugin(plugin.manifest.id)
    await this.pluginHost.loadPlugin(plugin.directory, plugin.manifest)
  }

  runtime(id: string): { socketPath: string; permissions: PluginPermission[]; protocol: PluginBackendProtocol } {
    const plugin = this.installed.get(id)
    if (!plugin || this.registry.enabled[id] !== true) throw new PluginError('Plugin not found or disabled', 404)
    if (!plugin.manifest.entry.backend) throw new PluginError('Plugin does not have a backend runtime', 404)
    return {
      socketPath: this.runtimeSocketPath(id),
      permissions: [...plugin.manifest.permissions],
      protocol: plugin.manifest.entry.backend.protocol,
    }
  }

  async capabilityAsset(capability: string, id: string, requestedPath: string): Promise<{ body: Buffer; contentType: string }> {
    const expected = this.assetCapabilityFor(id)
    const suppliedBuffer = Buffer.from(capability)
    const expectedBuffer = Buffer.from(expected ?? '')
    if (!expected || suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) throw new PluginError('Plugin asset not found', 404)
    return this.asset(id, requestedPath)
  }

  async asset(id: string, requestedPath: string): Promise<{ body: Buffer; contentType: string }> {
    const plugin = this.installed.get(id)
    if (!plugin || this.registry.enabled[id] !== true) throw new PluginError('Plugin not found or disabled', 404)
    const relativePath = requestedPath || plugin.manifest.entry.frontend
    const safePath = safeRelativePath(relativePath, 'asset path')
    if (safePath === '.dashboard-source.json') throw new PluginError('Plugin asset not found', 404)
    const candidate = resolve(plugin.directory, safePath)
    const root = await realpath(plugin.directory)
    let actual: string
    try { actual = await realpath(candidate) } catch { throw new PluginError('Plugin asset not found', 404) }
    const escaped = relative(root, actual)
    if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) throw new PluginError('Plugin asset path is outside the package', 403)
    const info = await stat(actual)
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) throw new PluginError('Plugin asset is unavailable', info.size > MAX_ASSET_BYTES ? 413 : 404)
    return { body: await readFile(actual), contentType: contentType(actual) }
  }
}
