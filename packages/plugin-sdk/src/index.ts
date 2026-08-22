export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const
export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/
export const PLUGIN_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

export const KNOWN_PLUGIN_PERMISSIONS = [
  'plugin-data:read',
  'plugin-data:write',
  'dashboard-theme:read',
  'dashboard-notifications:write',
] as const
export type PluginPermission = typeof KNOWN_PLUGIN_PERMISSIONS[number]

export const PLUGIN_AGENT_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,39}$/
export type PluginAgentAccess = 'read' | 'write'

export interface PluginAgentToolV1 {
  name: string
  label: string
  description: string
  access: PluginAgentAccess
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  parameters: Record<string, unknown>
}

export interface PluginAgentSkillV1 {
  name: string
  description: string
  path: string
  access?: PluginAgentAccess
}

export function comparePluginVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.match(PLUGIN_VERSION_PATTERN)
    if (!match) throw new Error(`Invalid plugin version: ${value}`)
    return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split('.') }
  }
  const a = parse(left); const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (!a.prerelease && !b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]; const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart); const rightNumber = /^\d+$/.test(rightPart)
    if (leftNumber && rightNumber) return Number(leftPart) < Number(rightPart) ? -1 : 1
    if (leftNumber !== rightNumber) return leftNumber ? -1 : 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

export function satisfiesPluginDashboardVersion(version: string, range: string): boolean {
  const clean = range.trim()
  if (!clean || clean === '*') return true
  const checks = clean.split(/\s+/)
  return checks.every((check) => {
    const match = check.match(/^(>=|<=|>|<|\^|~)?(.+)$/)
    if (!match || !PLUGIN_VERSION_PATTERN.test(match[2])) return false
    const operator = match[1] ?? '='
    const target = match[2]
    const compared = comparePluginVersions(version, target)
    if (operator === '=') return compared === 0
    if (operator === '>=') return compared >= 0
    if (operator === '<=') return compared <= 0
    if (operator === '>') return compared > 0
    if (operator === '<') return compared < 0
    const [major, minor] = target.split('.').map(Number)
    if (compared < 0) return false
    const [currentMajor, currentMinor] = version.split('.').map(Number)
    return operator === '^' ? currentMajor === major : currentMajor === major && currentMinor === minor
  })
}

export type PluginBackendProtocol = 'host-module'

export interface PluginManifestBackendHostModuleV1 {
  protocol: 'host-module'
  module: string
}

export type PluginManifestBackendV1 = PluginManifestBackendHostModuleV1

export interface PluginManifestV1 {
  schemaVersion: 1
  id: string
  name: string
  version: string
  description: string
  dashboardVersion?: string
  entry: {
    frontend: string
    backend?: PluginManifestBackendV1
  }
  agent?: {
    tools?: PluginAgentToolV1[]
    skills?: PluginAgentSkillV1[]
  }
  navigation: {
    label: string
    icon: string
  }
  permissions: PluginPermission[]
}

export interface PluginManifestValidationOptions {
  expectedId?: string
  supportedPermissions?: readonly PluginPermission[]
  allowBackend?: boolean
  allowAgent?: boolean
  requireDashboardVersion?: boolean
}

export type PluginManifestValidation =
  | { success: true; manifest: PluginManifestV1 }
  | { success: false; errors: string[] }

function text(value: unknown, _field: string, maximum: number, required = true): string | undefined {
  if (typeof value !== 'string') return required ? undefined : ''
  const clean = value.trim()
  if ((required && !clean) || clean.length > maximum) return undefined
  return clean
}

export function isSafePluginPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\')) return false
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((part) => Boolean(part) && part !== '.' && part !== '..')
}

