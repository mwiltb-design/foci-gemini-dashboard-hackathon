import { execSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function processGroupOptions(): { detached?: boolean } {
  return process.platform === 'win32' ? {} : { detached: true }
}

export function terminateProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null) return
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  child.kill(signal)
}

export function findExecutable(name: string): string | null {
  if (process.platform === 'win32') {
    const home = homedir()
    const candidates = [
      join(home, 'AppData', 'Local', name, 'bin', `${name}.exe`),
      join(home, 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin', `${name}.exe`),
      join(home, 'AppData', 'Local', 'Programs', name, 'bin', `${name}.exe`),
      join(home, 'AppData', 'Roaming', 'npm', `${name}.cmd`),
      join(home, 'AppData', 'Roaming', 'npm', `${name}.exe`),
      join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links', `${name}.exe`),
    ]
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate
    }
    try {
      const found = execSync(`where.exe ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split(/\r?\n/)[0]?.trim()
      if (found && existsSync(found)) return found
    } catch {}
    return null
  } else {
    try {
      const found = execSync(`which ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split(/\r?\n/)[0]?.trim()
      if (found && existsSync(found)) return found
    } catch {}
    return null
  }
}

export function resolveExecutable(name: string): string {
  return findExecutable(name) ?? name
}
