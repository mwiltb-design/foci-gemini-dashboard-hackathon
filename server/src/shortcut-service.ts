import { exec } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

function findProjectRoot(startDir: string): string {
  let current = resolve(startDir)
  for (let i = 0; i < 5; i++) {
    if (existsSync(resolve(current, 'scripts/dev.ps1')) && existsSync(resolve(current, 'package.json'))) {
      return current
    }
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return process.cwd()
}

export class ShortcutService {
  static createDesktopShortcut(): Promise<{ success: boolean; path: string; message: string }> {
    return new Promise((resolvePromise) => {
      if (process.platform !== 'win32') {
        resolvePromise({
          success: false,
          path: '',
          message: 'Desktop shortcut creation is currently supported on Windows.',
        })
        return
      }

      const desktopDir = resolve(homedir(), 'Desktop')
      const shortcutPath = resolve(desktopDir, 'Pi Dashboard.lnk')
      const repoRoot = findProjectRoot(import.meta.dirname ?? process.cwd())
      const devScript = resolve(repoRoot, 'scripts/dev.ps1')

      if (!existsSync(devScript)) {
        resolvePromise({
          success: false,
          path: shortcutPath,
          message: `Launch script not found at ${devScript}`,
        })
        return
      }

      const script = [
        `$WshShell = New-Object -ComObject WScript.Shell`,
        `$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
        `$Shortcut.TargetPath = 'powershell.exe'`,
        `$Shortcut.Arguments = '-WindowStyle Hidden -ExecutionPolicy Bypass -File "${devScript.replace(/"/g, '`"')}"'`,
        `$Shortcut.WorkingDirectory = '${repoRoot.replace(/'/g, "''")}'`,
        `$Shortcut.WindowStyle = 7`,
        `$Shortcut.Description = 'Pi Dashboard - AI Desktop Workbench'`,
        `$Shortcut.Save()`,
      ].join('\r\n')

      const encodedCommand = Buffer.from(script, 'utf16le').toString('base64')

      exec(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`, (error) => {
        if (error) {
          resolvePromise({
            success: false,
            path: shortcutPath,
            message: `Failed to create desktop shortcut: ${error.message}`,
          })
        } else {
          resolvePromise({
            success: true,
            path: shortcutPath,
            message: `Shortcut successfully created at ${shortcutPath}`,
          })
        }
      })
    })
  }
}
