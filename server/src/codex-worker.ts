import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { GitService, GitStatusEntry } from './git-service.js'
import { findExecutable, processGroupOptions, resolveExecutable, terminateProcess } from './process-control.js'
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

function codexPrompt(input: WorkerRunInput, workspace: string): string {
  const role = input.mode === 'implement'
    ? 'You have permission to inspect and edit files inside the current workspace. Implement the requested changes and verify correctness.'
    : input.mode === 'review'
      ? 'Review the project read-only. Identify risks, defects, and concrete recommendations.'
      : 'Research the project read-only and report concise, evidence-based findings.'

  const rules = input.ruleContext ? `\n\nGuidelines:\n${input.ruleContext}\n` : ''

  return `You are a bounded Codex CLI worker reporting back to Pi Dashboard.

Active Project Workspace: ${workspace}
CRITICAL WORKSPACE CONFINEMENT:
- All inspected, created, or modified files MUST be located strictly inside the active project workspace root ("${workspace}").
- Do NOT write to ~/.codex, scratch directories, or temporary paths outside the workspace.
- Write code and markdown files directly into the project directory.

Mode: ${input.mode}
${role}${rules}

Task:
${input.prompt}

Return a concise, structured summary of your findings and actions inside "${workspace}".`
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/token|secret|password|key/i.test(key) && !/api_key/i.test(key)) {
      delete env[key]
    }
  }
  return env
}

export interface CodexWorkerOptions {
  workspace: string
  git: GitService
  enabled: boolean
  codexHome?: string
}

export class CodexWorkerAdapter implements WorkerAdapter {
  private active?: { taskId: string; child: ChildProcess }

  constructor(private readonly options: CodexWorkerOptions) {}

  get provider(): WorkerProviderStatus {
    const hasExecutable = Boolean(findExecutable('codex'))
    const codexHome = this.options.codexHome ?? join(homedir(), '.codex')
    const authenticated = existsSync(join(codexHome, 'auth.json')) || existsSync(codexHome)
    const ready = this.options.enabled && hasExecutable && authenticated

    return {
      id: 'codex-cli',
      name: 'Codex CLI',
      description: 'OpenAI Codex running non-interactively in the project workspace.',
      kind: 'external',
      status: ready ? 'ready' : this.options.enabled ? 'unavailable' : 'disabled',
      statusLabel: !this.options.enabled
        ? 'Disabled by configuration'
        : !hasExecutable
          ? 'Desktop CLI not detected on server'
          : ready
            ? 'Installed and signed in'
            : 'Installed; select Connect to sign in',
      modes: ['research', 'review', 'implement'] as WorkerMode[],
      enabled: this.options.enabled,
      loginCommand: 'exec codex login --device-auth',
      manageCommand: 'exec codex',
    }
  }

  async run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput> {
    if (this.active) throw new Error('Codex CLI is already running another task')
    const before = (await this.options.git.status()).entries
    const command = resolveExecutable('codex')
    const args = [
      'exec',
      '-C', this.options.workspace,
      '--add-dir', this.options.workspace,
      '--json', '--ephemeral', '--skip-git-repo-check',
      '--sandbox', input.mode === 'implement' ? 'workspace-write' : 'read-only',
      codexPrompt(input, this.options.workspace),
    ]

    const child = spawn(command, args, {
      cwd: this.options.workspace,
      env: cleanEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...processGroupOptions(),
    })

    this.active = { taskId: input.taskId, child }
    let turns = 0
    let result = ''
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-16_384) })
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      let event: Record<string, unknown>
      try { event = JSON.parse(line) as Record<string, unknown> } catch { return }
      if (event.type === 'turn.started') {
        turns += 1
        void hooks.onProgress(`Codex is working (turn ${turns}).`, turns)
      }
      if (event.type === 'item.started') {
        const item = event.item as Record<string, unknown> | undefined
        const kind = typeof item?.type === 'string' ? item.type.replaceAll('_', ' ') : 'task'
        void hooks.onProgress(`Codex is running ${kind}.`, turns)
      }
      if (event.type === 'item.completed') {
        const item = event.item as Record<string, unknown> | undefined
        if (item?.type === 'agent_message' && typeof item.text === 'string') result = item.text
      }
      if (event.type === 'error' && typeof event.message === 'string') stderr = `${stderr}\n${event.message}`.trim()
    })

    try {
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      if (exitCode !== 0 && !result) throw new Error(`Codex CLI exited with code ${exitCode ?? 'unknown'}${stderr.trim() ? `: ${stderr.trim()}` : ''}`)
      const bounded = boundedText(result || 'Codex finished without a text result.', input.bounds.resultLimitBytes)
      const after = (await this.options.git.status()).entries
      const files = changedFiles(before, after)

      return {
        result: bounded.text,
        resultTruncated: bounded.truncated,
        changedFiles: files,
        resultEnvelope: {
          summary: bounded.text.slice(0, 300),
          actionsTaken: files.length ? [`Modified ${files.length} file(s)`] : ['Completed code analysis'],
          changedFiles: files,
          warnings: stderr.trim() ? [stderr.trim().slice(0, 200)] : [],
        },
      }
    } finally {
      lines.close()
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
