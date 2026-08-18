import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'

const execute = promisify(execFile)
const MAX_GIT_OUTPUT = 2 * 1024 * 1024

export type GitFileState = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflicted' | 'staged'

export interface GitStatusEntry {
  path: string
  index: string
  workingTree: string
  state: GitFileState
}

export interface GitStatus {
  available: boolean
  branch?: string
  commit?: string
  clean: boolean
  entries: GitStatusEntry[]
  counts: Record<GitFileState, number>
}

function stateFor(index: string, workingTree: string): GitFileState {
  const pair = `${index}${workingTree}`
  if (pair === '??') return 'untracked'
  if (pair.includes('U') || pair === 'AA' || pair === 'DD') return 'conflicted'
  if (pair.includes('R')) return 'renamed'
  if (pair.includes('D')) return 'deleted'
  if (pair.includes('A')) return 'added'
  if (workingTree === 'M') return 'modified'
  if (index !== ' ' && index !== '?') return 'staged'
  return 'modified'
}

export class GitService {
  constructor(private readonly root: string) {}

  async status(): Promise<GitStatus> {
    try {
      const topLevel = (await this.run(['rev-parse', '--show-toplevel'])).trim()
      if (resolve(topLevel) !== resolve(this.root)) return this.empty(false)
    } catch {
      return this.empty(false)
    }

    const [branch, commit, porcelain] = await Promise.all([
      this.run(['branch', '--show-current']).then((value) => value.trim()),
      this.run(['rev-parse', '--short', 'HEAD']).then((value) => value.trim()).catch(() => ''),
      this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ])
    const records = porcelain.split('\0')
    const entries: GitStatusEntry[] = []
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]
      if (!record || record.length < 4) continue
      const indexState = record[0]
      const workingTree = record[1]
      const path = record.slice(3)
      entries.push({ path, index: indexState, workingTree, state: stateFor(indexState, workingTree) })
      if (indexState === 'R' || indexState === 'C') index += 1
    }
    const counts = this.counts()
    for (const entry of entries) counts[entry.state] += 1
    return { available: true, branch: branch || 'HEAD', commit, clean: entries.length === 0, entries, counts }
  }

  async diff(path: string): Promise<{ path: string; diff: string; truncated: boolean }> {
    const status = await this.status()
    if (!status.available) throw new Error('Git is not available for this project')
    const matching = status.entries.find((entry) => entry.path === path)
    const chunks = await Promise.all([
      this.run(['diff', '--no-ext-diff', '--unified=3', '--', path]),
      this.run(['diff', '--cached', '--no-ext-diff', '--unified=3', '--', path]),
    ])
    let diff = chunks.filter(Boolean).join('\n')
    if (!diff && matching?.state === 'untracked') {
      const absolute = resolve(this.root, path)
      diff = await this.runAllowDifference(['diff', '--no-index', '--unified=3', '--', '/dev/null', absolute])
      diff = diff.replaceAll(absolute, `b/${path}`)
    }
    const truncated = Buffer.byteLength(diff) > MAX_GIT_OUTPUT
    if (truncated) diff = Buffer.from(diff).subarray(0, MAX_GIT_OUTPUT).toString('utf8')
    return { path, diff, truncated }
  }

  statusFor(path: string, type: 'file' | 'directory', entries: GitStatusEntry[]): GitFileState | undefined {
    const matches = type === 'file'
      ? entries.filter((entry) => entry.path === path)
      : entries.filter((entry) => entry.path.startsWith(`${path}/`))
    const priority: GitFileState[] = ['conflicted', 'modified', 'deleted', 'added', 'renamed', 'untracked', 'staged']
    return priority.find((state) => matches.some((entry) => entry.state === state))
  }

  private async run(args: string[]): Promise<string> {
    const result = await execute('git', args, { cwd: this.root, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT + 1024, timeout: 15_000 })
    return result.stdout
  }

  private async runAllowDifference(args: string[]): Promise<string> {
    try {
      return await this.run(args)
    } catch (error) {
      const candidate = error as Error & { code?: number; stdout?: string }
      if (candidate.code === 1 && typeof candidate.stdout === 'string') return candidate.stdout
      throw error
    }
  }

  private counts(): Record<GitFileState, number> {
    return { modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0, conflicted: 0, staged: 0 }
  }

  private empty(available: boolean): GitStatus {
    return { available, clean: true, entries: [], counts: this.counts() }
  }
}
