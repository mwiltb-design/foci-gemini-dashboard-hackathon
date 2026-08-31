import { FormEvent, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSkills, type SkillCatalogMode, type SkillReview, type SkillSummary } from '../hooks/useSkills'
import type { PluginSummary } from '../types'
import { Chip, Panel } from './Panel'

function withoutFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

interface AddSkillDialogProps {
  busy: boolean
  error: string
  onReview: (path: string) => Promise<SkillReview | null>
  onAdopt: (review: SkillReview, scope: 'user' | 'project') => Promise<boolean>
  onCreateWithPi: (prompt: string) => boolean
  plugins: PluginSummary[]
  onClose: () => void
}

type SkillDestination = 'personal' | 'project' | 'plugin'
type ReviewDestination = 'user' | 'project' | 'plugin'

const destinationDetails: Record<SkillDestination, { label: string; path: string; description: string }> = {
  personal: { label: 'Personal', path: 'Foci private storage · skills/<name>', description: 'Available across projects after activation.' },
  project: { label: 'Project', path: '.pi/skills/<name>', description: 'Stored with this project and optionally version-controlled.' },
  plugin: { label: 'Plugin', path: '<plugin>/skills/<name>', description: 'Immutable and controlled by a trusted bundled plugin.' },
}

function reviewDestination(destination: ReviewDestination): SkillDestination {
  return destination === 'user' ? 'personal' : destination
}

