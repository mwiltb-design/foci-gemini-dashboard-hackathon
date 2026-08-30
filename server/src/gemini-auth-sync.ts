import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function getPersistentGeminiDir(): string {
  return process.env.PI_DASHBOARD_ANTIGRAVITY_HOME || process.env.ANTIGRAVITY_HOME || '/data/gemini'
}

export function getLocalGeminiDir(): string {
  return resolve(homedir(), '.gemini')
}

export function syncGeminiAuth(direction: 'restore' | 'persist' = 'restore'): void {
  const persistentDir = getPersistentGeminiDir()
  const localDir = getLocalGeminiDir()

  try {
    mkdirSync(persistentDir, { recursive: true })
    mkdirSync(localDir, { recursive: true })
  } catch {}

  try {
    if (direction === 'restore') {
      if (existsSync(persistentDir)) {
        const entries = readdirSync(persistentDir)
        if (entries.length > 0) {
          cpSync(persistentDir, localDir, { recursive: true, force: true, errorOnExist: false })
        }
      }
    } else {
      if (existsSync(localDir)) {
        const entries = readdirSync(localDir)
        if (entries.length > 0) {
          cpSync(localDir, persistentDir, { recursive: true, force: true, errorOnExist: false })
        }
      }
    }
  } catch {}
}