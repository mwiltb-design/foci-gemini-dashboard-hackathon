import type { ChildProcess } from 'node:child_process'

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
