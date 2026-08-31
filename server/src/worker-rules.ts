import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { WorkerBounds, WorkerConfiguration, WorkerRuleFile } from './worker-types.js'

const DEFAULT_BOUNDS: WorkerBounds = {
  turnLimit: 8,
  timeoutMs: 10 * 60_000,
  resultLimitBytes: 12 * 1024,
}

const DEFAULT_CONFIG: WorkerConfiguration = {
  schemaVersion: 1,
  stackPreset: 'developer',
  showRulesEditor: true,
  providersEnabled: {
    'gemini-worker': true,
    'antigravity-cli': true,
  },
  defaultBounds: DEFAULT_BOUNDS,
}

const DEFAULT_ROUTER_MD = `# Foci Hackathon Worker Router (Level 1)

Foci Dashboard's Cloud Run profile orchestrates two specialized worker providers:

- \`gemini-worker\` — In-process, Cloud Run-native Gemini worker with direct container execution.
- \`antigravity-cli\` — Google Antigravity CLI worker equipped with the full external tool/skill ecosystem.

---

## Worker Specialization & Capabilities

### 1. Gemini Worker (\`gemini-worker\`) — In-Container Core Toolset
Use as the primary worker for all container-embedded tasks and direct workspace execution.

**Tools Available to Gemini Worker (5 Core Tools):**
1. \`read_file\`: Inspecting workspace files, code, and manifests.
2. \`write_file\`: Creating/updating files, code modules, and HTML reports.
3. \`list_directory\`: Exploring project folder structure.
4. \`run_command\`: Running Python 3.11 geospatial pipelines (GDAL, \`rasterio\`, \`geopandas\`, \`shapely\`), shell scripts, git operations, pip, tests, and build tasks directly in the container.
5. \`dashboard_delegate_worker\`: Chaining sub-delegations.

**Best for:**
- In-container script execution, geospatial processing, and automated data pipelines.
- Code generation, refactoring, and patch creation inside the workspace.
- Fast, reliable execution requiring only Gemini API credentials.

**Modes:**
- \`implement\`: Directly write code, execute scripts, and generate deliverables.
- \`research\`: Investigate workspace files and extract specific technical facts.
- \`review\`: Code quality checks, diff analysis, and bug prevention.

---

### 2. Antigravity CLI (\`antigravity-cli\`) — Advanced Ecosystem & External Toolset
Use when tasks require specialized capabilities outside the simple container sandbox.

**Capabilities & Skills:**
- Full Antigravity multi-domain skill catalog (scientific literature search, UniProt, PDB, AlphaFold, ChEMBL, OpenFDA).
- External web browsing and internet research.
- Cross-workspace synchronization and deep repository refactoring.

**Best for:**
- Advanced research requiring domain-specific ecosystem skills or external web search.
- Deep architectural sweeps and multi-repository refactoring.

**Modes:**
- \`research\`: Broad external evidence gathering and domain literature lookups.
- \`review\`: Comprehensive multi-file architectural review.
- \`implement\`: Full-stack codebase implementations.

---

## Routing Principles
1. **In-Container Execution:** Route to \`gemini-worker\` for all direct terminal tasks, Python pipelines, file generation, and workspace operations.
2. **External / Multi-Skill Tasks:** Route to \`antigravity-cli\` when the task requires external web search or specialized ecosystem skills.
3. **Keep Tasks Bounded:** Always provide clear, actionable prompts with exact paths and objectives.
`

const DEFAULT_GEMINI_MD = `# Gemini Worker Guidelines (Level 2)

You are the built-in Gemini Worker for Foci Dashboard running natively in Google Cloud Run.

## Available In-Container Tools (5 Core Tools)
1. \`read_file\`: Read any workspace file.
2. \`write_file\`: Create or overwrite files and code deliverables.
3. \`list_directory\`: Explore workspace directory structures.
4. \`run_command\`: Execute Python 3.11 geospatial pipelines (GDAL, \`rasterio\`, \`geopandas\`), shell commands, Git, and build tasks.
5. \`dashboard_delegate_worker\`: Delegate sub-tasks.

## Working Principles
1. **In-Container Execution**: Execute code and commands directly in the container workspace.
2. **Task focus**: Answer the delegated prompt directly and stay inside the requested mode: research, review, or implement.
3. **Evidence and paths**: Cite exact files, commands, endpoints, or observed outputs.
4. **Structured result**: Return Summary, Actions Taken, Risks/Warnings, and Next Steps.
`

const DEFAULT_ANTIGRAVITY_MD = `# Antigravity CLI Guidelines (Level 2)

You are the Antigravity CLI worker for Foci Dashboard's Google ecosystem.

## Working Principles
1. **External & Advanced Ecosystem**: Use when tasks require specialized scientific skills, external web search, or cross-workspace operations.
2. **Strict workspace confinement**: All edits and artifacts must remain inside the active project workspace.
3. **Validation**: In \`implement\` mode, run focused build/test validation runs.
4. **Structured result**: Report files changed, commands run, validation results, and remaining risks.
`

