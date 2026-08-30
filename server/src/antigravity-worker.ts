import { spawn, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { GitService, GitStatusEntry } from './git-service.js'
import { findExecutable, processGroupOptions, resolveExecutable, terminateProcess } from './process-control.js'
import type { WorkerAdapter, WorkerChangedFile, WorkerMode, WorkerProviderStatus, WorkerRunHooks, WorkerRunInput, WorkerRunOutput } from './worker-types.js'

function hasConcreteFileOrDir(path: string): boolean {
  try {
    const s = statSync(path)
    return s.isFile() || s.isDirectory()
  } catch {
    return false
  }
}

function boundedText(value: string, limit: number): { text: string; truncated: boolean } {
  const text = value.trim()
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= limit) return { text, truncated: false }
  return { text: `${buffer.subarray(0, limit).toString('utf8')}\n\n[Result truncated by Dashboard]`, truncated: true }
}

function entryKey(entry: GitStatusEntry): string {
  return `${entry.index}${entry.workingTree}:${entry.state}`
}

function changedFiles(before: GitStatusEntry[], after: GitStatusEntry[]): WorkerChangedFile[] {
  const baseline = new Map(before.map((entry) => [entry.path, entryKey(entry)]))
  return after
    .filter((entry) => baseline.get(entry.path) !== entryKey(entry))
    .map((entry) => ({ path: entry.path, state: entry.state }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function workerPrompt(input: WorkerRunInput, workspace: string): string {
  const role = input.mode === 'implement'
    ? 'You have permission to inspect and edit files inside the current workspace. Implement the requested changes and verify correctness.'
    : input.mode === 'review'
      ? 'Review the requested changes or code in the workspace and provide a structured assessment.'
      : 'Research the workspace and answer the question with precise evidence.'

  return [
    `Mode: ${input.mode}`,
    `Workspace: ${workspace}`,
    role,
    '',
    'Task:',
    input.prompt,
  ].join('\n')
}

export function cleanEnvironment(antigravityHome?: string, preferOAuth = false): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  // Strip dashboard and internal tokens to prevent credential exposure
  delete environment.PI_DASHBOARD_AUTH_TOKEN
  delete environment.PI_DASHBOARD_WORKER_INTERNAL_TOKEN
  delete environment.OPENROUTER_API_KEY
  delete environment.CODEX_HOME

  const targetHome = antigravityHome || process.env.PI_DASHBOARD_ANTIGRAVITY_HOME || process.env.ANTIGRAVITY_HOME || resolve(homedir(), '.gemini')
  environment.ANTIGRAVITY_HOME = targetHome
  environment.HOME = homedir()

  if (preferOAuth) {
    // When using OAuth subscription credentials, do not override with API key
    delete environment.GEMINI_API_KEY
    delete environment.GOOGLE_API_KEY
  } else {
    // Ensure Gemini/Google API keys are normalized and present for headless/API fallback mode
    const apiKey = environment.GEMINI_API_KEY?.trim() || environment.GOOGLE_API_KEY?.trim()
    if (apiKey) {
      environment.GEMINI_API_KEY = apiKey
      environment.GOOGLE_API_KEY = apiKey
    }
  }

  // Non-interactive and CI indicators for background worker execution
  environment.CI = '1'
  environment.NONINTERACTIVE = '1'

  return environment
}

export interface AntigravityWorkerOptions {
  workspace: string
  git: GitService
  enabled: boolean
  antigravityHome?: string
}

export class AntigravityWorkerAdapter implements WorkerAdapter {
  private active?: { taskId: string; child: ChildProcess }

  constructor(private readonly options: AntigravityWorkerOptions) {}

  private hasOAuthAuth(): boolean {
    const defaultHome = this.options.antigravityHome ?? join(homedir(), '.gemini')
    const cliHome = join(defaultHome, 'antigravity-cli')
    const userGemini = join(homedir(), '.gemini')
    const userAgy = join(userGemini, 'antigravity-cli')
    const candidatePaths = [
      join(cliHome, 'antigravity-oauth-token'),
      join(cliHome, 'oauth_credentials.json'),
      join(cliHome, 'auth.json'),
      join(cliHome, 'conversations'),
      join(defaultHome, 'antigravity-oauth-token'),
      join(defaultHome, 'oauth_credentials.json'),
      join(defaultHome, 'auth.json'),
      join(defaultHome, 'antigravity_state.pbtxt'),
      join(defaultHome, 'config', 'config.json'),
      join(userAgy, 'antigravity-oauth-token'),
      join(userAgy, 'oauth_credentials.json'),
      join(userAgy, 'auth.json'),
      join(userAgy, 'conversations'),
      join(userGemini, 'antigravity-oauth-token'),
      join(userGemini, 'oauth_credentials.json'),
      join(userGemini, 'auth.json'),
      join(userGemini, 'antigravity_state.pbtxt'),
      join(userGemini, 'config', 'config.json'),
    ]
    return candidatePaths.some((p) => hasConcreteFileOrDir(p))
  }

  get provider(): WorkerProviderStatus {
    const hasExecutable = Boolean(findExecutable('agy'))
    const hasLocalAuth = this.hasOAuthAuth()
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim())
    const explicitApiKeyAuth = (process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH ?? '').toLowerCase()
    const allowApiKeyAuth = ['1', 'true', 'yes'].includes(explicitApiKeyAuth)
    const authenticated = hasLocalAuth || (allowApiKeyAuth && hasApiKey)
    const ready = this.options.enabled && hasExecutable && authenticated

    return {
      id: 'antigravity-cli',
      name: 'Antigravity CLI',
      description: 'Google Antigravity running with full research, review, and implement capabilities.',
      kind: 'external',
      status: ready ? 'ready' : this.options.enabled ? 'unavailable' : 'disabled',
      statusLabel: !this.options.enabled
        ? 'Disabled by configuration'
        : !hasExecutable
          ? 'Desktop CLI not detected on server'
          : ready
            ? (hasLocalAuth ? 'Installed and ready (OAuth Subscription)' : 'Ready (API Key)')
            : 'Installed; select Connect to sign in with your Google account',
      modes: ['research', 'review', 'implement'] as WorkerMode[],
      enabled: this.options.enabled,
      loginCommand: 'exec agy',
      manageCommand: 'exec agy',
    }
  }

  async run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput> {
    const provider = this.provider
    if (provider.status !== 'ready') {
      throw new Error(`Antigravity CLI is not ready: ${provider.statusLabel}`)
    }
    if (this.active) throw new Error('Antigravity CLI is already running another task')
    const before = (await this.options.git.status()).entries
    const timeout = `${Math.max(60, Math.ceil(input.bounds.timeoutMs / 1_000))}s`
    const command = resolveExecutable('agy')
    const hasLocalAuth = this.hasOAuthAuth()
    const args = [
      '--add-dir', this.options.workspace,
      '--print', workerPrompt(input, this.options.workspace),
      '--sandbox',
      '--disable-slash-commands',
      ...(input.mode === 'implement' ? ['--dangerously-skip-permissions'] : []),
      '--output-format', 'text',
      '--print-timeout', timeout,
    ]

    const child = spawn(command, args, {
      cwd: this.options.workspace,
      env: cleanEnvironment(this.options.antigravityHome, hasLocalAuth),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...processGroupOptions(),
    })

    this.active = { taskId: input.taskId, child }
    await hooks.onProgress(`Antigravity is working on ${input.mode} task.`, 1)
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(-1_048_576) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-16_384) })

    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      const output = stdout.trim()
      if (exitCode !== 0 && !output) throw new Error(`Antigravity CLI exited with code ${exitCode ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
      const bounded = boundedText(output || stderr.trim() || 'Antigravity finished without a text result.', input.bounds.resultLimitBytes)
      const after = (await this.options.git.status()).entries
      const files = changedFiles(before, after)

      return {
        result: bounded.text,
        resultTruncated: bounded.truncated,
        changedFiles: files,
        resultEnvelope: {
          summary: bounded.text.slice(0, 300),
          actionsTaken: files.length ? [`Modified ${files.length} file(s)`] : ['Completed task inspection'],
          changedFiles: files,
          warnings: stderr.trim() ? [stderr.trim().slice(0, 200)] : [],
        },
      }
    } finally {
      if (this.active?.taskId === input.taskId) this.active = undefined
    }
  }

  async cancel(taskId: string): Promise<void> {
    const active = this.active
    if (active?.taskId !== taskId) return
    terminateProcess(active.child, 'SIGTERM')
    setTimeout(() => terminateProcess(active.child, 'SIGKILL'), 2_000).unref()
  }
}
