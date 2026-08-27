import { useState } from 'react'
import { useRemoteAccess } from '../hooks/useRemoteAccess'

export function RemoteAccessCard() {
  const { state, saving, message, updateRemote, generatePassword } = useRemoteAccess()
  const [enabled, setEnabled] = useState(state.enabled)
  const [tailnetHost, setTailnetHost] = useState(state.tailnetHost)
  const [httpsPort, setHttpsPort] = useState(state.httpsPort || 8443)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)

  // Sync state when loaded
  const [synced, setSynced] = useState(false)
  if (!synced && (state.tailnetHost || state.enabled)) {
    setEnabled(state.enabled)
    setTailnetHost(state.tailnetHost)
    setHttpsPort(state.httpsPort || 8443)
    setSynced(true)
  }

  const handleSave = async () => {
    await updateRemote({
      enabled,
      tailnetHost,
      httpsPort: Number(httpsPort),
      password: password ? password : undefined,
    })
    setPassword('')
  }

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const handleGeneratePassword = () => {
    const generated = generatePassword()
    setPassword(generated)
    setShowPassword(true)
  }

  const isProtected = state.enabled && state.tokenConfigured
  const hasWarning = state.enabled && !state.tokenConfigured

  return (
    <section className="system-section" style={{ border: isProtected ? '1px solid var(--accent)' : undefined }}>
      <header>
        <div>
          <span className="eyebrow">Remote Connectivity</span>
          <h2>Tailscale Serve & Private Remote Access</h2>
        </div>
        <span
          style={{
            fontSize: '11px',
            padding: '3px 8px',
            borderRadius: '4px',
            background: isProtected ? 'rgba(76, 175, 80, 0.2)' : hasWarning ? 'rgba(255, 152, 0, 0.2)' : 'var(--panel-2)',
            color: isProtected ? '#4caf50' : hasWarning ? '#ff9800' : 'var(--text-muted)',
            fontWeight: 600,
          }}
        >
          {isProtected ? '🔒 Protected (Active)' : hasWarning ? '⚠️ Password Required' : '🏠 Local Only'}
        </span>
      </header>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
          Securely access your Foci Dashboard from your phone or laptop over your private Tailnet without exposing ports to the public internet.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            Enable Tailscale Serve Remote Access
          </label>
        </div>

        {enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--panel-2)', padding: '12px', borderRadius: '6px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Tailnet Hostname</label>
                <input
                  type="text"
                  placeholder="e.g. my-laptop.tailnet.ts.net"
                  value={tailnetHost}
                  onChange={(e) => setTailnetHost(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>HTTPS Port</label>
                <input
                  type="number"
                  value={httpsPort}
                  onChange={(e) => setHttpsPort(Number(e.target.value))}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>
                  Remote Access Password {state.tokenConfigured && <span style={{ color: '#4caf50', fontWeight: 'normal' }}>(✓ Configured)</span>}
                </label>
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={handleGeneratePassword}
                  style={{ fontSize: '11px', padding: '2px 6px' }}
                >
                  🎲 Generate Random
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={state.tokenConfigured ? 'Enter new password to change...' : 'Set your remote access password...'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                />
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ padding: '0 10px', fontSize: '12px' }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
                Required when accessing over Tailscale. Never shared with agents or terminal sessions.
              </small>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
              <button
                type="button"
                className="button button--primary"
                onClick={handleSave}
                disabled={saving}
                style={{ padding: '6px 16px', fontSize: '12px' }}
              >
                {saving ? 'Saving...' : '💾 Save & Protect'}
              </button>
              {message && <span style={{ fontSize: '12px', color: '#4caf50' }}>{message}</span>}
            </div>

            {state.tailnetHost && (
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                  Tailscale Serve Command (Run in terminal on this PC):
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <code style={{ flex: 1, padding: '6px 8px', background: 'var(--bg)', borderRadius: '4px', fontSize: '11px', overflowX: 'auto' }}>
                    {state.serveCommand}
                  </code>
                  <button
                    type="button"
                    className="button"
                    onClick={() => handleCopy(state.serveCommand)}
                    style={{ fontSize: '11px', padding: '6px 10px' }}
                  >
                    {copied ? '✓ Copied!' : '📋 Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!enabled && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="button button--primary"
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '6px 16px', fontSize: '12px' }}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
