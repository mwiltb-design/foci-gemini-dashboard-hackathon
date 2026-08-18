import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export type ToolAccess = 'read' | 'write' | 'execute' | 'custom'
export type ToolRisk = 'low' | 'medium' | 'high'

export interface RuntimeTool {
  name: string
  description: string
  active: boolean
  available: boolean
  source: string
  scope: string
  origin: string
  access: ToolAccess
  risk: ToolRisk
  parameterNames: string[]
  promptGuidelines: string[]
  piAccess: boolean
  status: string
  dependency?: {
    type: 'plugin'
    id: string
    name: string
    enabled: boolean
    access: 'read' | 'write'
    granted: boolean
  }
}

export interface ShellCapability {
  name: string
  label: string
  description: string
  available: boolean
  version?: string
  source: string
  piAccess: boolean
  status: string
}

interface RuntimeSnapshot {
  capturedAt?: string
  tools?: Array<{
    name?: string
    description?: string
    active?: boolean
    promptGuidelines?: string[]
    parameterNames?: string[]
    sourceInfo?: { source?: string; scope?: string; origin?: string }
  }>
}

export interface PluginToolCatalogSource {
  id: string
  name: string
  enabled: boolean
  agentTools: Array<{
    name: string
    label: string
    description: string
    access: 'read' | 'write'
    parameterNames: string[]
  }>
  agentAccess: { read: boolean; write: boolean }
}

const builtins: Record<string, { description: string; access: ToolAccess; risk: ToolRisk; parameters: string[] }> = {
  read: { description: 'Read text files and images from the working environment.', access: 'read', risk: 'low', parameters: ['path', 'offset', 'limit'] },
  grep: { description: 'Search file contents without running a shell command.', access: 'read', risk: 'low', parameters: ['pattern', 'path', 'glob', 'limit'] },
  find: { description: 'Find files by name or glob pattern.', access: 'read', risk: 'low', parameters: ['pattern', 'path', 'limit'] },
  ls: { description: 'List files and directories.', access: 'read', risk: 'low', parameters: ['path', 'limit'] },
  bash: { description: 'Run shell commands and installed command-line programs.', access: 'execute', risk: 'high', parameters: ['command', 'timeout'] },
  edit: { description: 'Make precise replacements in an existing file.', access: 'write', risk: 'high', parameters: ['path', 'edits'] },
  write: { description: 'Create a file or replace its complete contents.', access: 'write', risk: 'high', parameters: ['path', 'content'] },
}

const shellPrograms = [
  { name: 'git', label: 'Git', description: 'Version control, history, branches, and diffs.' },
  { name: 'rg', label: 'ripgrep', description: 'Fast recursive text and file searching.' },
  { name: 'fd', label: 'fd', description: 'Fast filename searching when installed.' },
  { name: 'node', label: 'Node.js', description: 'JavaScript and TypeScript application runtime.' },
  { name: 'npm', label: 'npm', description: 'Node.js package and script manager.' },
  { name: 'bash', label: 'Bash', description: 'The shell used to execute command lines.' },
]

function classify(name: string): { access: ToolAccess; risk: ToolRisk } {
  if (builtins[name]) return builtins[name]
  return { access: 'custom', risk: 'medium' }
}

function firstVersionLine(value: string): string | undefined {
  const line = value.split('\n').map((item) => item.trim()).find(Boolean)
  return line?.slice(0, 120)
}

export class ToolService {
  constructor(private readonly runtimeInfoPath: string) {}

