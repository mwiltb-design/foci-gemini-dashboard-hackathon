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

Foci Dashboard's Cloud Run hackathon profile uses two Google-centered workers only:

- \`gemini-worker\` — in-process, Cloud Run-native Gemini worker powered by \`@google/genai\`.
- \`antigravity-cli\` — Google Antigravity CLI worker for environments where \`agy\` is installed and authenticated.

Do not route work to Codex, Claude, or Sub-Pi in the hackathon Cloud profile.

## Default routing

### Gemini Worker (\`gemini-worker\`)
Use as the default worker in Cloud Run and whenever reliability matters.

Best for:
- Fast research, summaries, and comparisons.
- Reviewing diffs, logs, configuration, and deployment output.
- Producing patch plans or implementation artifacts when a CLI worker is unavailable.
- Any task that must work from Gemini API credentials alone.

Modes:
- \`research\`: concise investigation with exact file paths or evidence.
- \`review\`: risks, bugs, regressions, and recommended fixes.
- \`implement\`: create a concrete artifact/plan; do not claim direct code edits unless the worker actually wrote an artifact.

### Antigravity CLI (\`antigravity-cli\`)
Use only when the provider status is ready/authenticated. In Cloud Run, \`agy\` may be installed but unavailable until OAuth/token state exists.

Best for:
- Deep codebase and architecture sweeps.
- Multi-file implementation tasks that need direct workspace edits.
- Repo, build, Docker, Cloud Run, and git workflow work after explicit user approval.
- Independent review of Gemini or primary-agent changes.

Modes:
- \`research\`: broad codebase investigation and evidence gathering.
- \`review\`: detailed critique of uncommitted diffs or deployment risk.
- \`implement\`: direct file edits and validation runs inside the workspace.

## Routing rules

1. Prefer \`gemini-worker\` for Cloud Run-safe tasks, quick answers, summaries, and fallback execution.
2. Prefer \`antigravity-cli\` for complex repo/cloud/build work only when it is authenticated and the task benefits from full CLI workspace access.
3. If \`antigravity-cli\` is unavailable or asks for interactive auth, do not wait or retry in the background; use \`gemini-worker\` or ask the user to complete Manage CLI login.
4. Never delegate tasks that require secrets to be displayed, credentials to be copied into chat, or interactive approval inside a background worker.
5. Keep worker tasks narrow, bounded, and review all worker findings before accepting them.
6. All edits/artifacts must stay inside the active workspace. Do not write to external scratch folders except normal build/test caches.
`

const DEFAULT_GEMINI_MD = `# Gemini Worker Guidelines (Level 2)

You are the built-in Gemini Worker for Foci Dashboard's Google hackathon Cloud profile.

## Working Principles
1. **Cloud-native first**: Assume you may be running in Cloud Run with only Gemini API credentials. Do not require external CLI login.
2. **Task focus**: Answer the delegated prompt directly and stay inside the requested mode: research, review, or implement.
3. **Evidence and paths**: Cite exact files, commands, endpoints, or observed outputs when reviewing technical work.
4. **Implementation mode**: Produce concrete patch plans or workspace artifacts. Do not claim code was edited unless you actually created an artifact or file.
5. **Structured result**: Return Summary, Actions Taken, Risks/Warnings, and Next Steps.
`

const DEFAULT_ANTIGRAVITY_MD = `# Antigravity CLI Guidelines (Level 2)

You are the Antigravity CLI worker for Foci Dashboard's Google hackathon profile.

## Working Principles
1. **Authentication required**: Only run when \`agy\` is installed and authenticated. If OAuth or interactive login is required, stop and report that Manage CLI login is needed.
2. **Strict workspace confinement**: All edits and artifacts must remain inside the active project workspace. Do not modify credential stores such as \`~/.gemini\` unless the user explicitly asked for CLI account management.
3. **Best use cases**: Deep codebase searches, architecture reviews, Docker/Cloud Run/git work, and multi-file implementation tasks.
4. **Validation**: In \`implement\` mode, run focused checks such as \`npm --prefix server run build\`, \`npm --prefix ui run build\`, tests, Docker build, or smoke checks when practical.
5. **Structured result**: Report files changed, commands run, validation results, deployment/git actions, and remaining risks.
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