function agentParameters(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const schema = value as Record<string, unknown>
  if (schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) return undefined
  const properties = schema.properties as Record<string, unknown>
  if (Object.keys(properties).length > 32) return undefined
  for (const [name, raw] of Object.entries(properties)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(name) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
    const property = raw as Record<string, unknown>
    if (!['string', 'number', 'integer', 'boolean'].includes(String(property.type))) return undefined
    if (property.description !== undefined && (typeof property.description !== 'string' || property.description.length > 240)) return undefined
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== 'string' || !(name in properties)))) return undefined
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) return undefined
  try {
    if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > 16 * 1024) return undefined
  } catch { return undefined }
  return { ...schema, additionalProperties: false }
}

function agentTools(value: unknown, errors: string[]): PluginAgentToolV1[] | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('Plugin manifest agent must be an object')
    return undefined
  }
  const rawTools = (value as Record<string, unknown>).tools
  if (rawTools === undefined) return undefined
  if (!Array.isArray(rawTools) || rawTools.length < 1 || rawTools.length > 24) {
    errors.push('Plugin manifest agent.tools must contain 1-24 tools')
    return undefined
  }
  const tools: PluginAgentToolV1[] = []
  const names = new Set<string>()
  for (const raw of rawTools) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push('Plugin agent tool must be an object')
      continue
    }
    const tool = raw as Record<string, unknown>
    const name = text(tool.name, 'agent tool name', 40)
    const label = text(tool.label, 'agent tool label', 60)
    const description = text(tool.description, 'agent tool description', 500)
    const access = tool.access === 'read' || tool.access === 'write' ? tool.access : undefined
    const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(tool.method)) ? tool.method as PluginAgentToolV1['method'] : undefined
    const path = typeof tool.path === 'string' ? tool.path : ''
    const parameters = agentParameters(tool.parameters)
    if (!name || !PLUGIN_AGENT_TOOL_NAME_PATTERN.test(name) || names.has(name)) errors.push('Plugin agent tool names must be unique lowercase identifiers')
    if (!label) errors.push(`Plugin agent tool ${name ?? ''} label is invalid`)
    if (!description) errors.push(`Plugin agent tool ${name ?? ''} description is invalid`)
    if (!access) errors.push(`Plugin agent tool ${name ?? ''} access must be read or write`)
    if (!method) errors.push(`Plugin agent tool ${name ?? ''} method is invalid`)
    if (!path.startsWith('/agent/') || path.startsWith('//') || path.length > 240 || /[\\\0?#]/.test(path) || path.split('/').some((segment) => segment === '.' || segment === '..')) errors.push(`Plugin agent tool ${name ?? ''} path must use /agent/*`)
    if (!parameters) errors.push(`Plugin agent tool ${name ?? ''} parameters are invalid`)
    if (name && label && description && access && method && path && parameters && PLUGIN_AGENT_TOOL_NAME_PATTERN.test(name) && !names.has(name)) {
      names.add(name)
      tools.push({ name, label, description, access, method, path, parameters })
    }
  }
  return tools
}

function agentSkills(value: unknown, errors: string[]): PluginAgentSkillV1[] | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const rawSkills = (value as Record<string, unknown>).skills
  if (rawSkills === undefined) return undefined
  if (!Array.isArray(rawSkills) || rawSkills.length < 1 || rawSkills.length > 24) {
    errors.push('Plugin manifest agent.skills must contain 1-24 skills')
    return undefined
  }
  const skills: PluginAgentSkillV1[] = []
  const names = new Set<string>()
  const paths = new Set<string>()
  for (const raw of rawSkills) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push('Plugin agent skill must be an object')
      continue
    }
    const skill = raw as Record<string, unknown>
    const name = text(skill.name, 'agent skill name', 64)
    const description = text(skill.description, 'agent skill description', 500)
    const path = typeof skill.path === 'string' ? skill.path : ''
    const access = skill.access === 'read' || skill.access === 'write' ? skill.access : undefined
    if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || names.has(name)) errors.push('Plugin agent skill names must be unique lowercase identifiers')
    if (!description) errors.push(`Plugin agent skill ${name ?? ''} description is invalid`)
    if (!isSafePluginPath(path) || paths.has(path)) errors.push(`Plugin agent skill ${name ?? ''} path must be a unique safe relative path`)
    if (skill.access !== undefined && !access) errors.push(`Plugin agent skill ${name ?? ''} access must be read or write`)
    if (name && description && isSafePluginPath(path) && !names.has(name) && !paths.has(path)) {
      names.add(name)
      paths.add(path)
      skills.push({ name, description, path, ...(access ? { access } : {}) })
    }
  }
  return skills
}

