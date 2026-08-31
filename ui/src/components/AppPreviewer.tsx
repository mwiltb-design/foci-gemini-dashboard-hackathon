import { useEffect, useState, useRef } from 'react'
import { apiFetch } from '../api'
import { Panel } from './Panel'

type DeviceViewport = 'desktop' | 'tablet' | 'mobile'

interface QuickPreset {
  label: string
  url: string
}

const DEV_SERVER_PRESETS: QuickPreset[] = [
  { label: 'Vite (:5173)', url: 'http://localhost:5173' },
  { label: 'Next/React (:3000)', url: 'http://localhost:3000' },
  { label: 'Local (:8080)', url: 'http://localhost:8080' },
  { label: 'Server (:4000)', url: 'http://localhost:4000' },
]

export function AppPreviewer() {
  const [urlInput, setUrlInput] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [viewport, setViewport] = useState<DeviceViewport>('desktop')
  const [key, setKey] = useState(0)
  const [htmlFiles, setHtmlFiles] = useState<string[]>([])
  const [selectedHtmlFile, setSelectedHtmlFile] = useState<string>('')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    loadHtmlFiles()
  }, [])

  async function loadHtmlFiles() {
    try {
      const res = await apiFetch('/api/preview/html-files')
      if (res.ok) {
        const data = await res.json() as { files: string[] }
        const list = Array.isArray(data.files) ? data.files : []
        setHtmlFiles(list)
        if (list.length > 0 && !currentUrl) {
          const first = list[0]
          setSelectedHtmlFile(first)
          const target = `/api/preview/workspace/${first}`
          setUrlInput(target)
          setCurrentUrl(target)
        }
      }
    } catch {
      // Fallback
    }
  }

  function resolveTargetUrl(input: string): string {
    const trimmed = input.trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (trimmed.startsWith('/api/preview/workspace/')) return trimmed
    if (trimmed.startsWith('/')) return trimmed
    return `/api/preview/workspace/${trimmed}`
  }

  function handleNavigate(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const target = resolveTargetUrl(urlInput)
    if (!target) return
    setUrlInput(target)
    setCurrentUrl(target)
    setKey((k) => k + 1)
  }

  function handleSelectHtmlFile(path: string) {
    setSelectedHtmlFile(path)
    if (!path) return
    const target = `/api/preview/workspace/${path}`
    setUrlInput(target)
    setCurrentUrl(target)
    setKey((k) => k + 1)
  }

  function handlePreset(presetUrl: string) {
    setSelectedHtmlFile('')
    setUrlInput(presetUrl)
    setCurrentUrl(presetUrl)
    setKey((k) => k + 1)
  }

  function handleReload() {
    loadHtmlFiles()
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
            placeholder="http://localhost:5173 or my-folder/index.html"
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

        <div className="previewer-presets" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {htmlFiles.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600 }}>📁 HTML File:</span>
              <select
                value={selectedHtmlFile}
                onChange={(e) => handleSelectHtmlFile(e.target.value)}
                style={{ fontSize: '11px', padding: '3px 8px', background: '#0b0f14', border: '1px solid var(--line)', color: '#fff', borderRadius: '4px' }}
              >
                <option value="">Select HTML file...</option>
                {htmlFiles.map((file) => (
                  <option value={file} key={file}>
                    {file}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Dev Servers:</span>
            {DEV_SERVER_PRESETS.map((preset) => (
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
      </div>

      <div className={`previewer-canvas-container previewer-canvas-container--${viewport}`}>
        <div className={`previewer-device-frame previewer-device-frame--${viewport}`}>
          {viewport !== 'desktop' && (
            <div className="previewer-device-header">
              <span className="previewer-device-camera" />
            </div>
          )}
          {currentUrl ? (
            <iframe
              key={key}
              ref={iframeRef}
              src={currentUrl}
              title="Web App Preview"
              className="previewer-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)' }}>
              <h3>No Preview Selected</h3>
              <p>Select a workspace HTML file from the dropdown above or enter a local dev server URL (e.g. <code>http://localhost:5173</code>).</p>
            </div>
          )}
        </div>
      </div>

      <div className="previewer-guide-footer">
        <p>
          💡 <strong>Viewing Local HTML Files:</strong> Select any <code>.html</code> file in your project workspace from the dropdown above, or type its path (e.g. <code>my-folder/index.html</code>) and click <strong>Go</strong>.
        </p>
      </div>
    </Panel>
  )
}