export class WorkerRulesService {
  readonly rootDir: string
  readonly rulesDir: string
  readonly configFile: string
  readonly routerFile: string

  constructor(customRootDir?: string) {
    const defaultDataDir = process.env.PI_DASHBOARD_DATA_DIR ?? process.env.FOCI_DASHBOARD_DATA_DIR ?? resolve(homedir(), '.pi-dashboard')
    this.rootDir = customRootDir
      ? resolve(customRootDir)
      : resolve(process.env.PI_DASHBOARD_WORKER_RULES_ROOT ?? resolve(defaultDataDir, 'workers'))
    this.rulesDir = join(this.rootDir, 'rules')
    this.configFile = join(this.rootDir, 'config.json')
    this.routerFile = join(this.rootDir, 'WORKERS.md')
  }

  async initialize(): Promise<void> {
    try {
      await mkdir(this.rulesDir, { recursive: true })

      // Seed config.json
      try {
        await stat(this.configFile)
      } catch {
        await writeFile(this.configFile, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, 'utf8')
      }

      // Seed or migrate WORKERS.md (Level 1)
      try {
        await stat(this.routerFile)
        const existingRouter = await readFile(this.routerFile, 'utf8')
        const looksLikeLegacyDefault = existingRouter.includes('Codex CLI') && existingRouter.includes('Claude CLI') && existingRouter.includes('Sub PI') && !existingRouter.includes('gemini-worker')
        if (looksLikeLegacyDefault) await writeFile(this.routerFile, DEFAULT_ROUTER_MD, 'utf8')
      } catch {
        await writeFile(this.routerFile, DEFAULT_ROUTER_MD, 'utf8')
      }

      // Seed Level 2 rule files
      const defaultRules: Record<string, string> = {
        'gemini-worker.md': DEFAULT_GEMINI_MD,
        'antigravity.md': DEFAULT_ANTIGRAVITY_MD,
      }

      for (const [filename, content] of Object.entries(defaultRules)) {
        const filePath = join(this.rulesDir, filename)
        try {
          await stat(filePath)
        } catch {
          await writeFile(filePath, content, 'utf8')
        }
      }
    } catch {
      // Non-fatal
    }
  }

  async loadConfig(): Promise<WorkerConfiguration> {
    try {
      const content = await readFile(this.configFile, 'utf8')
      const parsed = JSON.parse(content) as WorkerConfiguration
      if (parsed?.schemaVersion === 1) {
        return {
          schemaVersion: 1,
          stackPreset: parsed.stackPreset ?? DEFAULT_CONFIG.stackPreset,
          enabledFeatures: parsed.enabledFeatures,
          showRulesEditor: parsed.showRulesEditor ?? DEFAULT_CONFIG.showRulesEditor,
          providersEnabled: { ...DEFAULT_CONFIG.providersEnabled, ...(parsed.providersEnabled ?? {}) },
          defaultBounds: { ...DEFAULT_BOUNDS, ...(parsed.defaultBounds ?? {}) },
          ...(parsed.subPi ? { subPi: parsed.subPi } : {}),
        }
      }
    } catch {
      // Fallback
    }
    return { ...DEFAULT_CONFIG }
  }

