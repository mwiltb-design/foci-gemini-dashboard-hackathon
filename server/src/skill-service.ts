import { createHash } from 'node:crypto'
import { cp, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { minimatch } from 'minimatch'
import { parse as parseYaml } from 'yaml'

const MAX_SKILL_FILE_BYTES = 1024 * 1024
const MAX_SKILL_TOTAL_BYTES = 2 * 1024 * 1024
const MAX_SKILL_FILES = 100

interface SkillLocation {
  directory: string
  source: 'pi' | 'agents' | 'settings' | 'runtime' | 'plugin' | 'draft'
  scope: 'user' | 'project' | 'runtime' | 'plugin'
  settingsPath?: string
  settingsBase?: string
  allowRootMarkdown: boolean
  forcedEnabled?: boolean
  plugin?: PluginSkillSource['plugin']
  review?: SkillReviewState
}

interface SkillCandidate extends SkillLocation {
  filePath: string
  baseDir: string
}

export interface SkillFile {
  path: string
  size: number
  executable: boolean
  kind: 'instructions' | 'script' | 'reference' | 'asset' | 'file'
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  category: string
  enabled: boolean
  valid: boolean
  scope: SkillLocation['scope']
  source: SkillLocation['source']
  filePath: string
  disableModelInvocation: boolean
  warningCount: number
  canToggle: boolean
  piAccess: boolean
  status: string
  storageLocation: string
  plugin?: PluginSkillSource['plugin']
  review?: SkillReviewState
}

export interface SkillDetail extends SkillSummary {
  content: string
  license?: string
  compatibility?: string
  allowedTools?: string
  metadata: Record<string, unknown>
  warnings: string[]
  files: SkillFile[]
}

export interface SkillReview {
  digest: string
  sourcePath: string
  name: string
  description: string
  category: string
  content: string
  warnings: string[]
  files: SkillFile[]
  executableCount: number
  valid: boolean
}

export interface PluginSkillSource {
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

export interface SkillReviewState {
  required: true
  destination: 'user' | 'project' | 'plugin'
  pluginId?: string
}

export class SkillError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function posix(path: string): string {
  return path.split(sep).join('/')
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string; warnings: string[] } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { data: {}, body: content, warnings: ['Missing YAML frontmatter'] }
  try {
    const data = parseYaml(match[1])
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { data: {}, body: content.slice(match[0].length), warnings: ['Frontmatter must be a mapping'] }
    return { data: data as Record<string, unknown>, body: content.slice(match[0].length), warnings: [] }
  } catch (error) {
    return { data: {}, body: content.slice(match[0].length), warnings: [`Invalid YAML frontmatter: ${error instanceof Error ? error.message : 'parse error'}`] }
  }
}

function validateMetadata(data: Record<string, unknown>, directoryName: string): string[] {
  const warnings: string[] = []
  const name = typeof data.name === 'string' ? data.name : ''
  const description = typeof data.description === 'string' ? data.description : ''
  if (!name) warnings.push('Missing skill name')
  else {
    if (name.length > 64) warnings.push('Name exceeds 64 characters')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) warnings.push('Name must use lowercase letters, numbers, and single hyphens')
    if (name !== directoryName) warnings.push('Skill name differs from its directory name')
  }
  if (!description) warnings.push('Missing description; Pi will not load this skill')
  else if (description.length > 1024) warnings.push('Description exceeds 1,024 characters')
  if (typeof data.compatibility === 'string' && data.compatibility.length > 500) warnings.push('Compatibility exceeds 500 characters')
  return warnings
}

function fileKind(path: string): SkillFile['kind'] {
  if (path === 'SKILL.md') return 'instructions'
  if (path.startsWith('scripts/')) return 'script'
  if (path.startsWith('references/')) return 'reference'
  if (path.startsWith('assets/')) return 'asset'
  return 'file'
}

