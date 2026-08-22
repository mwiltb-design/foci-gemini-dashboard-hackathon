import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GitService, GitStatusEntry } from './git-service.js'
import { processGroupOptions, resolveExecutable, terminateProcess } from './process-control.js'
import type { WorkerAdapter, WorkerChangedFile, WorkerMode, WorkerProviderStatus, WorkerRunHooks, WorkerRunInput, WorkerRunOutput } from './worker-types.js'

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

function claudePrompt(input: WorkerRunInput, workspace: string): string {
  const role = input.mode === 'implement'
    ? 'You may inspect and edit files inside the current workspace. Implement the requested changes and verify correctness.'
    : input.mode === 'review'
      ? 'Review the project read-only. Provide detailed critique, risk assessment, and recommendations.'
      : 'Research the project read-only and report structured, evidence-based findings.'

  const rules = input.ruleContext ? `\n\nGuidelines:\n${input.ruleContext}\n` : ''

  return `You are a bounded Claude CLI worker reporting back to Pi Dashboard.

Active Project Workspace: ${workspace}
CRITICAL WORKSPACE CONFINEMENT:
- All inspected, created, or modified files MUST be located strictly inside the active project workspace root ("${workspace}").
- Do NOT write to ~/.claude, temporary paths, or directories outside the workspace.
- Write code, documentation, and edits directly inside the project directory.

Mode: ${input.mode}
${role}${rules}

Task:
${input.prompt}

Return a concise, structured summary of your findings and actions inside "${workspace}".`
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.PI_DASHBOARD_AUTH_TOKEN
  delete environment.OPENROUTER_API_KEY
  delete environment.PI_DASHBOARD_WORKER_INTERNAL_TOKEN
  return environment
}

export interface ClaudeWorkerOptions {
  workspace: string
  git: GitService
  enabled: boolean
  claudeHome?: string
}

export class ClaudeWorkerAdapter implements WorkerAdapter {
  private active?: { taskId: string; child: ChildProcess }

  constructor(private readonly options: ClaudeWorkerOptions) {}

  get provider(): WorkerProviderStatus {
    const claudeHome = this.options.claudeHome ?? join(homedir(), '.claude')
    const authenticated = existsSync(join(claudeHome, 'auth.json')) || existsSync(join(claudeHome, 'session.json'))
    const ready = this.options.enabled && authenticated

    return {
      id: 'claude-cli',
      name: 'Claude CLI',
      description: 'Anthropic Claude running headlessly in the project workspace.',
      kind: 'external',
      status: ready ? 'ready' : this.options.enabled ? 'unavailable' : 'disabled',
      statusLabel: ready ? 'Installed and ready' : this.options.enabled ? 'Installed; select Connect to sign in' : 'Disabled by configuration',
      modes: ['research', 'review', 'implement'] as WorkerMode[],
      enabled: this.options.enabled,
      loginCommand: 'exec claude login',
      manageCommand: 'exec claude',
    }
  }

  async run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput> {
    if (this.active) throw new Error('Claude CLI is already running another task')
    const before = (await this.options.git.status()).entries
    const command = resolveExecutable('claude')
    const args = [
      '-p', claudePrompt(input, this.options.workspace),
      '--output-format', 'text',
    ]

    const child = spawn(command, args, {
      cwd: this.options.workspace,
      env: cleanEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...processGroupOptions(),
    })

    this.active = { taskId: input.taskId, child }
    await hooks.onProgress(`Claude is working on ${input.mode} task.`, 1)
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
      if (exitCode !== 0 && !output) throw new Error(`Claude CLI exited with code ${exitCode ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
      const bounded = boundedText(output || stderr.trim() || 'Claude finished without a text result.', input.bounds.resultLimitBytes)
      const after = (await this.options.git.status()).entries
      const files = changedFiles(before, after)

      return {
        result: bounded.text,
        resultTruncated: bounded.truncated,
        changedFiles: files,
        resultEnvelope: {
          summary: bounded.text.slice(0, 300),
          actionsTaken: files.length ? [`Modified ${files.length} file(s)`] : ['Completed review'],
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
