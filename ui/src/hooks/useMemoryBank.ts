import { useCallback, useState } from 'react'
import { apiFetch } from '../api'

export type MemoryTierType = 'user' | 'global' | 'project'

export interface MemoryTierData {
  type: MemoryTierType
  path: string
  content: string
  exists: boolean
  title: string
  badge: string
  description: string
  rule: string
}

const STARTER_TEMPLATES: Record<MemoryTierType, string> = {
  user: `# User Profile (USER.md)

<!--
Facts about the user. The AI MUST ask permission before modifying this file.
-->

## Personal Context & Background
- **Name:** 
- **Location:** 
- **Role / Background:** 

## User-Defined Skills & Strengths
- 

## Interests & Long-Term Goals
- 
`,
  global: `# Global Collaboration Memory (MEMORY.md)

<!--
Cross-project communication preferences, interaction habits, and universal rules.
Maintained collaboratively and refined during session checkpoints.
-->

## Communication Preferences
- When a question is asked, ALWAYS answer it first and stop. Never jump into coding before answering.
- Explain commands and walk through steps; use a friendly and clear tone.
- Target Windows PowerShell for terminal commands.
- Prefer Python for automation scripts and Markdown for documentation.

## Universal Development Conventions
- Isolate Python dependencies using virtual environments (\`.venv\`).
- Document script inputs, outputs, and requirements at the top of files.
- Keep terminal commands safe and explain destructive actions before running.
`,
  project: `# Project Technical Memory (MEMORY.md)

<!--
Living technical blueprint for this workspace. Ingested at the start of every session.
Heavily curated, updated, and pruned by the AI during checkpoints.
-->

## Architecture & Tech Stack
- **Framework / Language:** 
- **Directory Layout:** 

## Key Technical Decisions
- 

## Active Technical State & Milestones
- 
`
}

export function useMemoryBank() {
  const [activeTier, setActiveTier] = useState<MemoryTierType | null>(null)
  const [memoryData, setMemoryData] = useState<MemoryTierData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const loadTier = useCallback(async (type: MemoryTierType) => {
    try {
      setLoading(true)
      setActiveTier(type)
      const res = await apiFetch(`/api/memory/tier?type=${type}`)
      if (res.ok) {
        const data = await res.json() as MemoryTierData
        const finalContent = data.content && data.content.trim() ? data.content : STARTER_TEMPLATES[type]
        const finalData = { ...data, content: finalContent }
        setMemoryData(finalData)
        return finalData
      }
    } catch (err) {
      console.error('Failed to load memory tier:', err)
    } finally {
      setLoading(false)
    }
    return null
  }, [])

  const saveTier = useCallback(async (type: MemoryTierType, content: string) => {
    try {
      setSaving(true)
      setSaveSuccess(false)
      const res = await apiFetch('/api/memory/tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content }),
      })
      if (res.ok) {
        setSaveSuccess(true)
        setMemoryData((prev) => prev ? { ...prev, content } : null)
        setTimeout(() => setSaveSuccess(false), 2500)
        return true
      }
    } catch (err) {
      console.error('Failed to save memory tier:', err)
    } finally {
      setSaving(false)
    }
    return false
  }, [])

  const clearActiveTier = useCallback(() => {
    setActiveTier(null)
    setMemoryData(null)
  }, [])

  return {
    activeTier,
    memoryData,
    loading,
    saving,
    saveSuccess,
    loadTier,
    saveTier,
    clearActiveTier,
  }
}
