import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { request as httpRequest } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  KNOWN_PLUGIN_PERMISSIONS,
  validatePluginManifest,
  type PluginAgentToolV1,
  type PluginManifestV1,
} from '../../packages/plugin-sdk/src/index.js'

const bundledRoot = process.env.PI_DASHBOARD_PLUGIN_CODE_ROOT ?? resolve(process.cwd(), '../plugins')
const stateRoot = process.env.PI_DASHBOARD_PLUGIN_STATE_ROOT ?? resolve(homedir(), '.pi/agent/dashboard/plugins')
const socketRoot = process.env.PI_DASHBOARD_PLUGIN_RUNTIME_SOCKET_ROOT ?? resolve(tmpdir(), 'pi-dashboard-plugins')
const authoringSkillPath = process.env.PI_DASHBOARD_PLUGIN_AUTHORING_SKILL_PATH ?? join(process.cwd(), 'skills/dashboard-plugin-authoring')
const referenceSkillPath = process.env.PI_DASHBOARD_REFERENCE_SKILL_PATH ?? join(process.cwd(), 'skills/dashboard-reference')
const workerReadOnly = process.env.PI_DASHBOARD_WORKER_MODE === 'research' || process.env.PI_DASHBOARD_WORKER_MODE === 'review'
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 10_000
const installedRoot = join(stateRoot, 'installed')

interface Registry {
  schemaVersion: 1
  enabled: Record<string, boolean>
  agentAccess?: Record<string, { read?: boolean; write?: boolean }>
}

interface RuntimePlugin {
  directory: string
  manifest: PluginManifestV1
}

function registeredName(pluginId: string, toolName: string): string {
  return `plugin_${pluginId.replaceAll('-', '_')}_${toolName}`
}

async function registry(): Promise<Registry> {
  try {
    const value = JSON.parse(await readFile(join(stateRoot, 'registry.json'), 'utf8')) as Registry
    return value?.schemaVersion === 1 && value.enabled && typeof value.enabled === 'object'
      ? value
      : { schemaVersion: 1, enabled: {} }
  } catch {
    return { schemaVersion: 1, enabled: {} }
  }
}

async function discoverRoot(root: string, source: 'bundled' | 'repository'): Promise<RuntimePlugin[]> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return [] }
  const results: RuntimePlugin[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const directory = join(root, entry.name)
      const raw = JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8')) as unknown
      const result = validatePluginManifest(raw, {
        expectedId: entry.name,
        allowBackend: true,
        allowAgent: true,
        supportedPermissions: KNOWN_PLUGIN_PERMISSIONS,
      })
      if (result.success && source === 'repository' && result.manifest.entry.backend?.protocol === 'http-unix-v1') continue
      if (result.success && result.manifest.agent) {
        const skillFiles = await Promise.all((result.manifest.agent.skills ?? []).map((skill) =>
          stat(join(directory, skill.path, 'SKILL.md')).catch(() => undefined)))
        if (skillFiles.every((info) => info?.isFile())) results.push({ directory, manifest: result.manifest })
      }
    } catch {
      // An invalid or partially deployed plugin never becomes an agent tool.
    }
  }
  return results
}

async function manifests(): Promise<RuntimePlugin[]> {
  return [...await discoverRoot(bundledRoot, 'bundled'), ...await discoverRoot(installedRoot, 'repository')]
}

import { PluginHost } from '../src/plugin-host.js'

const pluginHost = new PluginHost(stateRoot)

