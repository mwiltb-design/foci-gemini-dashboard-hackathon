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

- **Name:** 
- **Location:** 
- **Role / Background:** 
- **User-Defined Skills:** 
- **Interests & Goals:** 
`,
  global: `# Global Collaboration Memory (MEMORY.md)

## Communication Preferences
- When a question is asked, ALWAYS answer it first and stop.
- Explain commands and walk through steps for Windows PowerShell.
- Prefer Python for scripts and Markdown for documentation.
`,
  project: `# Project Technical Memory (MEMORY.md)

## Architecture & Tech Stack
- Framework / Language: 
- Directory Layout: 

## Key Technical Decisions
- 

## Active Technical State
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
