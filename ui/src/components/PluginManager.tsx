import { useEffect, useState, type FormEvent } from 'react'
import type { PluginReview, PluginSummary } from '../types'
import { Panel } from './Panel'

interface PluginManagerProps {
  plugins: PluginSummary[]
  loading: boolean
  registryError: string
  workspaceSourceEnabled: boolean
  localPreviewEnabled: boolean
  preferredPluginId?: string
  onReview: (url: string) => Promise<PluginReview>
  onInstall: (review: PluginReview) => Promise<PluginSummary>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onSetAgentAccess: (id: string, access: { read: boolean; write: boolean }) => Promise<void>
  onRollback: (id: string) => Promise<PluginSummary>
  onRemove: (id: string, deleteData?: boolean) => Promise<void>
  onOpen: (id: string) => void
  onCreateWithPi: (prompt: string) => void
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function runtimeLabel(plugin: PluginSummary): string {
  if (!plugin.backend) return 'Interface only'
  if (plugin.runtimeStatus === 'healthy') return 'Service healthy'
  if (plugin.runtimeStatus === 'version-mismatch') return 'Service version mismatch'
  if (plugin.runtimeStatus === 'unavailable') return 'Service unavailable'
  return 'Service stopped'
}

export function PluginManager({
  plugins, loading, registryError, workspaceSourceEnabled: _workspaceSourceEnabled, localPreviewEnabled, preferredPluginId,
  onReview, onInstall, onSetEnabled, onSetAgentAccess, onRollback, onRemove, onOpen, onCreateWithPi,
}: PluginManagerProps) {
  const [url, setUrl] = useState(localPreviewEnabled ? 'local:repository-hello' : '')
  const [idea, setIdea] = useState('')
  const [reference, setReference] = useState('')
  const [selectedId, setSelectedId] = useState(preferredPluginId ?? '')
  const [adding, setAdding] = useState(false)
  const [review, setReview] = useState<PluginReview>()
  const [trusted, setTrusted] = useState(false)
  const [removeChoice, setRemoveChoice] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const selected = plugins.find((plugin) => plugin.id === selectedId)
  const enabledCount = plugins.filter((plugin) => plugin.enabled).length
  const piEnabledCount = plugins.filter((plugin) => plugin.enabled && (plugin.agentAccess.read || plugin.agentAccess.write)).length

  useEffect(() => {
    if (loading || adding || review) return
    if (!selectedId || !plugins.some((plugin) => plugin.id === selectedId)) setSelectedId(plugins[0]?.id ?? '')
  }, [adding, loading, plugins, review, selectedId])

  function clearMessages() {
    setError('')
    setNotice('')
  }

  function showPlugin(id: string) {
    setSelectedId(id)
    setAdding(false)
    setReview(undefined)
    setRemoveChoice(false)
    clearMessages()
  }

  function startAdding() {
    setAdding(true)
    setReview(undefined)
    setRemoveChoice(false)
    clearMessages()
  }

  function createWithPi() {
    const description = idea.trim()
    if (!description && !reference.trim()) return
    const source = reference.trim() ? ` Use this as a functional reference: ${reference.trim()}. Duplicate the useful behavior, but do not copy branding or copyrighted assets.` : ''
    onCreateWithPi(`Use the dashboard-plugin-authoring skill. I want a Foci Dashboard plugin that: ${description || 'reproduces the referenced plugin functionality'}.${source} Classify it as a trusted static install, a new static plugin, or a bundled agent-connected plugin before changing files. Follow the skill's routed contract and tests. Do not commit the main Dashboard repository or push anything. When finished, tell me exactly how to review and activate it in the Plugins page.`)
  }

  async function reviewRepository(event: FormEvent) {
    event.preventDefault()
    setBusy('review')
    clearMessages()
    try {
      setReview(await onReview(url))
      setTrusted(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to review repository')
    } finally {
      setBusy('')
    }
  }

  async function install() {
    if (!review || !trusted) return
    setBusy('install')
    clearMessages()
    try {
      const operation = review.operation
      const plugin = await onInstall(review)
      setReview(undefined)
      setAdding(false)
      setSelectedId(plugin.id)
      setTrusted(false)
      setNotice(operation === 'upgrade'
        ? `${plugin.name} was upgraded to ${plugin.version}. The prior version is available for rollback.`
        : `${plugin.name} was installed and remains disabled until you enable it.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to install plugin')
    } finally {
      setBusy('')
    }
  }

  async function toggle(plugin: PluginSummary) {
    setBusy(plugin.id)
    clearMessages()
    try {
      const enabling = !plugin.enabled
      await onSetEnabled(plugin.id, enabling)
      if (enabling && (plugin.agentSkills.length || plugin.agentTools.length)) {
        setNotice(`${plugin.name} is enabled. Instruction-only skills are active; grant-dependent skills and Gemini tools still require the read or write approvals below.`)
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update plugin') }
    finally { setBusy('') }
  }

  async function toggleAgentAccess(plugin: PluginSummary, access: 'read' | 'write') {
    setBusy(`agent-${access}`)
    clearMessages()
    try {
      await onSetAgentAccess(plugin.id, { ...plugin.agentAccess, [access]: !plugin.agentAccess[access] })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update Gemini access')
    } finally {
      setBusy('')
    }
  }

  async function rollback(plugin: PluginSummary) {
    if (!window.confirm(`Roll back ${plugin.name} from version ${plugin.version}? The current version becomes the next rollback choice.`)) return
    setBusy(plugin.id)
    clearMessages()
    try {
      const restored = await onRollback(plugin.id)
      setNotice(`${plugin.name} now uses version ${restored.version}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to roll back plugin')
    } finally {
      setBusy('')
    }
  }

  async function remove(plugin: PluginSummary, deleteData: boolean) {
    setBusy(plugin.id)
    clearMessages()
    try {
      await onRemove(plugin.id, deleteData)
      setRemoveChoice(false)
      setNotice(`${plugin.name} was removed${deleteData ? ' and its data was deleted' : '; its data was retained'}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove plugin')
    } finally {
      setBusy('')
    }
  }

  const readTools = selected?.agentTools.filter((tool) => tool.access === 'read') ?? []
  const writeTools = selected?.agentTools.filter((tool) => tool.access === 'write') ?? []

  return <Panel eyebrow="Extensions" title="Plugin platform" fullWidth>
    <div className="panel__body plugin-manager-body">
      <div className="metrics">
        <div className="metric"><b>{String(plugins.length).padStart(2, '0')}</b><span>Installed</span></div>
        <div className="metric"><b>{String(enabledCount).padStart(2, '0')}</b><span>Enabled</span></div>
        <div className="metric"><b>{String(piEnabledCount).padStart(2, '0')}</b><span>Available to Gemini</span></div>
      </div>
      {(error || registryError) && <div className="connection-banner">{error || registryError}</div>}
      {notice && <div className="plugin-manager-notice">{notice}</div>}

      <div className="plugin-manager-grid">
        <aside className="plugin-library-pane">
          <div className="plugin-library-head">
            <div><span className="eyebrow">Your dashboard</span><h2>Plugins</h2></div>
            <button className="button button--primary" type="button" onClick={startAdding}>+ Add plugin</button>
          </div>
          <div className="installed-plugin-list">
            {plugins.map((plugin) => <button className={!adding && !review && selectedId === plugin.id ? 'is-selected' : ''} type="button" key={plugin.id} onClick={() => showPlugin(plugin.id)}>
              <span className={`plugin-installed-state ${plugin.enabled ? 'is-enabled' : ''}`}>{plugin.enabled ? '✓' : '—'}</span>
              <span>
                <strong>{plugin.name}</strong>
                <em>{plugin.description || 'No description'}</em>
                <small>{plugin.enabled ? 'Enabled' : 'Disabled'} · {plugin.agentSkills.length} skill{plugin.agentSkills.length === 1 ? '' : 's'} · {plugin.agentTools.length} Gemini tool{plugin.agentTools.length === 1 ? '' : 's'}</small>
              </span>
            </button>)}
            {!loading && plugins.length === 0 && <div className="plugin-library-empty"><strong>No plugins yet</strong><span>Ask Gemini to make one or install a trusted repository.</span></div>}
          </div>
        </aside>

        <section className="plugin-detail-pane">
          {review ? <div className="plugin-review plugin-detail-content">
            <header className="plugin-detail-head">
              <div><span className="eyebrow">Exact commit reviewed</span><h2>{review.plugin.name}</h2><p>{review.plugin.description || 'No description supplied.'}</p></div>
              <span className="plugin-detail-icon">{review.plugin.icon}</span>
            </header>
            <div className="plugin-review-summary">
              <div><span>Version</span><strong>{review.currentVersion ? `${review.currentVersion} → ${review.plugin.version}` : review.plugin.version}</strong></div>
              <div><span>Compatibility</span><strong>{review.plugin.dashboardVersion}</strong></div>
              <div><span>Package</span><strong>{review.files.length} files · {size(review.totalBytes)}</strong></div>
              <div><span>Permissions</span><strong className="text-accent">None</strong></div>
            </div>
            <div className="plugin-trust-box">
              <strong>Install the repository as-is</strong>
              <p>The Dashboard will use the prebuilt files from this exact commit. It will not run install or build scripts. Manifest, path, size, compatibility, and provenance checks still apply.</p>
              <label><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} /> I trust this exact commit and want to install its prebuilt files.</label>
            </div>
            <details className="plugin-technical">
              <summary>Review technical details</summary>
              <dl>
                <div><dt>Plugin ID</dt><dd><code>{review.plugin.id}</code></dd></div>
                <div><dt>Source</dt><dd>{review.repository}</dd></div>
                <div><dt>Commit</dt><dd><code>{review.commit}</code></dd></div>
                <div><dt>Digest</dt><dd><code>{review.digest}</code></dd></div>
              </dl>
              <section className="plugin-reviewed-files"><div>{review.files.map((file) => <p key={file.path}><code>{file.path}</code><span>{size(file.size)}</span></p>)}</div></section>
            </details>
            <div className="plugin-detail-actions">
              <button className="button button--quiet" type="button" disabled={busy !== ''} onClick={() => { setReview(undefined); setTrusted(false) }}>Cancel</button>
              <button className="button button--primary" type="button" disabled={busy !== '' || !trusted} onClick={() => void install()}>{busy === 'install' ? 'Installing…' : review.operation === 'upgrade' ? 'Trust and upgrade' : 'Trust and install'}</button>
            </div>
          </div> : adding ? <div className="plugin-add-flow">
            <header className="plugin-detail-head">
              <div><span className="eyebrow">Add a plugin</span><h2>What would you like to add?</h2><p>Gemini can create the plugin, reproduce useful behavior from a reference, or you can install a prebuilt repository as-is.</p></div>
            </header>
            <section className="plugin-add-section plugin-add-section--primary">
              <span className="plugin-add-icon">✦</span>
              <div><h3>Create or reproduce with Gemini</h3><p>Describe what you want. Add an optional GitHub or website reference if there is an example Gemini should study.</p></div>
              <label><span>What should the plugin do?</span><textarea value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="A family calendar where Gemini can read events and add appointments…" rows={4} /></label>
              <label><span>Optional reference</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://github.com/owner/example or https://example.com" /></label>
              <button className="button button--primary" type="button" disabled={!idea.trim() && !reference.trim()} onClick={createWithPi}>Continue in Chat with Gemini</button>
            </section>
            <section className="plugin-add-section">
              <span className="plugin-add-icon">⌁</span>
              <div><h3>Install a repository as-is</h3><p>For a static plugin whose code you already trust. The exact commit is reviewed before anything is installed.</p></div>
              <form className="plugin-repository-form" onSubmit={reviewRepository}>
                <label><span>Plugin Source URL or Identifier</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="workspace:plugins/my-plugin, local:my-plugin, or https://github.com/..." /></label>
                <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', margin: '4px 0 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span><strong>Supported Sources:</strong></span>
                  <span>• <code>workspace:plugins/&lt;id&gt;</code> — Inside active workspace (<code>Documents/PiWorkspace/plugins/&lt;id&gt;</code>)</span>
                  <span>• <code>local:&lt;id&gt;</code> — Inside local plugins folder (<code>~/.pi-dashboard/plugins/&lt;id&gt;</code> or bundled)</span>
                  <span>• <code>https://github.com/owner/repo</code> — Public Git repository</span>
                  <span style={{ color: 'var(--yellow, #f59e0b)', marginTop: '2px' }}>🔒 Note: Relative paths with <code>..</code> outside designated directories are blocked for security.</span>
                </div>
                <button className="button" type="submit" disabled={busy !== '' || !url.trim()}>{busy === 'review' ? 'Reviewing…' : 'Review exact commit'}</button>
              </form>
            </section>
          </div> : selected ? <div className="plugin-detail-content">
            <header className="plugin-detail-head">
              <div><span className="eyebrow">{selected.source === 'bundled' ? 'Included with Dashboard' : 'Installed repository'}</span><h2>{selected.name}</h2><p>{selected.description || 'No description supplied.'}</p></div>
              <span className="plugin-detail-icon">{selected.icon}</span>
            </header>
            <div className="plugin-status-strip">
              <span className={selected.enabled ? 'is-enabled' : ''}>{selected.enabled ? 'Enabled' : 'Disabled'}</span>
              <span>v{selected.version}</span>
              <span>{runtimeLabel(selected)}</span>
              <span>{selected.agentSkills.length ? `${selected.agentSkills.length} bundled skill${selected.agentSkills.length === 1 ? '' : 's'}` : 'No bundled skills'}</span>
              <span>{selected.agentTools.length ? `${selected.agentTools.length} Gemini tool${selected.agentTools.length === 1 ? '' : 's'}` : 'No Gemini access needed'}</span>
            </div>
            <section className="plugin-primary-actions">
              <div><h3>Dashboard access</h3><p>Controls whether this plugin appears and runs in your dashboard.</p></div>
              <button className="button" type="button" disabled={busy !== ''} onClick={() => void toggle(selected)}>{busy === selected.id ? 'Working…' : selected.enabled ? 'Disable plugin' : 'Enable plugin'}</button>
              <button className="button button--primary" type="button" disabled={!selected.enabled} onClick={() => onOpen(selected.id)}>Open plugin</button>
            </section>
            {selected.agentSkills.length > 0 && <section className="plugin-agent-skills">
              <div className="plugin-section-heading"><span className="eyebrow">Plugin-owned</span><h3>Bundled skills</h3><p>Instruction-only skills follow plugin enablement. Skills that use plugin tools also require the matching Gemini access grant.</p></div>
              {selected.agentSkills.map((skill) => {
                const available = selected.enabled && (!skill.access || selected.agentAccess[skill.access])
                return <div className={available ? 'is-enabled' : ''} key={skill.name}>
                  <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
                  <b>{available ? 'Available to Gemini' : !selected.enabled ? 'Plugin disabled' : `Needs ${skill.access} access`}</b>
                </div>
              })}
            </section>}
            {selected.agentTools.length > 0 ? <section className="plugin-agent-access">
              <div className="plugin-section-heading"><span className="eyebrow">Optional</span><h3>Gemini access</h3><p>Dashboard enablement and Gemini access are separate. Grant only what you want Gemini to do in chat.</p></div>
              {readTools.length > 0 && <button className={`plugin-access-row ${selected.agentAccess.read ? 'is-enabled' : ''}`} type="button" disabled={busy !== ''} onClick={() => void toggleAgentAccess(selected, 'read')}>
                <span><strong>Allow Gemini to read</strong><small>{readTools.map((tool) => tool.label).join(', ')}</small></span><b>{selected.agentAccess.read ? 'Allowed' : 'Not allowed'}</b>
              </button>}
              {writeTools.length > 0 && <button className={`plugin-access-row plugin-access-row--write ${selected.agentAccess.write ? 'is-enabled' : ''}`} type="button" disabled={busy !== ''} onClick={() => void toggleAgentAccess(selected, 'write')}>
                <span><strong>Allow Gemini to make changes</strong><small>{writeTools.map((tool) => tool.label).join(', ')}</small></span><b>{selected.agentAccess.write ? 'Allowed' : 'Not allowed'}</b>
              </button>}
              {!selected.enabled && (selected.agentAccess.read || selected.agentAccess.write) && <p className="plugin-inline-note">These grants are saved, but Gemini cannot use them while the plugin is disabled.</p>}
            </section> : <section className="plugin-agent-empty"><span>Dashboard only</span><p>This plugin does not need a connection to Gemini—for example, a game or display-only tool.</p></section>}
            <details className="plugin-technical">
              <summary>Technical details</summary>
              <dl className="plugin-detail-metadata">
                <div><dt>Plugin ID</dt><dd><code>{selected.id}</code></dd></div>
                <div><dt>Compatibility</dt><dd>{selected.dashboardVersion ? <code>{selected.dashboardVersion}</code> : selected.source === 'repository' ? 'Legacy package did not declare a range' : 'Included with this Dashboard release'}</dd></div>
                <div><dt>Source</dt><dd>{selected.repository ?? 'Included with Dashboard'}</dd></div>
                {selected.commit && <div><dt>Commit</dt><dd><code>{selected.commit}</code></dd></div>}
                {selected.digest && <div><dt>Approved digest</dt><dd><code>{selected.digest}</code></dd></div>}
                <div><dt>Permissions</dt><dd className="text-accent">{selected.permissions.length ? selected.permissions.join(', ') : 'None'}</dd></div>
                <div><dt>Stored data</dt><dd>{size(selected.storageBytes ?? 0)}</dd></div>
                <div><dt>Rollback</dt><dd>{selected.rollbackAvailable ? 'Prior code version available' : 'No retained prior version'}</dd></div>
              </dl>
            </details>
            {(selected.removable || selected.rollbackAvailable) && <section className="plugin-danger-zone">
              <div><h3>Maintenance</h3><p>Version recovery and removal live here so they are not confused with ordinary enable/disable controls.</p></div>
              {selected.rollbackAvailable && <button className="button button--quiet" type="button" disabled={busy !== ''} onClick={() => void rollback(selected)}>Roll back version</button>}
              {selected.removable && !removeChoice && <button className="button button--quiet text-warning" type="button" disabled={busy !== ''} onClick={() => setRemoveChoice(true)}>Remove plugin…</button>}
              {selected.removable && removeChoice && <div className="plugin-remove-choice">
                <strong>What should happen to {size(selected.storageBytes ?? 0)} of plugin data?</strong>
                <p>Keeping data lets a later reinstall pick up where it left off.</p>
                <div>
                  <button className="button" type="button" disabled={busy !== ''} onClick={() => void remove(selected, false)}>Remove and keep data</button>
                  <button className="button button--quiet text-warning" type="button" disabled={busy !== ''} onClick={() => void remove(selected, true)}>Remove and delete data</button>
                  <button className="button button--quiet" type="button" disabled={busy !== ''} onClick={() => setRemoveChoice(false)}>Cancel</button>
                </div>
              </div>}
            </section>}
          </div> : <div className="plugin-manager-empty"><strong>{loading ? 'Loading plugins…' : 'Choose a plugin or add one'}</strong><span>Installed plugins are listed on the left.</span></div>}
        </section>
      </div>
    </div>
  </Panel>
}