async function invoke(plugin: RuntimePlugin, tool: PluginAgentToolV1, parameters: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const manifest = plugin.manifest
  if (manifest.entry.backend?.protocol === 'host-module') {
    if (!pluginHost.isLoaded(manifest.id)) {
      await pluginHost.loadPlugin(plugin.directory, manifest)
    }
    const result = await pluginHost.handleRequest(manifest.id, {
      method: tool.method,
      path: tool.path,
      query: tool.method === 'GET' ? new URLSearchParams(Object.entries(parameters).map(([k, v]) => [k, String(v)] as [string, string])) : undefined,
      body: tool.method === 'GET' ? undefined : parameters,
    })
    return { status: result.status ?? 200, body: result.body }
  }

  const query = tool.method === 'GET'
    ? new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)] as [string, string])).toString()
    : ''
  const body = tool.method === 'GET' ? Buffer.alloc(0) : Buffer.from(JSON.stringify(parameters))
  const path = `${tool.path}${query ? `?${query}` : ''}`
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      socketPath: join(socketRoot, manifest.id, `${manifest.id}.sock`),
      method: tool.method,
      path,
      headers: {
        'x-pi-dashboard-plugin-id': manifest.id,
        'content-type': 'application/json',
      },
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= MAX_RESPONSE_BYTES) chunks.push(chunk)
      })
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try {
          resolve({ status: response.statusCode ?? 200, body: JSON.parse(raw || '{}') as unknown })
        } catch {
          resolve({ status: response.statusCode ?? 200, body: raw })
        }
      })
    })
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('Plugin request timed out')))
    request.once('error', reject)
    request.end(body)
  })
}

export default async function dashboardPluginTools(pi: ExtensionAPI) {
  const settings = await registry()
  const plugins = await manifests()
  const skillPaths = [authoringSkillPath, referenceSkillPath]
  for (const plugin of plugins) {
    const manifest = plugin.manifest
    if (settings.enabled[manifest.id] !== true) continue
    const grants = settings.agentAccess?.[manifest.id]
    for (const skill of manifest.agent?.skills ?? []) {
      if (workerReadOnly && skill.access === 'write') continue
      if (skill.access && grants?.[skill.access] !== true) continue
      skillPaths.push(join(plugin.directory, skill.path))
    }
  }
  pi.on('resources_discover', () => ({ skillPaths }))
  const registeredNames = new Map<string, number>()

  for (const plugin of plugins) {
    const manifest = plugin.manifest
    if (settings.enabled[manifest.id] !== true) continue
    const grants = settings.agentAccess?.[manifest.id]
    for (const tool of manifest.agent?.tools ?? []) {
      if (workerReadOnly && tool.access === 'write') continue
      if (grants?.[tool.access] !== true) continue
      const name = registeredName(manifest.id, tool.name)
      registeredNames.set(name, (registeredNames.get(name) ?? 0) + 1)
    }
  }

  for (const plugin of plugins) {
    const manifest = plugin.manifest
    if (settings.enabled[manifest.id] !== true) continue
    const grants = settings.agentAccess?.[manifest.id]
    for (const tool of manifest.agent?.tools ?? []) {
      if (workerReadOnly && tool.access === 'write') continue
      if (grants?.[tool.access] !== true) continue
      const name = registeredName(manifest.id, tool.name)
      if (registeredNames.get(name) !== 1) continue
      pi.registerTool({
        name,
        label: `${manifest.navigation.label}: ${tool.label}`,
        description: tool.description,
        promptSnippet: `${tool.label} using the enabled ${manifest.navigation.label} plugin`,
        parameters: tool.parameters as never,
        async execute(_toolCallId, parameters) {
          try {
            const result = await invoke(plugin, tool, parameters as Record<string, unknown>)
            const rendered = typeof result.body === 'string' ? result.body : JSON.stringify(result.body)
            return {
              content: [{ type: 'text', text: result.status >= 200 && result.status < 300 ? rendered : `Plugin request failed (${result.status}): ${rendered}` }],
              details: { pluginId: manifest.id, tool: tool.name, access: tool.access, status: result.status, body: result.body },
              isError: result.status < 200 || result.status >= 300,
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Plugin tool failed'
            return {
              content: [{ type: 'text', text: message }],
              details: { pluginId: manifest.id, tool: tool.name, access: tool.access, status: 500, body: { error: message } },
              isError: true,
            }
          }
        },
      })
    }
  }
}
