import { useCallback, useEffect, useState } from 'react'

export interface RemoteAccessState {
  enabled: boolean
  tailnetHost: string
  httpsPort: number
  tokenConfigured: boolean
  allowedOrigin: string
  serveCommand: string
  statusMessage: string
}

export function useRemoteAccess(backendUrl = '') {
  const [state, setState] = useState<RemoteAccessState>({
    enabled: false,
    tailnetHost: '',
    httpsPort: 8443,
    tokenConfigured: false,
    allowedOrigin: '',
    serveCommand: '',
    statusMessage: 'Loading remote access configuration...',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const fetchState = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${backendUrl}/api/system/remote-access`)
      if (res.ok) {
        const data = await res.json()
        setState(data)
      }
    } catch {} finally {
      setLoading(false)
    }
  }, [backendUrl])

  useEffect(() => {
    void fetchState()
  }, [fetchState])

  const updateRemote = useCallback(async (input: {
    enabled?: boolean
    tailnetHost?: string
    httpsPort?: number
    password?: string
  }) => {
    try {
      setSaving(true)
      setMessage(null)
      const res = await fetch(`${backendUrl}/api/system/remote-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (res.ok) {
        const updated = await res.json()
        setState(updated)
        setMessage('Remote access settings saved successfully!')
        return { success: true, state: updated }
      }
      return { success: false, error: 'Failed to update remote settings' }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Network error' }
    } finally {
      setSaving(false)
    }
  }, [backendUrl])

  const generatePassword = useCallback(() => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*'
    const array = new Uint8Array(20)
    crypto.getRandomValues(array)
    let result = ''
    for (let i = 0; i < array.length; i++) {
      result += chars[array[i] % chars.length]
    }
    return result
  }, [])

  return {
    state,
    loading,
    saving,
    message,
    fetchState,
    updateRemote,
    generatePassword,
  }
}
