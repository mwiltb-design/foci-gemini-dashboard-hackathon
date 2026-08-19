import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

export interface ProjectInfo {
  id: string
  name: string
  path: string
  hasMemory: boolean
  hasNotes: boolean
  lastModified?: string
  fileCount: number
}

export class ProjectService {
  readonly rootDir: string

  constructor(customRootDir?: string) {
    this.rootDir = resolve(customRootDir || process.env.PI_PROJECTS_ROOT || resolve(homedir(), 'Pi-Dashboards'))
    try { mkdirSync(this.rootDir, { recursive: true }) } catch {}
  }

  list(): ProjectInfo[] {
    try {
      if (!existsSync(this.rootDir)) return []
      const entries = readdirSync(this.rootDir, { withFileTypes: true })
      const projects: ProjectInfo[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        const fullPath = resolve(this.rootDir, entry.name)
        const memoryFile = resolve(fullPath, 'MEMORY.md')
        const notesFile = resolve(fullPath, 'Notes.md')
        let lastModified: string | undefined
        let fileCount = 0

        try {
          const stats = statSync(fullPath)
          lastModified = stats.mtime.toISOString()
          const items = readdirSync(fullPath)
          fileCount = items.filter((f) => !f.startsWith('.')).length
        } catch {}

        projects.push({
          id: createHash('sha256').update(fullPath.toLowerCase()).digest('hex').slice(0, 12),
          name: entry.name,
          path: fullPath,
          hasMemory: existsSync(memoryFile),
          hasNotes: existsSync(notesFile),
          lastModified,
          fileCount,
        })
      }

      return projects.sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''))
    } catch {
      return []
    }
  }

  create(name: string, templateType = 'standard'): ProjectInfo {
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_\-\s]/g, '').replace(/\s+/g, '-')
    if (!cleanName) throw new Error('Invalid project name. Use letters, numbers, and hyphens.')

    const projectPath = resolve(this.rootDir, cleanName)
    if (existsSync(projectPath)) {
      throw new Error(`Project "${cleanName}" already exists in ${this.rootDir}`)
    }

    mkdirSync(projectPath, { recursive: true })

    // Starter MEMORY.md
    const memoryContent = `# Project Memory: ${cleanName}

## Overview
This file is the local memory bank for the **${cleanName}** project.

## Key Rules & Context
- Initialized on ${new Date().toLocaleDateString()}
- Project Path: \`${projectPath}\`
`
    writeFileSync(resolve(projectPath, 'MEMORY.md'), memoryContent, 'utf8')

    // Starter Notes.md
    const notesContent = `# Project Notes: ${cleanName}

Welcome to your new project dashboard!
Use this shared notes document to collaborate with Pi.
`
    writeFileSync(resolve(projectPath, 'Notes.md'), notesContent, 'utf8')

    return {
      id: createHash('sha256').update(projectPath.toLowerCase()).digest('hex').slice(0, 12),
      name: cleanName,
      path: projectPath,
      hasMemory: true,
      hasNotes: true,
      lastModified: new Date().toISOString(),
      fileCount: 2,
    }
  }
}
