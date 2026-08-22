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
  providersEnabled: {
    'sub-pi': true,
    'antigravity-cli': true,
    'codex-cli': true,
    'claude-cli': false,
  },
  defaultBounds: DEFAULT_BOUNDS,
}

const DEFAULT_ROUTER_MD = `# Worker Delegation Router (Level 1)

When deciding which worker to assign for a task, follow these guidelines:

## Provider Specializations

### 1. Antigravity CLI (\`antigravity-cli\`)
- **Strengths**: Deep reasoning, science and academic research, complex multi-file refactoring, algorithm design, full codebase sweeps.
- **Supported Modes**: \`research\` (investigation), \`review\` (critique/risks), \`implement\` (code changes & testing).
- **Default Recommendation**: Primary choice for scientific research, in-depth architectural reasoning, and complex full-stack implementations.

### 2. Codex CLI (\`codex-cli\`)
- **Strengths**: Fast TypeScript/React component generation, unit tests (vitest/jest), boilerplate scaffolding, rapid code iterations.
- **Supported Modes**: \`research\`, \`review\`, \`implement\`.
- **Default Recommendation**: Primary choice for fast frontend/backend code generation, writing test suites, and narrow bug fixes.

### 3. Claude CLI (\`claude-cli\`)
- **Strengths**: Documentation writing, API design review, narrative structuring, markdown editing, high-level code critique.
- **Supported Modes**: \`research\`, \`review\`, \`implement\`.
- **Default Recommendation**: Primary choice for documentation, technical writing, and thorough code reviews.

### 4. Sub PI (\`sub-pi\`)
- **Strengths**: General-purpose isolated Pi sub-agent, plugin authoring, exploration without polluting main session history.
- **Supported Modes**: \`research\`, \`review\`, \`implement\`.
- **Default Recommendation**: Best for self-contained tasks, testing plugins, or running alternative models within Pi's native ecosystem.
`

const DEFAULT_ANTIGRAVITY_MD = `# Antigravity CLI Guidelines (Level 2)

You are operating as a dedicated Antigravity worker delegated a focused task by Pi Dashboard.

## Working Principles:
1. **Strict Workspace Confinement**: All created files, edits, and artifact generation MUST occur strictly within the active project workspace root. Do NOT write to ~/.gemini, scratch directories, or temporary paths.
2. **Be Rigorous & Precise**: Analyze the codebase thoroughly before making changes.
3. **Type Safety & Validation**: In \`implement\` mode, ensure TypeScript compiles cleanly (\`npx tsc --noEmit\` or relevant project build command).
4. **Structured Summary**: Conclude your work with a concise breakdown of:
   - Summary of findings or changes made.
   - List of modified/created files inside the project.
   - Any remaining risks, warnings, or next steps.
`

const DEFAULT_CODEX_MD = `# Codex CLI Guidelines (Level 2)

You are operating as a dedicated Codex worker delegated a focused task by Pi Dashboard.

## Working Principles:
1. **Strict Workspace Confinement**: All created files, edits, and tests MUST occur strictly within the active project workspace root. Do NOT write to ~/.codex or external paths.
2. **Idiomatic & Clean Code**: Write concise, modern TypeScript/JavaScript adhering to project conventions.
3. **Minimal Dependencies**: Do not add external npm packages unless strictly requested.
4. **Structured Summary**: Return a concise summary of all changes made, validation steps run, and touched files.
`

const DEFAULT_CLAUDE_MD = `# Claude CLI Guidelines (Level 2)

You are operating as a dedicated Claude worker delegated a focused task by Pi Dashboard.

## Working Principles:
1. **Strict Workspace Confinement**: All created files, edits, documentation, and reviews MUST occur strictly within the active project workspace root. Do NOT write to ~/.claude, temporary paths, or directories outside the workspace.
2. **Clear Explanations & Architecture**: Provide thorough explanations, clean documentation, and well-structured code.
3. **Review & Critique**: In \`review\` mode, highlight actionable suggestions and potential security or performance pitfalls.
4. **Structured Summary**: Summarize your actions, changes, and key takeaways clearly.
`

const DEFAULT_SUB_PI_MD = `# Sub PI Guidelines (Level 2)

You are operating as a focused Sub PI worker executing a delegated task in a separate Pi session.

## Working Principles:
1. **Task Focus**: Stick strictly to the delegated task. Do not wander outside the scope of the prompt.
2. **Keep Result Concise**: Primary Pi will receive your text output to incorporate into the main conversation. Keep your final summary direct and informative.
`

export class WorkerRulesService {
  readonly rootDir: string
  readonly rulesDir: string
  readonly configFile: string
  readonly routerFile: string

  constructor(customRootDir?: string) {
    this.rootDir = customRootDir ? resolve(customRootDir) : resolve(homedir(), '.pi-dashboard/workers')
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

      // Seed WORKERS.md (Level 1)
      try {
        await stat(this.routerFile)
      } catch {
        await writeFile(this.routerFile, DEFAULT_ROUTER_MD, 'utf8')
      }

      // Seed Level 2 rule files
      const defaultRules: Record<string, string> = {
        'antigravity.md': DEFAULT_ANTIGRAVITY_MD,
        'codex.md': DEFAULT_CODEX_MD,
        'claude.md': DEFAULT_CLAUDE_MD,
        'sub-pi.md': DEFAULT_SUB_PI_MD,
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
      providersEnabled: { ...current.providersEnabled, ...(updates.providersEnabled ?? {}) },
      defaultBounds: { ...current.defaultBounds, ...(updates.defaultBounds ?? {}) },
      ...(updates.subPi ? { subPi: updates.subPi } : current.subPi ? { subPi: current.subPi } : {}),
    }
    await writeFile(this.configFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
    return merged
  }

  async listRules(): Promise<WorkerRuleFile[]> {
    const rules: WorkerRuleFile[] = []

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
      'antigravity.md': { id: 'rule-antigravity', title: 'Antigravity CLI Guidelines', providerId: 'antigravity-cli' },
      'codex.md': { id: 'rule-codex', title: 'Codex CLI Guidelines', providerId: 'codex-cli' },
      'claude.md': { id: 'rule-claude', title: 'Claude CLI Guidelines', providerId: 'claude-cli' },
      'sub-pi.md': { id: 'rule-sub-pi', title: 'Sub PI Guidelines', providerId: 'sub-pi' },
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
          rules.push({
            id: meta.id,
            title: meta.title,
            fileName: file,
            level: 2,
            providerId: meta.providerId,
            content,
            updatedAt: fileStat.mtime.toISOString(),
          })
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
      fileName = `${cleanId}.md`
      targetPath = join(this.rulesDir, fileName)
      title = `${cleanId.toUpperCase()} Guidelines`
      providerId = cleanId.endsWith('-cli') ? cleanId : `${cleanId}-cli`
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
    const cleanId = providerId.replace(/-cli$/, '')
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
