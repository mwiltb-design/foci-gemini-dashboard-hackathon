import { useState, useRef } from 'react'
import { Panel } from './Panel'

type DeviceViewport = 'desktop' | 'tablet' | 'mobile'

interface QuickPreset {
  label: string
  url: string
}

const PRESETS: QuickPreset[] = [
  { label: 'Vite (:5173)', url: 'http://localhost:5173' },
  { label: 'Next/React (:3000)', url: 'http://localhost:3000' },
  { label: 'Local (:8080)', url: 'http://localhost:8080' },
  { label: 'Server (:4000)', url: 'http://localhost:4000' },
]

export function AppPreviewer() {
  const [urlInput, setUrlInput] = useState('http://localhost:5173')
  const [currentUrl, setCurrentUrl] = useState('http://localhost:5173')
  const [viewport, setViewport] = useState<DeviceViewport>('desktop')
  const [key, setKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function handleNavigate(e?: React.FormEvent) {
    if (e) e.preventDefault()
    let target = urlInput.trim()
    if (!target) return
    if (!/^https?:\/\//i.test(target) && !target.startsWith('/')) {
      target = `http://${target}`
    }
    setUrlInput(target)
    setCurrentUrl(target)
    setKey((k) => k + 1)
  }

  function handlePreset(presetUrl: string) {
    setUrlInput(presetUrl)
    setCurrentUrl(presetUrl)
    setKey((k) => k + 1)
  }

  function handleReload() {
    setKey((k) => k + 1)
  }

  function handleOpenExternal() {
    if (currentUrl) window.open(currentUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <Panel
      eyebrow="Developer preview"
      title="App & Web Previewer"
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="previewer-viewport-toggle" role="group" aria-label="Device viewport">
            <button
              type="button"
              className={`button button--quiet ${viewport === 'desktop' ? 'is-active' : ''}`}
              onClick={() => setViewport('desktop')}
              title="Desktop (Full Width)"
            >
              🖥 Desktop
            </button>
            <button
              type="button"
              className={`button button--quiet ${viewport === 'tablet' ? 'is-active' : ''}`}
              onClick={() => setViewport('tablet')}
              title="Tablet (768px)"
            >
              📱 Tablet
            </button>
            <button
              type="button"
              className={`button button--quiet ${viewport === 'mobile' ? 'is-active' : ''}`}
              onClick={() => setViewport('mobile')}
              title="Mobile (375px)"
            >
              📲 Mobile
            </button>
          </div>
        </div>
      }
      fullWidth
      className="previewer-panel"
    >
      <div className="previewer-toolbar">
        <form onSubmit={handleNavigate} className="previewer-address-form">
          <button
            type="button"
            className="button button--quiet previewer-btn-icon"
            onClick={handleReload}
            title="Reload Preview"
          >
            ↻
          </button>
          <input
            type="text"
            className="previewer-url-input"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="http://localhost:5173 or /index.html"
          />
          <button type="submit" className="button button--primary" style={{ padding: '6px 14px' }}>
            Go
          </button>
          <button
            type="button"
            className="button button--quiet previewer-btn-icon"
            onClick={handleOpenExternal}
            title="Open in new tab"
          >
            ↗
          </button>
        </form>

        <div className="previewer-presets">
          <span style={{ fontSize: '11px', color: 'var(--muted)', alignSelf: 'center' }}>Presets:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={`button button--quiet ${currentUrl === preset.url ? 'is-active' : ''}`}
              style={{ fontSize: '11px', padding: '3px 8px' }}
              onClick={() => handlePreset(preset.url)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`previewer-canvas-container previewer-canvas-container--${viewport}`}>
        <div className={`previewer-device-frame previewer-device-frame--${viewport}`}>
          {viewport !== 'desktop' && (
            <div className="previewer-device-header">
              <span className="previewer-device-camera" />
            </div>
          )}
          <iframe
            key={key}
            ref={iframeRef}
            src={currentUrl}
            title="Web App Preview"
            className="previewer-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        </div>
      </div>

      <div className="previewer-guide-footer">
        <p>
          💡 <strong>Tip:</strong> Start your local web app in the <strong>Terminal</strong> tab (e.g. <code>npm run dev</code> or <code>python -m http.server 8080</code>), then click the matching preset above to preview your changes live.
        </p>
      </div>
    </Panel>
  )
}