function variants(filePath: string, base: string): { patterns: string[]; exact: string[] } {
  const rel = posix(relative(base, filePath))
  const absolute = posix(filePath)
  const name = basename(filePath)
  const isSkillFile = name === 'SKILL.md'
  const parent = isSkillFile ? dirname(filePath) : undefined
  const parentRel = parent ? posix(relative(base, parent)) : undefined
  const parentName = parent ? basename(parent) : undefined
  const parentAbsolute = parent ? posix(parent) : undefined
  return {
    patterns: [rel, name, absolute, parentRel, parentName, parentAbsolute].filter((value): value is string => Boolean(value)),
    exact: [rel, absolute, parentRel, parentAbsolute].filter((value): value is string => Boolean(value)),
  }
}

export class SkillService {
  private readonly projectPi: string
  private readonly projectAgents: string
  private readonly globalSettings: string
  private readonly projectSettings: string

  constructor(
    private readonly workspace: string,
    private readonly agentDir: string,
    private readonly importRoot = '/workspace',
  ) {
    this.projectPi = join(workspace, '.pi')
    this.projectAgents = join(workspace, '.agents')
    this.globalSettings = join(agentDir, 'settings.json')
    this.projectSettings = join(this.projectPi, 'settings.json')
  }

  async list(runtimePaths: string[] = [], pluginSkills: PluginSkillSource[] = []): Promise<SkillSummary[]> {
    const details = await this.discover(runtimePaths, pluginSkills)
    return details.map(({ content: _content, warnings: _warnings, files: _files, metadata: _metadata, ...summary }) => summary)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async get(id: string, runtimePaths: string[] = [], pluginSkills: PluginSkillSource[] = []): Promise<SkillDetail | null> {
    return (await this.discover(runtimePaths, pluginSkills)).find((skill) => skill.id === id) ?? null
  }

  async readSkillFile(id: string, file: string, runtimePaths: string[] = [], pluginSkills: PluginSkillSource[] = []): Promise<{ path: string; content: string | null; binary: boolean; truncated: boolean }> {
    const skill = await this.get(id, runtimePaths, pluginSkills)
    if (!skill) throw new SkillError('Skill not found', 404)
    const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '')
    if (!normalized || normalized.split('/').some((segment) => segment === '..')) throw new SkillError('Invalid skill file path', 403)
    const root = await realpath(dirname(skill.filePath))
    const target = await realpath(resolve(root, normalized)).catch(() => { throw new SkillError('Skill file not found', 404) })
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new SkillError('Skill file is outside the skill directory', 403)
    const info = await stat(target)
    if (!info.isFile()) throw new SkillError('Skill file not found', 404)
    const bytesToRead = Math.min(info.size, MAX_SKILL_FILE_BYTES + 1)
    const buffer = Buffer.alloc(bytesToRead)
    const handle = await open(target, 'r')
    let bytesRead = 0
    try { bytesRead = (await handle.read(buffer, 0, bytesToRead, 0)).bytesRead } finally { await handle.close() }
    const sample = buffer.subarray(0, Math.min(bytesRead, MAX_SKILL_FILE_BYTES))
    const binary = sample.includes(0)
    return { path: normalized, content: binary ? null : sample.toString('utf8'), binary, truncated: info.size > MAX_SKILL_FILE_BYTES }
  }

  async setEnabled(id: string, enabled: boolean, runtimePaths: string[] = [], pluginSkills: PluginSkillSource[] = []): Promise<SkillDetail> {
    const skill = await this.get(id, runtimePaths, pluginSkills)
    if (!skill) throw new SkillError('Skill not found', 404)
    if (!skill.canToggle) throw new SkillError('This skill is managed by a package or runtime extension')
    if (enabled && !skill.valid) throw new SkillError('Fix the skill validation errors before enabling it')
    const candidate = (await this.candidates(runtimePaths, pluginSkills)).find((item) => this.idFor(item.filePath) === id)
    if (!candidate?.settingsPath || !candidate.settingsBase) throw new SkillError('Skill settings location is unavailable')
    const target = this.overrideTarget(candidate.filePath, candidate.settingsBase)
    await this.updateSkillOverrides(candidate.settingsPath, target, enabled)
    const updated = await this.get(id, runtimePaths, pluginSkills)
    if (!updated) throw new SkillError('Skill disappeared after updating settings')
    return updated
  }