function SkillApprovalDialog({ review, destination, pluginId, busy, error, onAdopt, onCreateWithPi, onBack, onClose }: {
  review: SkillReview
  destination: ReviewDestination
  pluginId?: string
  busy: boolean
  error: string
  onAdopt: (review: SkillReview, scope: 'user' | 'project') => Promise<boolean>
  onCreateWithPi: (prompt: string) => boolean
  onBack?: () => void
  onClose: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const displayDestination = reviewDestination(destination)

  async function approve() {
    if (!confirmed || !review.valid) return
    if (destination === 'plugin') {
      if (onCreateWithPi(`The user reviewed and approved the skill draft at ${review.sourcePath}. Use the dashboard-plugin-authoring skill to add it to the trusted bundled plugin ${pluginId || 'identified by the draft path'}. Re-check the draft, copy it into the plugin's immutable skills/<skill-name> package, declare it in plugin.json agent.skills, classify any read/write dependency honestly, and run the focused plugin contract tests. Remove the draft only after the plugin package is valid. Do not enable the plugin, grant Gemini access, commit, or push.`)) onClose()
      return
    }
    if (await onAdopt(review, destination)) onClose()
  }

  return <div className="dialog-backdrop">
    <section className="dialog skill-review-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-review-title">
      <header className="skill-review-titlebar">
        <div><span className="eyebrow">Review and approval</span><h2 id="skill-review-title">Approve skill installation</h2></div>
        <Chip tone={review.valid ? 'accent' : 'warning'}>{review.valid ? 'ready for review' : 'needs changes'}</Chip>
      </header>
      <div className="skill-review-dialog__scroll">
        {error && <div className="connection-banner">{error}</div>}
        <div className="skill-review-head">
          <div><strong>{review.name}</strong><span>{review.description || 'No description'}</span></div>
        </div>
        {review.warnings.length > 0 && <div className="skill-warnings">{review.warnings.map((warning) => <div key={warning}>⚠ {warning}</div>)}</div>}
        <div className="skill-review-grid">
          <section className="skill-review-instructions"><span className="eyebrow">Skill instructions</span><div className="skill-review-content markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{withoutFrontmatter(review.content)}</ReactMarkdown></div></section>
          <section className="skill-review-file-section"><span className="eyebrow">Files included</span><div className="skill-review-files">{review.files.map((file) => <div key={file.path}><span>{file.path}</span><em>{file.executable ? 'executable · ' : ''}{size(file.size)}</em></div>)}</div></section>
        </div>
        <div className="skill-install-result"><strong>Approval destination</strong><span>{destinationDetails[displayDestination].label} · {destinationDetails[displayDestination].path}</span><small>{destination === 'plugin' ? 'Approval starts a new Gemini chat to integrate and validate the immutable plugin package.' : 'Approval installs the skill inactive in Available Skills. Activate it separately when you are ready.'}</small></div>
        <label className="skill-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>I reviewed the instructions and bundled files. I understand that skills can direct Gemini to run commands or modify files.</span></label>
      </div>
      <footer className="dialog__actions skill-review-actions">
        {onBack && <button className="button button--quiet" type="button" onClick={onBack}>Back</button>}
        <button className="button button--quiet" type="button" onClick={onClose}>Cancel</button>
        <button className="button button--primary" type="button" disabled={busy || !review.valid || !confirmed} onClick={() => void approve()}>{destination === 'plugin' ? 'Approve and continue in new Chat' : 'Approve and install inactive'}</button>
      </footer>
    </section>
  </div>
}

function AddSkillDialog({ busy, error, onReview, onAdopt, onCreateWithPi, plugins, onClose }: AddSkillDialogProps) {
  const [mode, setMode] = useState<'choose' | 'import' | 'describe'>('choose')
  const [path, setPath] = useState('')
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [destination, setDestination] = useState<SkillDestination>('personal')
  const [pluginId, setPluginId] = useState(plugins.find((plugin) => plugin.source === 'bundled')?.id ?? '')
  const [review, setReview] = useState<SkillReview | null>(null)

  async function submitReview(event: FormEvent) {
    event.preventDefault()
    if (destination === 'plugin' || /^https?:\/\//i.test(path.trim())) {
      createWithPi('reproduce', path.trim())
      return
    }
    const result = await onReview(path.trim())
    if (result) setReview(result)
  }

  function createWithPi(action: 'build' | 'reproduce', source?: string) {
    const selectedPlugin = plugins.find((plugin) => plugin.id === pluginId)
    const target = destinationDetails[destination]
    const referenceText = reference.trim() || source
    const request = action === 'build'
      ? description.trim()
      : `Reproduce the useful behavior of this skill source or reference: ${referenceText}`
    const draftParent = destination === 'plugin'
      ? `.pi/skill-drafts/plugin/${selectedPlugin?.id || pluginId || 'choose-plugin'}`
      : `.pi/skill-drafts/${destination}`
    const destinationInstruction = destination === 'plugin'
      ? `This is intended for the trusted bundled plugin ${selectedPlugin ? `${selectedPlugin.name} (${selectedPlugin.id})` : pluginId || 'the plugin identified by the draft path'}. Use the dashboard-plugin-authoring skill for format and safety, but build only a review draft at ${draftParent}/<skill-name> and do not modify plugin.json or the installed plugin yet.`
      : `Build the review draft at ${draftParent}/<skill-name>, using SKILL.md with valid name and description frontmatter plus optional references, scripts, and assets. The intended destination is ${target.label}: ${target.path}. Do not place it in an active skills directory.`
    const catalogInstruction = `The dashboard automatically catalogs valid draft folders under ${draftParent} as Needs review in Available Skills. Finish with the complete draft in that location; the user must not need to copy or type its path.`
    if (onCreateWithPi(`${request}. ${referenceText && action === 'build' ? `Use this optional functional reference without copying credentials, branding, or unrelated content: ${referenceText}. ` : ''}${destinationInstruction} ${catalogInstruction} Do not activate it, commit, or push anything.`)) onClose()
  }

  const destinationPicker = <div className="skill-destination-grid">
    {(Object.keys(destinationDetails) as SkillDestination[]).map((value) => {
      const item = destinationDetails[value]
      return <button className={destination === value ? 'is-selected' : ''} type="button" key={value} onClick={() => setDestination(value)}>
        <strong>{item.label}</strong><span>{item.description}</span><code>{item.path}</code>
      </button>
    })}
  </div>

  if (mode === 'choose') {
    return <div className="dialog-backdrop">
      <section className="dialog skill-import-dialog skill-add-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-add-title">
        <span className="eyebrow">Create or import safely</span>
        <h2 id="skill-add-title">Add a skill</h2>
        <p>Skills are reviewed instruction packages. New personal and project skills are installed inactive; plugin skills follow the plugin lifecycle and Gemini access grants.</p>
        <div className="skill-add-choices">
          <button type="button" onClick={() => setMode('describe')}><span>✦</span><strong>Describe a skill</strong><small>Tell Gemini what workflow you want and where it belongs.</small></button>
          <button type="button" onClick={() => setMode('import')}><span>⌁</span><strong>Use an outside source</strong><small>Review a local package or reproduce a repository or web reference.</small></button>
        </div>
        <div className="dialog__actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  }

  if (review) return <SkillApprovalDialog
    review={review}
    destination={destination === 'personal' ? 'user' : destination}
    pluginId={pluginId}
    busy={busy}
    error={error}
    onAdopt={onAdopt}
    onCreateWithPi={onCreateWithPi}
    onBack={() => setReview(null)}
    onClose={onClose}
  />

  return (
    <div className="dialog-backdrop">
      <section className="dialog skill-import-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-import-title">
        <span className="eyebrow">{mode === 'describe' ? 'Build with Gemini' : 'Review before adopting'}</span>
        <h2 id="skill-import-title">{mode === 'describe' ? 'Describe a skill' : 'Use an outside source'}</h2>
        {error && <div className="connection-banner">{error}</div>}
        {mode === 'describe' ? <>
          <label className="skill-add-field"><span>What should the skill help Gemini do?</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Review a project release and prepare a concise readiness report…" rows={5} autoFocus /></label>
          <label className="skill-add-field"><span>Optional repository or website reference</span><input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://github.com/owner/example or https://example.com" /></label>
          <span className="eyebrow skill-destination-label">Where should it live?</span>
          {destinationPicker}
          {destination === 'plugin' && <label className="skill-add-field"><span>Bundled plugin</span><select value={pluginId} onChange={(event) => setPluginId(event.target.value)}>
            <option value="">Choose in Chat</option>
            {plugins.filter((plugin) => plugin.source === 'bundled').map((plugin) => <option value={plugin.id} key={plugin.id}>{plugin.name}</option>)}
          </select></label>}
          <div className="dialog__actions">
            <button className="button button--quiet" type="button" onClick={() => setMode('choose')}>Back</button>
            <button className="button button--quiet" type="button" onClick={onClose}>Cancel</button>
            <button className="button button--primary" type="button" disabled={!description.trim()} onClick={() => createWithPi('build')}>Start new Chat with Gemini</button>
          </div>
        </> : (
          <>
            <p>Enter a folder inside <code>/workspace</code> containing <code>SKILL.md</code>, or give Gemini a repository or website reference to reproduce safely.</p>
            <form onSubmit={submitReview}>
              <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/workspace/my-skill or https://…" autoFocus />
              <span className="eyebrow skill-destination-label">Destination</span>
              {destinationPicker}
              {destination === 'plugin' && <label className="skill-add-field"><span>Bundled plugin</span><select value={pluginId} onChange={(event) => setPluginId(event.target.value)}>
                <option value="">Choose in Chat</option>
                {plugins.filter((plugin) => plugin.source === 'bundled').map((plugin) => <option value={plugin.id} key={plugin.id}>{plugin.name}</option>)}
              </select></label>}
              <div className="dialog__actions">
                <button className="button button--quiet" type="button" onClick={() => setMode('choose')}>Back</button>
                <button className="button button--quiet" type="button" onClick={onClose}>Cancel</button>
                <button className="button button--primary" type="submit" disabled={busy || !path.trim()}>{destination === 'plugin' || /^https?:\/\//i.test(path.trim()) ? 'Start new Chat with Gemini' : 'Review files'}</button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

export function SkillBrowser({ revision, mode, plugins, onCreateWithPi }: {
  revision: number
  mode: SkillCatalogMode
  plugins: PluginSummary[]
  onCreateWithPi: (prompt: string) => boolean
}) {
  const browser = useSkills(revision, mode)
  const [addOpen, setAddOpen] = useState(false)
  const [approval, setApproval] = useState<{ review: SkillReview; destination: ReviewDestination; pluginId?: string } | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string | null; binary: boolean; truncated: boolean } | null>(null)
  const selected = browser.skills.find((skill) => skill.id === browser.selectedId)
  const usableCount = browser.skills.filter((skill) => skill.enabled).length
  const actionableCount = browser.skills.filter((skill) => !skill.enabled && skill.valid && (skill.canToggle || skill.source === 'plugin' || Boolean(skill.review))).length
  const warningCount = browser.skills.reduce((sum, skill) => sum + skill.warningCount, 0)
  const installed = mode === 'installed'

  useEffect(() => setSelectedFile(null), [browser.selectedId])

  function toggle(skill: SkillSummary) {
    const warning = skill.enabled
      ? `Disable “${skill.name}”? New Gemini requests will no longer use it.`
      : `Enable “${skill.name}”? Its instructions will become available to Gemini.`
    if (window.confirm(`${warning}\n\nGemini will restart its local RPC process and preserve the current session.`)) void browser.toggle(skill)
  }

  async function openFile(path: string) {
    if (!selected) return
    setSelectedFile(await browser.readSkillFile(selected.id, path))
  }

  async function reviewDraft(skill: SkillSummary) {
    const reviewed = await browser.review(skill.storageLocation)
    if (reviewed && skill.review) setApproval({ review: reviewed, destination: skill.review.destination, pluginId: skill.review.pluginId })
  }

  return (
    <>
      <Panel
        eyebrow={installed ? 'Gemini instruction catalog' : 'Discoverable instruction packages'}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="button button--quiet" type="button" onClick={browser.refresh}>↻ Refresh</button>
            <button className="button button--primary" type="button" onClick={() => setAddOpen(true)}>＋ Add Skill</button>
          </div>
        }
      >
        <div className="panel__body">
          <div className="metrics">
            <div className="metric"><b>{String(browser.skills.length).padStart(2, '0')}</b><span>{installed ? 'Gemini-ready skills' : 'Not currently usable'}</span></div>
            <div className="metric"><b>{String(installed ? usableCount : actionableCount).padStart(2, '0')}</b><span>{installed ? 'Gemini has access' : 'Activation paths'}</span></div>
            <div className="metric"><b>{warningCount}</b><span>Warnings</span></div>
          </div>
          {browser.error && <div className="connection-banner">{browser.error}</div>}
          <div className="tools-explainer">
            <strong>{installed ? 'These skills are available to Gemini now.' : 'These skills are discovered but unavailable to Gemini.'}</strong>
            <span>{installed ? 'Disable a settings-managed skill to remove it from future Gemini requests.' : 'Gemini-built drafts appear here automatically for review. Reviewed installations remain inactive until you enable them.'}</span>
          </div>
          <div className="skills-browser">
            <section className="skills-list-pane">
              <div className="skills-filters">
                <input value={browser.query} onChange={(event) => browser.setQuery(event.target.value)} placeholder="Search skills…" />
                <select value={browser.category} onChange={(event) => browser.setCategory(event.target.value)}>{browser.categories.map((category) => <option key={category}>{category}</option>)}</select>
              </div>
              <div className="skills-list">
                {browser.loading && <div className="skill-empty">Loading skills…</div>}
                {!browser.loading && browser.filtered.length === 0 && <div className="skill-empty"><strong>{installed ? 'No installed skills found' : 'No available skills found'}</strong><span>{installed ? 'No discovered skill is currently usable by Gemini.' : 'Add a reviewed local skill when you are ready.'}</span></div>}
                {browser.filtered.map((skill) => (
                  <button className={`skill-row ${browser.selectedId === skill.id ? 'is-selected' : ''}`} type="button" key={skill.id} onClick={() => browser.setSelectedId(skill.id)}>
                    <span className={`skill-state ${skill.enabled ? 'is-enabled' : ''}`}>{skill.enabled ? '✓' : '—'}</span>
                    <span className="skill-row__content"><strong>{skill.name}</strong><em>{skill.description}</em><small>{skill.category} · {skill.source} · {skill.scope}</small></span>
                    <span className="skill-row__badges">{skill.review && <span className="skill-review-badge">Needs review</span>}{skill.warningCount > 0 && <span className="skill-warning-count">{skill.warningCount}</span>}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="skill-detail-pane">
              {!selected || !browser.detail ? <div className="skill-empty skill-empty--large"><strong>Select a skill</strong><span>Inspect its instructions and bundled files before relying on it.</span></div> : (
                <>
                  <header className="skill-detail-head">
                    <div><span className="eyebrow">{selected.category} · {selected.source} · {selected.scope}</span><h2>{selected.name}</h2><p>{selected.description}</p></div>
                    <button className={`skill-toggle ${selected.enabled ? 'is-enabled' : ''}`} type="button" role="switch" aria-checked={selected.enabled} disabled={browser.busy || !selected.canToggle || (!selected.valid && !selected.enabled)} onClick={() => toggle(selected)}><span />{selected.enabled ? 'Enabled' : 'Disabled'}</button>
                  </header>
                  <div className="skill-meta-strip">
                    <Chip tone={selected.enabled ? 'accent' : 'neutral'}>{selected.enabled ? 'Gemini has access' : 'Gemini has no access'}</Chip>
                    <Chip>{selected.valid ? 'valid' : 'needs changes'}</Chip>
                    {selected.review && <Chip tone="warning">needs review</Chip>}
                    {selected.disableModelInvocation && <Chip>command only</Chip>}
                    {browser.detail.allowedTools && <Chip>tools: {browser.detail.allowedTools}</Chip>}
                    {!selected.canToggle && <Chip tone="warning">externally managed</Chip>}
                  </div>
                  <div className="skill-catalog-status">
                    <div><span>Status</span><strong>{selected.status}</strong></div>
                    <div><span>Stored in</span><code>{selected.storageLocation}</code></div>
                    {selected.plugin && <div><span>Plugin dependency</span><strong>{selected.plugin.name} · {selected.plugin.enabled ? 'enabled' : 'disabled'}{selected.plugin.access ? ` · Gemini ${selected.plugin.access} ${selected.plugin.granted ? 'granted' : 'not granted'}` : ''}</strong></div>}
                    {selected.plugin && <button className="button button--quiet" type="button" onClick={() => { window.location.hash = '/plugins' }}>Manage in Plugins</button>}
                    {selected.review && <button className="button button--primary" type="button" disabled={browser.busy} onClick={() => void reviewDraft(selected)}>Review and approve</button>}
                  </div>
                  {browser.detail.warnings.length > 0 && <div className="skill-warnings">{browser.detail.warnings.map((warning) => <div key={warning}>⚠ {warning}</div>)}</div>}
                  <div className="skill-detail-tabs">
                    <section>
                      <span className="eyebrow">Instructions</span>
                      <div className="skill-instructions markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{withoutFrontmatter(browser.detail.content)}</ReactMarkdown></div>
                    </section>
                    <aside>
                      <span className="eyebrow">Bundled files</span>
                      <div className="skill-files">{browser.detail.files.map((file) => <button type="button" key={file.path} className={selectedFile?.path === file.path ? 'is-selected' : ''} onClick={() => void openFile(file.path)}><span>{file.path}</span><em>{file.kind}{file.executable ? ' · executable' : ''}</em></button>)}</div>
                      {selectedFile && <div className="skill-file-preview"><strong>{selectedFile.path}</strong>{selectedFile.truncated && <em>Preview truncated</em>}<pre>{selectedFile.binary ? 'Binary preview unavailable' : selectedFile.content}</pre></div>}
                    </aside>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </Panel>
      {addOpen && <AddSkillDialog
        busy={browser.busy}
        error={browser.error}
        onReview={browser.review}
        onAdopt={browser.adopt}
        onCreateWithPi={onCreateWithPi}
        plugins={plugins}
        onClose={() => setAddOpen(false)}
      />}
      {approval && <SkillApprovalDialog
        review={approval.review}
        destination={approval.destination}
        pluginId={approval.pluginId}
        busy={browser.busy}
        error={browser.error}
        onAdopt={browser.adopt}
        onCreateWithPi={onCreateWithPi}
        onClose={() => setApproval(null)}
      />}
    </>
  )
}
