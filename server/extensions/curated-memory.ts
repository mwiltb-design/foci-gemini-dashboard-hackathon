import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { normalizeCuratedMemorySettings } from '../src/curated-memory.js'

const agentDir = process.env.PI_AGENT_DIR ?? process.env.FOCI_AGENT_DIR ?? resolve(homedir(), '.pi/agent')
const workspace = process.env.PI_DASHBOARD_WORKSPACE ?? process.cwd()
const settingsPath = process.env.PI_DASHBOARD_CURATED_MEMORY_SETTINGS_PATH ?? resolve(agentDir, 'dashboard/curated-memory/settings.json')
const userPath = process.env.PI_DASHBOARD_USER_PROFILE_PATH ?? resolve(agentDir, 'USER.md')
const globalPath = process.env.PI_DASHBOARD_GLOBAL_MEMORY_PATH ?? resolve(agentDir, 'MEMORY.md')
const projectPath = process.env.PI_DASHBOARD_PROJECT_MEMORY_PATH ?? resolve(workspace, 'MEMORY.md')
const skillPath = process.env.PI_DASHBOARD_CURATED_MEMORY_SKILL_PATH ?? resolve(process.cwd(), 'skills/curated-memory')
const MAX_FILE_CHARACTERS = 16_000

function jsonFile(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { return undefined }
}

function settings() {
  return normalizeCuratedMemorySettings(jsonFile(settingsPath))
}

function memoryFile(path: string): string | undefined {
  try {
    const content = readFileSync(path, 'utf8')
    if (!content.trim()) return undefined
    if (content.length <= MAX_FILE_CHARACTERS) return content
    return `${content.slice(0, MAX_FILE_CHARACTERS)}\n\n[Curated memory truncated at ${MAX_FILE_CHARACTERS} characters.]`
  } catch {
    return undefined
  }
}

function block(label: string, path: string, content: string): string {
  return `## ${label}\n\nSource: ${path}\n\n${content}`
}

export default function (pi: ExtensionAPI) {
  pi.on('resources_discover', () => settings().skillEnabled ? { skillPaths: [skillPath] } : undefined)

  pi.on('before_agent_start', (event) => {
    const current = settings()
    const sections: string[] = []
    if (current.globalEnabled) {
      const user = memoryFile(userPath)
      const global = memoryFile(globalPath)
      if (user) sections.push(block('Approved user profile', userPath, user))
      if (global) sections.push(block('Durable global memory', globalPath, global))
    }
    if (current.projectEnabled) {
      const project = memoryFile(projectPath)
      if (project) sections.push(block('Project memory', projectPath, project))
    }
    return {
      systemPrompt: `${event.systemPrompt}\n\n# 🧠 3-Tier Memory Operating Protocol\n\n1. **USER.md (User Profile)**: Contains facts about the user's identity, role, and background. You MAY propose updates when learning new personal facts, but you MUST ask the user's explicit permission before modifying USER.md.\n2. **Global MEMORY.md (Collaboration Manual)**: Contains cross-project communication preferences, interaction habits, and universal rules (e.g., "Answer questions first and stop before coding", "Explain commands step-by-step for Windows PowerShell"). Maintained collaboratively and refined during checkpoints.\n3. **Project MEMORY.md (Technical Blueprint)**: Contains the active project's technical architecture, folder structure, and decisions. Ingested every session; actively prune outdated notes and record current technical state during checkpoints.\n\n${sections.join('\n\n')}`,
    }
  })
}