  async review(sourcePath: string): Promise<SkillReview> {
    const canonicalImportRoot = await realpath(this.importRoot)
    const canonical = await realpath(expandHome(sourcePath)).catch(() => { throw new SkillError('Import folder not found', 404) })
    const canonicalDraftRoot = await realpath(join(this.projectPi, 'skill-drafts')).catch(() => '')
    const insideImportRoot = canonical === canonicalImportRoot || canonical.startsWith(`${canonicalImportRoot}${sep}`)
    const insideDraftRoot = Boolean(canonicalDraftRoot) && (canonical === canonicalDraftRoot || canonical.startsWith(`${canonicalDraftRoot}${sep}`))
    if (!insideImportRoot && !insideDraftRoot) throw new SkillError('Skills can only be imported from inside /workspace or the managed skill draft queue', 403)
    const info = await stat(canonical)
    if (!info.isDirectory()) throw new SkillError('Choose a folder containing SKILL.md')
    const skillPath = join(canonical, 'SKILL.md')
    const content = await readFile(skillPath, 'utf8').catch(() => { throw new SkillError('The selected folder does not contain SKILL.md') })
    const parsed = parseFrontmatter(content)
    const name = typeof parsed.data.name === 'string' ? parsed.data.name : basename(canonical)
    const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
    const metadata = parsed.data.metadata && typeof parsed.data.metadata === 'object' && !Array.isArray(parsed.data.metadata) ? parsed.data.metadata as Record<string, unknown> : {}
    const category = typeof metadata.category === 'string' ? metadata.category : 'General'
    const files = await this.filesFor(canonical)
    const warnings = [...parsed.warnings, ...validateMetadata(parsed.data, basename(canonical))]
    const digest = await this.digest(canonical, files)
    return {
      digest, sourcePath: canonical, name, description, category, content, warnings, files,
      executableCount: files.filter((file) => file.executable).length,
      valid: Boolean(description) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64,
    }
  }