  async get(pluginSources: PluginToolCatalogSource[] = []): Promise<{ capturedAt?: string; tools: RuntimeTool[]; shell: ShellCapability[] }> {
    const snapshot = await this.snapshot()
    const byName = new Map<string, RuntimeTool>()
    for (const [name, definition] of Object.entries(builtins)) {
      byName.set(name, {
        name, description: definition.description, active: false, available: true, source: 'builtin', scope: 'runtime', origin: 'top-level',
        access: definition.access, risk: definition.risk, parameterNames: definition.parameters, promptGuidelines: [],
        piAccess: false, status: 'Available built-in; not active in the current PI session',
      })
    }
    for (const tool of snapshot.tools ?? []) {
      if (!tool.name) continue
      const classification = classify(tool.name)
      byName.set(tool.name, {
        name: tool.name,
        description: tool.description || builtins[tool.name]?.description || 'Extension-provided Pi tool.',
        active: Boolean(tool.active), available: true,
        source: tool.sourceInfo?.source ?? 'unknown', scope: tool.sourceInfo?.scope ?? 'runtime', origin: tool.sourceInfo?.origin ?? 'top-level',
        access: classification.access, risk: classification.risk,
        parameterNames: Array.isArray(tool.parameterNames) ? tool.parameterNames.filter((item): item is string => typeof item === 'string') : [],
        promptGuidelines: Array.isArray(tool.promptGuidelines) ? tool.promptGuidelines.filter((item): item is string => typeof item === 'string') : [],
        piAccess: Boolean(tool.active),
        status: tool.active ? 'Active in the current PI session' : 'Registered with PI but not active in the current session',
      })
    }
    for (const plugin of pluginSources) {
      for (const tool of plugin.agentTools) {
        const name = `plugin_${plugin.id.replaceAll('-', '_')}_${tool.name}`
        const runtime = byName.get(name)
        const granted = plugin.agentAccess[tool.access]
        const active = Boolean(runtime?.active && plugin.enabled && granted)
        const risk = tool.access === 'write' ? 'high' : 'low'
        byName.set(name, {
          name,
          description: tool.description,
          active,
          available: true,
          source: `plugin:${plugin.id}`,
          scope: 'plugin',
          origin: plugin.name,
          access: tool.access,
          risk,
          parameterNames: tool.parameterNames,
          promptGuidelines: runtime?.promptGuidelines ?? [],
          piAccess: active,
          status: !plugin.enabled
            ? `Requires the ${plugin.name} plugin to be enabled`
            : !granted
              ? `Requires PI ${tool.access} access for the ${plugin.name} plugin`
              : active
                ? 'Active in the current PI session'
                : 'Granted by the plugin but not active in the current PI session',
          dependency: {
            type: 'plugin',
            id: plugin.id,
            name: plugin.name,
            enabled: plugin.enabled,
            access: tool.access,
            granted,
          },
        })
      }
    }
    const tools = Array.from(byName.values()).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    return { ...(snapshot.capturedAt ? { capturedAt: snapshot.capturedAt } : {}), tools, shell: await this.shellCapabilities(byName.get('bash')?.active === true) }
  }

  private async snapshot(): Promise<RuntimeSnapshot> {
    try {
      const source = await readFile(this.runtimeInfoPath, 'utf8')
      if (Buffer.byteLength(source) > 256 * 1024) return {}
      const parsed = JSON.parse(source)
      return parsed && typeof parsed === 'object' ? parsed as RuntimeSnapshot : {}
    } catch {
      return {}
    }
  }

  private async shellCapabilities(bashActive: boolean): Promise<ShellCapability[]> {
    return Promise.all(shellPrograms.map(async (program) => {
      try {
        const result = await execute(program.name, ['--version'], { encoding: 'utf8', timeout: 2_000, maxBuffer: 16 * 1024 })
        return {
          ...program,
          available: true,
          version: firstVersionLine(`${result.stdout}\n${result.stderr}`),
          source: 'Dashboard backend PATH',
          piAccess: bashActive,
          status: bashActive ? 'PI can run this program through the active Bash tool' : 'Installed, but requires the Bash tool to be active',
        }
      } catch {
        return {
          ...program,
          available: false,
          source: 'Dashboard backend PATH',
          piAccess: false,
          status: 'Not installed in the Dashboard backend',
        }
      }
    }))
  }
}