export function validatePluginManifest(raw: unknown, options: PluginManifestValidationOptions = {}): PluginManifestValidation {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { success: false, errors: ['Plugin manifest must be an object'] }
  const value = raw as Record<string, unknown>
  if (value.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION) errors.push(`Plugin manifest schemaVersion must be ${PLUGIN_MANIFEST_SCHEMA_VERSION}`)

  const id = text(value.id, 'id', 48)
  if (!id || !PLUGIN_ID_PATTERN.test(id)) errors.push('Plugin manifest id must use lowercase letters, numbers, or hyphens')
  else if (options.expectedId && id !== options.expectedId) errors.push('Plugin manifest id must match its package directory')
  const name = text(value.name, 'name', 80)
  if (!name) errors.push('Plugin manifest name is invalid')
  const version = text(value.version, 'version', 64)
  if (!version || !PLUGIN_VERSION_PATTERN.test(version)) errors.push('Plugin manifest version must use semantic versioning')
  const description = text(value.description, 'description', 240, false)
  if (description === undefined) errors.push('Plugin manifest description is invalid')
  const dashboardVersion = value.dashboardVersion === undefined ? undefined : text(value.dashboardVersion, 'dashboardVersion', 80)
  if (value.dashboardVersion !== undefined && !dashboardVersion) errors.push('Plugin manifest dashboardVersion is invalid')
  if (options.requireDashboardVersion && !dashboardVersion) errors.push('Plugin manifest dashboardVersion is required')

  const entry = value.entry && typeof value.entry === 'object' && !Array.isArray(value.entry) ? value.entry as Record<string, unknown> : undefined
  const frontend = entry?.frontend
  if (!isSafePluginPath(frontend)) errors.push('Plugin manifest entry.frontend must be a safe relative path')
  const backend = entry?.backend
  let normalizedBackend: PluginManifestBackendV1 | undefined
  if (backend !== undefined) {
    if (!options.allowBackend) errors.push('Plugin backend entries are not supported for this package source')
    else if (!backend || typeof backend !== 'object' || Array.isArray(backend)) {
      errors.push('Plugin manifest entry.backend protocol is invalid')
    } else {
      const backendObj = backend as Record<string, unknown>
      if (backendObj.protocol === 'host-module') {
        const rawModule = backendObj.module === undefined ? 'server.ts' : backendObj.module
        if (!isSafePluginPath(rawModule)) {
          errors.push('Plugin manifest entry.backend.module must be a safe relative path')
        } else {
          normalizedBackend = { protocol: 'host-module', module: rawModule }
        }
      } else {
        errors.push('Plugin manifest entry.backend protocol is invalid (must be "host-module")')
      }
    }
  }
  const normalizedAgentTools = agentTools(value.agent, errors)
  const normalizedAgentSkills = agentSkills(value.agent, errors)
  if (value.agent !== undefined && !options.allowAgent) errors.push('Plugin agent skills and tools are not supported for this package source')
  if (value.agent !== undefined && !normalizedAgentTools && !normalizedAgentSkills) errors.push('Plugin manifest agent must declare tools or skills')
  if (normalizedAgentTools && !normalizedBackend) errors.push('Plugin agent tools require a backend runtime')
  for (const skill of normalizedAgentSkills ?? []) {
    if (skill.access && !normalizedAgentTools?.some((tool) => tool.access === skill.access)) {
      errors.push(`Plugin agent skill ${skill.name} requires a matching ${skill.access} tool`)
    }
  }
  if (id && normalizedAgentTools?.some((tool) => `plugin_${id.replaceAll('-', '_')}_${tool.name}`.length > 64)) errors.push('Plugin id and agent tool name are too long when combined')
  const navigation = value.navigation && typeof value.navigation === 'object' && !Array.isArray(value.navigation) ? value.navigation as Record<string, unknown> : undefined
  const label = text(navigation?.label, 'navigation.label', 40)
  const icon = text(navigation?.icon, 'navigation.icon', 8)
  if (!label) errors.push('Plugin manifest navigation.label is invalid')
  if (!icon) errors.push('Plugin manifest navigation.icon is invalid')

  const permissions = value.permissions
  if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== 'string')) errors.push('Plugin manifest permissions must be an array of known permission names')
  const known = new Set<string>(KNOWN_PLUGIN_PERMISSIONS)
  const normalizedPermissions = Array.isArray(permissions) ? [...new Set(permissions.filter((permission): permission is string => typeof permission === 'string'))] : []
  for (const permission of normalizedPermissions) if (!known.has(permission)) errors.push(`Unknown plugin permission: ${permission}`)
  if (options.supportedPermissions) {
    const supported = new Set<string>(options.supportedPermissions)
    for (const permission of normalizedPermissions) if (known.has(permission) && !supported.has(permission)) errors.push(`Plugin permission is not supported by this Dashboard: ${permission}`)
  }

  if (errors.length || !id || !name || !version || description === undefined || !isSafePluginPath(frontend) || !label || !icon) return { success: false, errors }
  return {
    success: true,
    manifest: {
      schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
      id,
      name,
      version,
      description,
      ...(dashboardVersion ? { dashboardVersion } : {}),
      entry: { frontend, ...(normalizedBackend ? { backend: normalizedBackend } : {}) },
      ...(normalizedAgentTools || normalizedAgentSkills ? {
        agent: {
          ...(normalizedAgentTools ? { tools: normalizedAgentTools } : {}),
          ...(normalizedAgentSkills ? { skills: normalizedAgentSkills } : {}),
        },
      } : {}),
      navigation: { label, icon },
      permissions: normalizedPermissions as PluginPermission[],
    },
  }
}