  async adopt(sourcePath: string, expectedDigest: string, scope: 'user' | 'project' = 'user'): Promise<SkillDetail> {
    const review = await this.review(sourcePath)
    if (!review.valid) throw new SkillError('The skill has validation errors and cannot be adopted')
    if (review.digest !== expectedDigest) throw new SkillError('The source changed after review; review it again before adopting')
    const destination = scope === 'project'
      ? join(this.projectPi, 'skills', review.name)
      : join(this.agentDir, 'skills', review.name)
    const settingsPath = scope === 'project' ? this.projectSettings : this.globalSettings
    const settingsBase = scope === 'project' ? this.projectPi : this.agentDir
    try {
      await stat(destination)
      throw new SkillError(`A skill named ${review.name} already exists`, 409)
    } catch (error) {
      if (error instanceof SkillError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(dirname(destination), { recursive: true })
    const temporary = `${destination}.dashboard-${process.pid}.tmp`
    try {
      await cp(review.sourcePath, temporary, { recursive: true, errorOnExist: true, force: false })
      await this.updateSkillOverrides(settingsPath, this.overrideTarget(join(destination, 'SKILL.md'), settingsBase), false)
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    const id = this.idFor(join(destination, 'SKILL.md'))
    const adopted = await this.get(id)
    if (!adopted) throw new SkillError('Skill was copied but could not be discovered')
    const draftRoot = await realpath(join(this.projectPi, 'skill-drafts')).catch(() => '')
    if (draftRoot && (review.sourcePath === draftRoot || review.sourcePath.startsWith(`${draftRoot}${sep}`))) {
      await rm(review.sourcePath, { recursive: true, force: true })
    }
    return adopted
  }

  private async discover(runtimePaths: string[], pluginSkills: PluginSkillSource[]): Promise<SkillDetail[]> {
    const candidates = await this.candidates(runtimePaths, pluginSkills)
    const details: SkillDetail[] = []
    const seenNames = new Set<string>()
    for (const candidate of candidates) {
      let content: string
      try { content = await readFile(candidate.filePath, 'utf8') } catch { continue }
      const parsed = parseFrontmatter(content)
      const directoryName = basename(candidate.filePath) === 'SKILL.md' ? basename(dirname(candidate.filePath)) : basename(candidate.filePath, '.md')
      const name = typeof parsed.data.name === 'string' ? parsed.data.name : directoryName
      const description = typeof parsed.data.description === 'string' ? parsed.data.description : ''
      const metadata = parsed.data.metadata && typeof parsed.data.metadata === 'object' && !Array.isArray(parsed.data.metadata) ? parsed.data.metadata as Record<string, unknown> : {}
      const warnings = [...parsed.warnings, ...validateMetadata(parsed.data, directoryName)]
      const duplicate = seenNames.has(name)
      if (duplicate) warnings.push(`Duplicate skill name; Pi keeps the first discovered skill named ${name}`)
      seenNames.add(name)
      const enabledBySource = candidate.forcedEnabled ?? await this.isEnabled(candidate)
      const valid = Boolean(description) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64
      const enabled = enabledBySource && valid && !duplicate
      const files = await this.filesForCandidate(candidate).catch(() => [])
      const status = candidate.review
        ? candidate.review.destination === 'plugin'
          ? `Needs review before it can be added to the ${candidate.review.pluginId || 'selected'} plugin`
          : `Needs review and approval before ${candidate.review.destination === 'user' ? 'personal' : 'project'} installation`
        : candidate.plugin
        ? !candidate.plugin.enabled
          ? `Requires the ${candidate.plugin.name} plugin to be enabled`
          : candidate.plugin.access && !candidate.plugin.granted
            ? `Requires PI ${candidate.plugin.access} access for the ${candidate.plugin.name} plugin`
            : enabled
              ? 'Available to PI through the enabled plugin'
              : 'Plugin skill is not currently available to PI'
        : !valid
          ? 'Needs validation changes before PI can use it'
          : duplicate
            ? 'Hidden because another discovered skill has the same name'
            : enabled
              ? 'Available to PI'
              : 'Installed but inactive'
      details.push({
        id: this.idFor(candidate.filePath), name, description, category: typeof metadata.category === 'string' ? metadata.category : 'General',
        enabled, valid, scope: candidate.scope, source: candidate.source, filePath: candidate.filePath,
        disableModelInvocation: parsed.data['disable-model-invocation'] === true, warningCount: warnings.length,
        canToggle: Boolean(candidate.settingsPath) && !candidate.plugin && !candidate.review, piAccess: enabled, status,
        storageLocation: basename(candidate.filePath) === 'SKILL.md' ? dirname(candidate.filePath) : candidate.filePath,
        ...(candidate.plugin ? { plugin: candidate.plugin } : {}),
        ...(candidate.review ? { review: candidate.review } : {}),
        content,
        ...(typeof parsed.data.license === 'string' ? { license: parsed.data.license } : {}),
        ...(typeof parsed.data.compatibility === 'string' ? { compatibility: parsed.data.compatibility } : {}),
        ...(typeof parsed.data['allowed-tools'] === 'string' ? { allowedTools: parsed.data['allowed-tools'] } : {}),
        metadata, warnings, files,
      })
    }
    return details
  }

  private async candidates(runtimePaths: string[], pluginSkills: PluginSkillSource[]): Promise<SkillCandidate[]> {
    const locations: SkillLocation[] = [
      { directory: join(this.agentDir, 'skills'), source: 'pi', scope: 'user', settingsPath: this.globalSettings, settingsBase: this.agentDir, allowRootMarkdown: true },
      { directory: join(homedir(), '.agents', 'skills'), source: 'agents', scope: 'user', settingsPath: this.globalSettings, settingsBase: join(homedir(), '.agents'), allowRootMarkdown: false },
      { directory: join(this.projectPi, 'skills'), source: 'pi', scope: 'project', settingsPath: this.projectSettings, settingsBase: this.projectPi, allowRootMarkdown: true },
      { directory: join(this.projectAgents, 'skills'), source: 'agents', scope: 'project', settingsPath: this.projectSettings, settingsBase: this.projectAgents, allowRootMarkdown: false },
    ]
    locations.push(...await this.settingsLocations(this.globalSettings, this.agentDir, 'user'))
    locations.push(...await this.settingsLocations(this.projectSettings, this.projectPi, 'project'))
    const result: SkillCandidate[] = []
    for (const location of locations) result.push(...await this.scanLocation(location))
    const draftRoot = join(this.projectPi, 'skill-drafts')
    const legacyDrafts = await this.scanLocation({
      directory: draftRoot,
      source: 'draft',
      scope: 'user',
      allowRootMarkdown: false,
      forcedEnabled: false,
      review: { required: true, destination: 'user' },
    })
    for (const candidate of legacyDrafts) {
      const relativeDraft = posix(relative(draftRoot, candidate.baseDir))
      if (relativeDraft && !relativeDraft.includes('/') && !['personal', 'project', 'plugin'].includes(relativeDraft)) result.push(candidate)
    }
    result.push(...await this.scanLocation({
      directory: join(draftRoot, 'personal'),
      source: 'draft',
      scope: 'user',
      allowRootMarkdown: false,
      forcedEnabled: false,
      review: { required: true, destination: 'user' },
    }))
    result.push(...await this.scanLocation({
      directory: join(draftRoot, 'project'),
      source: 'draft',
      scope: 'project',
      allowRootMarkdown: false,
      forcedEnabled: false,
      review: { required: true, destination: 'project' },
    }))
    const pluginDraftRoot = join(draftRoot, 'plugin')
    const pluginDrafts = await this.scanLocation({
      directory: pluginDraftRoot,
      source: 'draft',
      scope: 'plugin',
      allowRootMarkdown: false,
      forcedEnabled: false,
      review: { required: true, destination: 'plugin' },
    })
    for (const candidate of pluginDrafts) {
      const [pluginId] = posix(relative(pluginDraftRoot, candidate.baseDir)).split('/')
      candidate.review = { required: true, destination: 'plugin', ...(pluginId && pluginId !== '..' ? { pluginId } : {}) }
      result.push(candidate)
    }
    for (const skill of pluginSkills) {
      const directory = resolve(skill.path)
      const filePath = join(directory, 'SKILL.md')
      try {
        const info = await stat(filePath)
        if (info.isFile()) {
          result.push({
            directory,
            source: 'plugin',
            scope: 'plugin',
            allowRootMarkdown: false,
            filePath,
            baseDir: directory,
            forcedEnabled: skill.enabled,
            plugin: skill.plugin,
          })
        }
      } catch { /* Missing plugin skill packages are excluded from the catalog. */ }
    }
    for (const path of runtimePaths) {
      const absolute = resolve(path)
      const filePath = basename(absolute) === 'SKILL.md' ? absolute : join(absolute, 'SKILL.md')
      const directory = dirname(filePath)
      if (result.some((candidate) => resolve(candidate.filePath) === filePath)) continue
      try {
        const info = await stat(filePath)
        if (info.isFile()) result.push({ directory, source: 'runtime', scope: 'runtime', allowRootMarkdown: true, filePath, baseDir: directory })
      } catch { /* Dynamic or missing runtime skills cannot be inspected from disk. */ }
    }
    const seen = new Set<string>()
    return result.filter((candidate) => {
      const key = resolve(candidate.filePath)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private async settingsLocations(settingsPath: string, base: string, scope: 'user' | 'project'): Promise<SkillLocation[]> {
    const settings = await this.readSettings(settingsPath)
    const entries = Array.isArray(settings.skills) ? settings.skills.filter((entry): entry is string => typeof entry === 'string') : []
    const locations: SkillLocation[] = []
    for (const entry of entries) {
      if (!entry || entry.startsWith('!') || entry.startsWith('+') || entry.startsWith('-') || /[*?{}[\]]/.test(entry)) continue
      const directory = resolve(base, expandHome(entry))
      locations.push({ directory, source: 'settings', scope, settingsPath, settingsBase: base, allowRootMarkdown: true })
    }
    return locations
  }

  private async scanLocation(location: SkillLocation): Promise<SkillCandidate[]> {
    let info
    try { info = await stat(location.directory) } catch { return [] }
    if (info.isFile()) return [{ ...location, filePath: location.directory, baseDir: dirname(location.directory) }]
    if (!info.isDirectory()) return []

    const result: SkillCandidate[] = []
    const scan = async (directory: string, root: boolean) => {
      const entries = await readdir(directory, { withFileTypes: true })
      if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
        result.push({ ...location, filePath: join(directory, 'SKILL.md'), baseDir: directory })
        return
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await scan(path, false)
        else if (root && location.allowRootMarkdown && entry.isFile() && entry.name.endsWith('.md')) result.push({ ...location, filePath: path, baseDir: directory })
      }
    }
    await scan(location.directory, true)
    return result
  }

  private async isEnabled(candidate: SkillCandidate): Promise<boolean> {
    if (!candidate.settingsPath || !candidate.settingsBase) return true
    const settings = await this.readSettings(candidate.settingsPath)
    const patterns = Array.isArray(settings.skills) ? settings.skills.filter((entry): entry is string => typeof entry === 'string') : []
    const choices = variants(candidate.filePath, candidate.settingsBase)
    const matchesPattern = (pattern: string) => choices.patterns.some((value) => minimatch(value, pattern, { dot: true }))
    const matchesExact = (pattern: string) => choices.exact.includes(posix(pattern.replace(/^\.\//, '')))
    let enabled = true
    for (const pattern of patterns.filter((entry) => entry.startsWith('!'))) if (matchesPattern(pattern.slice(1))) enabled = false
    for (const pattern of patterns.filter((entry) => entry.startsWith('+'))) if (matchesExact(pattern.slice(1))) enabled = true
    for (const pattern of patterns.filter((entry) => entry.startsWith('-'))) if (matchesExact(pattern.slice(1))) enabled = false
    return enabled
  }

  private overrideTarget(filePath: string, base: string): string {
    const relativeFile = posix(relative(base, filePath))
    return basename(filePath) === 'SKILL.md' ? posix(dirname(relativeFile)) : relativeFile
  }

  private async updateSkillOverrides(settingsPath: string, target: string, enabled: boolean): Promise<void> {
    const settings = await this.readSettings(settingsPath)
    const current = Array.isArray(settings.skills) ? settings.skills.filter((entry): entry is string => typeof entry === 'string') : []
    const withoutExact = current.filter((entry) => entry !== `+${target}` && entry !== `-${target}`)
    settings.skills = [...withoutExact, `${enabled ? '+' : '-'}${target}`]
    await mkdir(dirname(settingsPath), { recursive: true })
    const temporary = `${settingsPath}.dashboard-${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, settingsPath)
  }

  private async readSettings(path: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new SkillError(`Unable to read settings: ${error instanceof Error ? error.message : 'invalid JSON'}`)
    }
  }

  private async filesForCandidate(candidate: SkillCandidate): Promise<SkillFile[]> {
    if (basename(candidate.filePath) === 'SKILL.md') return this.filesFor(candidate.baseDir)
    const info = await stat(candidate.filePath)
    return [{ path: basename(candidate.filePath), size: info.size, executable: Boolean(info.mode & 0o111), kind: 'instructions' }]
  }

  private async filesFor(root: string): Promise<SkillFile[]> {
    const result: SkillFile[] = []
    let total = 0
    const scan = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new SkillError(`Symlinks are not allowed in reviewed skills: ${entry.name}`)
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await scan(path)
        else if (entry.isFile()) {
          const info = await stat(path)
          total += info.size
          if (result.length >= MAX_SKILL_FILES) throw new SkillError(`Skill contains more than ${MAX_SKILL_FILES} files`)
          if (total > MAX_SKILL_TOTAL_BYTES) throw new SkillError('Skill exceeds the 2 MB review limit')
          const relativePath = posix(relative(root, path))
          result.push({ path: relativePath, size: info.size, executable: Boolean(info.mode & 0o111), kind: fileKind(relativePath) })
        }
      }
    }
    await scan(root)
    return result.sort((a, b) => a.path.localeCompare(b.path))
  }

  private async digest(root: string, files: SkillFile[]): Promise<string> {
    const hash = createHash('sha256')
    for (const file of files) {
      hash.update(file.path)
      hash.update(await readFile(join(root, file.path)))
    }
    return hash.digest('hex')
  }

  private idFor(path: string): string {
    return createHash('sha256').update(resolve(path)).digest('hex').slice(0, 20)
  }
}