  async updateConfig(updates: Partial<WorkerConfiguration>): Promise<WorkerConfiguration> {
    const current = await this.loadConfig()
    const merged: WorkerConfiguration = {
      schemaVersion: 1,
      stackPreset: updates.stackPreset ?? current.stackPreset,
      enabledFeatures: updates.enabledFeatures ?? current.enabledFeatures,
      showRulesEditor: updates.showRulesEditor !== undefined ? updates.showRulesEditor : current.showRulesEditor,
      providersEnabled: { ...current.providersEnabled, ...(updates.providersEnabled ?? {}) },
      defaultBounds: { ...current.defaultBounds, ...(updates.defaultBounds ?? {}) },
      ...(updates.subPi ? { subPi: updates.subPi } : current.subPi ? { subPi: current.subPi } : {}),
    }
    await writeFile(this.configFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return merged
  }

  async listRules(): Promise<WorkerRuleFile[]> {
    const rules: WorkerRuleFile[] = []
    const envFilter = process.env.FOCI_ENABLED_WORKERS?.trim()
    const cloudProfile = Boolean(process.env.K_SERVICE) || (process.env.FOCI_AGENT_PROVIDER ?? process.env.PI_DASHBOARD_AGENT_PROVIDER ?? '').toLowerCase() === 'gemini'
    const allowedProviders = envFilter && envFilter !== '*' && envFilter.toLowerCase() !== 'all'
      ? new Set(envFilter.split(',').map((id) => id.trim()).filter(Boolean))
      : cloudProfile && envFilter !== '*' && envFilter?.toLowerCase() !== 'all'
        ? new Set(['gemini-worker', 'antigravity-cli'])
        : undefined

    // 1. Level 1 Router
    try {
      const routerStat = await stat(this.routerFile)
      const content = await readFile(this.routerFile, 'utf8')
      rules.push({
        id: 'workers-router',
        title: 'Router & Dispatcher Rules (Level 1)',
        fileName: 'WORKERS.md',
        level: 1,
        content,
        updatedAt: routerStat.mtime.toISOString(),
      })
    } catch {
      rules.push({
        id: 'workers-router',
        title: 'Router & Dispatcher Rules (Level 1)',
        fileName: 'WORKERS.md',
        level: 1,
        content: DEFAULT_ROUTER_MD,
        updatedAt: new Date().toISOString(),
      })
    }

    // 2. Level 2 Worker Rules
    const providerMapping: Record<string, { id: string; title: string; providerId: string }> = {
      'gemini-worker.md': { id: 'rule-gemini-worker', title: 'Gemini Worker Guidelines', providerId: 'gemini-worker' },
      'antigravity.md': { id: 'rule-antigravity', title: 'Antigravity CLI Guidelines', providerId: 'antigravity-cli' },
    }

    try {
      const files = await readdir(this.rulesDir)
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        const filePath = join(this.rulesDir, file)
        try {
          const fileStat = await stat(filePath)
          const content = await readFile(filePath, 'utf8')
          const meta = providerMapping[file] ?? {
            id: `rule-${file.replace('.md', '')}`,
            title: `${file.replace('.md', '').toUpperCase()} Guidelines`,
            providerId: file.replace('.md', ''),
          }
          if (!allowedProviders || allowedProviders.has(meta.providerId)) {
            rules.push({
              id: meta.id,
              title: meta.title,
              fileName: file,
              level: 2,
              providerId: meta.providerId,
              content,
              updatedAt: fileStat.mtime.toISOString(),
            })
          }
        } catch {}
      }
    } catch {}

    return rules
  }

  async getRule(id: string): Promise<WorkerRuleFile | null> {
    const list = await this.listRules()
    return list.find((candidate) => candidate.id === id || candidate.fileName === id) ?? null
  }

  async saveRule(id: string, content: string): Promise<WorkerRuleFile> {
    let targetPath: string
    let level: 1 | 2 = 2
    let title = ''
    let fileName = ''
    let providerId: string | undefined

    if (id === 'workers-router' || id === 'WORKERS.md') {
      targetPath = this.routerFile
      level = 1
      title = 'Router & Dispatcher Rules (Level 1)'
      fileName = 'WORKERS.md'
    } else {
      const cleanId = id.replace(/^rule-/, '').replace(/\.md$/, '')
      const providerMap: Record<string, { fileName: string; title: string; providerId: string }> = {
        'gemini-worker': { fileName: 'gemini-worker.md', title: 'Gemini Worker Guidelines', providerId: 'gemini-worker' },
        antigravity: { fileName: 'antigravity.md', title: 'Antigravity CLI Guidelines', providerId: 'antigravity-cli' },
        'antigravity-cli': { fileName: 'antigravity.md', title: 'Antigravity CLI Guidelines', providerId: 'antigravity-cli' },
      }
      const mapped = providerMap[cleanId]
      fileName = mapped?.fileName ?? `${cleanId}.md`
      targetPath = join(this.rulesDir, fileName)
      title = mapped?.title ?? `${cleanId.toUpperCase()} Guidelines`
      providerId = mapped?.providerId ?? (cleanId.endsWith('-cli') || cleanId === 'gemini-worker' ? cleanId : `${cleanId}-cli`)
    }

    await writeFile(targetPath, content, 'utf8')
    const updatedStat = await stat(targetPath)

    return {
      id,
      title,
      fileName,
      level,
      ...(providerId ? { providerId } : {}),
      content,
      updatedAt: updatedStat.mtime.toISOString(),
    }
  }

  async getInjectedRulesForWorker(providerId: string): Promise<string> {
    const cleanId = providerId === 'gemini-worker' ? 'gemini-worker' : providerId.replace(/-cli$/, '')
    const targetFile = join(this.rulesDir, `${cleanId}.md`)
    try {
      return (await readFile(targetFile, 'utf8')).trim()
    } catch {
      return ''
    }
  }

  async getRouterRulesForPrimaryPi(): Promise<string> {
    try {
      return (await readFile(this.routerFile, 'utf8')).trim()
    } catch {
      return DEFAULT_ROUTER_MD.trim()
    }
  }
}