export interface PluginHostMessage {
  schemaVersion: 1
  pluginId: string
  type: 'ready' | 'navigate' | 'notify'
  value?: string
}

export interface PluginNavigationTarget {
  type: 'session'
  sessionId: string
}

export function parsePluginNavigationTarget(value: unknown): PluginNavigationTarget | undefined {
  if (typeof value !== 'string') return undefined
  const match = value.match(/^session:([A-Za-z0-9._-]{1,160})$/)
  return match ? { type: 'session', sessionId: match[1] } : undefined
}

export interface PluginRuntimeRequestMessage {
  schemaVersion: 1
  pluginId: string
  type: 'runtime-request'
  requestId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

export interface PluginRuntimeResponseMessage {
  schemaVersion: 1
  pluginId: string
  type: 'runtime-response'
  requestId: string
  status: number
  body: unknown
}

export function isPluginRuntimeRequestMessage(value: unknown, expectedPluginId: string): value is PluginRuntimeRequestMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  if (message.schemaVersion !== 1 || message.pluginId !== expectedPluginId || message.type !== 'runtime-request') return false
  if (typeof message.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(message.requestId)) return false
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(message.method))) return false
  if (typeof message.path !== 'string' || message.path.length > 2048 || !message.path.startsWith('/') || message.path.startsWith('//') || /[\\\0#]/.test(message.path)) return false
  try {
    const segments = message.path.split('?', 1)[0].split('/').map((segment) => decodeURIComponent(segment))
    if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) return false
    return message.body === undefined || new TextEncoder().encode(JSON.stringify(message.body)).byteLength <= 1024 * 1024
  } catch { return false }
}

export function isPluginHostMessage(value: unknown, expectedPluginId: string): value is PluginHostMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  return message.schemaVersion === 1
    && message.pluginId === expectedPluginId
    && (message.type === 'ready' || message.type === 'navigate' || message.type === 'notify')
    && (message.value === undefined || (typeof message.value === 'string' && message.value.length <= 500))
}
