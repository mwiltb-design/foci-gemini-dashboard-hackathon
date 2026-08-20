import { useCallback, useState } from 'react'

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

export function useMemoryBank(backendUrl = '') {
  const [activeTier, setActiveTier] = useState<MemoryTierType | null>(null)
  const [memoryData, setMemoryData] = useState<MemoryTierData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const loadTier = useCallback(async (type: MemoryTierType) => {
    try {
      setLoading(true)
      setActiveTier(type)
      const res = await fetch(`${backendUrl}/api/memory/tier?type=${type}`)
      if (res.ok) {
        const data = await res.json()
        setMemoryData(data)
        return data as MemoryTierData
      }
    } catch {} finally {
      setLoading(false)
    }
    return null
  }, [backendUrl])

  const saveTier = useCallback(async (type: MemoryTierType, content: string) => {
    try {
      setSaving(true)
      setSaveSuccess(false)
      const res = await fetch(`${backendUrl}/api/memory/tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content }),
      })
      if (res.ok) {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2500)
        return true
      }
    } catch {} finally {
      setSaving(false)
    }
    return false
  }, [backendUrl])

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
