import { lazy, Suspense, useState, type FormEvent } from 'react'
import { useFiles, type GitFileState } from '../hooks/useFiles'
import { useMemoryBank } from '../hooks/useMemoryBank'
import { Chip, Panel } from './Panel'

const SourceEditor = lazy(() => import('./FileEditor').then((module) => ({ default: module.SourceEditor })))
const MarkdownPreview = lazy(() => import('./FileEditor').then((module) => ({ default: module.MarkdownPreview })))

const stateLabels: Record<GitFileState, string> = {
  modified: 'M', added: 'A', deleted: 'D', untracked: '?', renamed: 'R', conflicted: '!', staged: 'S',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DiffView({ diff }: { diff: string }) {
  if (!diff) return <div className="file-empty">No textual changes to display.</div>
  return (
    <pre className="diff-view" aria-label="Git diff">
      {diff.split('\n').map((line, index) => {
        const kind = line.startsWith('+++') || line.startsWith('---')
          ? 'header'
          : line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : line.startsWith('@@') ? 'hunk' : 'context'
        return <span className={`diff-line diff-line--${kind}`} key={`${index}-${line.slice(0, 12)}`}>{line || ' '}{'\n'}</span>
      })}
    </pre>
  )
}

export function FileBrowser({ workspaceRevision, editable }: { workspaceRevision: number; editable: boolean }) {
  const files = useFiles(workspaceRevision, editable)
  const memory = useMemoryBank()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [memoryMode, setMemoryMode] = useState<'rendered' | 'source' | 'edit'>('rendered')
  const selectedChange = files.gitStatus?.entries.find((entry) => entry.path === files.selectedPath)
  const changeCount = files.gitStatus?.entries.length ?? 0
  const isMarkdown = files.preview?.language === 'markdown'

  async function createFile(event: FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    if (await files.createFile(name)) {
      setNewName('')
      setCreating(false)
    }
  }

  async function handleOpenMemoryTier(type: 'user' | 'global' | 'project') {
    const data = await memory.loadTier(type)
    if (data) {
      setMemoryDraft(data.content || '')
      setMemoryMode('rendered')
    }
  }

  async function handleSaveMemory() {
    if (!memory.activeTier) return
    const ok = await memory.saveTier(memory.activeTier, memoryDraft)
    if (ok) {
      setMemoryMode('rendered')
    }
  }

  function handleSelectProjectFile(entryOrPath: any) {
    memory.clearActiveTier()
    if (typeof entryOrPath === 'string') {
      files.selectChangedFile(entryOrPath)
    } else {
      files.openEntry(entryOrPath)
    }
  }

  return (
    <Panel
      eyebrow="Project workspace"
      title="Files, Editor & Memory Bank"
      action={
        <div className="file-panel-actions">
          {editable && !memory.activeTier && <button className="button button--quiet" type="button" onClick={() => setCreating((value) => !value)}>＋ New file</button>}
          <button className="button button--quiet" type="button" onClick={() => { if (memory.activeTier) { void handleOpenMemoryTier(memory.activeTier) } else { files.refresh() } }}>↻ Refresh</button>
        </div>
      }
      fullWidth
    >
      <div className="panel__body">
        <div className="metrics">
          <div className="metric"><b>{files.gitStatus?.branch ?? '—'}</b><span>Git branch</span></div>
          <div className="metric"><b>{changeCount}</b><span>Changed files</span></div>
          <div className="metric"><b>{files.gitStatus?.clean ? 'clean' : files.gitStatus?.commit ?? '—'}</b><span>Working tree</span></div>
        </div>
        {!editable && <div className="file-capability-note">Read-only Files · enable the <code>files-editor</code> add-on to create or edit project files.</div>}
        {files.error && <div className="connection-banner">{files.error}</div>}

        <div className="file-browser-container">
          <div className="file-browser">
            <section className="file-navigation" aria-label="Project files">
              {/* 🧠 Dedicated 3-Tier Memory Bank Bar */}
              <div style={{ background: 'var(--panel-2)', padding: '10px', borderRadius: '8px', marginBottom: '12px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>🧠 Memory Bank</span>
                  {memory.activeTier && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Active in Editor</span>}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="button"
                    onClick={() => handleOpenMemoryTier('user')}
                    title="User Profile (USER.md) - Facts about you (Name, Goals). AI asks permission before editing."
                    style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      background: memory.activeTier === 'user' ? 'var(--accent)' : 'var(--bg)',
                      color: memory.activeTier === 'user' ? '#fff' : 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    👤 USER.md
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => handleOpenMemoryTier('global')}
                    title="Global Memory (MEMORY.md) - Cross-project communication rules and habits (Answer first, walk through steps)."
                    style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      background: memory.activeTier === 'global' ? 'var(--accent)' : 'var(--bg)',
                      color: memory.activeTier === 'global' ? '#fff' : 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    🌐 Global MEMORY.md
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => handleOpenMemoryTier('project')}
                    title="Project Memory (MEMORY.md) - Living technical architecture blueprint for this specific workspace."
                    style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      background: memory.activeTier === 'project' ? 'var(--accent)' : 'var(--bg)',
                      color: memory.activeTier === 'project' ? '#fff' : 'var(--text)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    📁 Project MEMORY.md
                  </button>
                </div>
              </div>

              <label className="file-search">
                <span className="sr-only">Search project files</span>
                <input value={files.query} onChange={(event) => files.setQuery(event.target.value)} placeholder="Search project files…" />
              </label>
              {creating && (
                <form className="new-file-form" onSubmit={createFile}>
                  <span>New file in <strong>{files.path || 'project root'}</strong></span>
                  <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="notes.md" pattern="[^/\\]+" title="Enter a file name, not a folder path" />
                  <div><button className="button button--primary" type="submit" disabled={!newName.trim() || files.saving}>Create</button><button className="button button--quiet" type="button" onClick={() => { setCreating(false); setNewName('') }}>Cancel</button></div>
                </form>
              )}
              <nav className="file-breadcrumbs" aria-label="File path">
                {files.breadcrumbs.map((crumb, index) => (
                  <span key={crumb.path || 'root'}>
                    {index > 0 && ' / '}
                    <button type="button" onClick={() => { memory.clearActiveTier(); files.setPath(crumb.path) }}>{crumb.label}</button>
                  </span>
                ))}
              </nav>

              <div className="file-list">
                {files.query.trim().length >= 2 ? (
                  <>
                    {files.searchResults.length === 0 && <div className="file-empty">No matching files yet.</div>}
                    {files.searchResults.map((result) => (
                      <button className="search-result" type="button" key={result.path} onClick={() => { memory.clearActiveTier(); files.selectSearchResult(result) }}>
                        <strong>{result.name}</strong><span>{result.path}</span>
                        {result.matches[0] && <em>Line {result.matches[0].line}: {result.matches[0].text}</em>}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    {files.loading && <div className="file-empty">Loading files…</div>}
                    {!files.loading && files.entries.map((entry) => (
                      <button className={`file-row ${!memory.activeTier && files.selectedPath === entry.path ? 'is-selected' : ''}`} type="button" key={entry.path} onClick={() => handleSelectProjectFile(entry)}>
                        <span className={`file-row__icon file-row__icon--${entry.type}`}>{entry.type === 'directory' ? '▸' : '·'}</span>
                        <span className="file-row__name">{entry.name}</span>
                        {entry.gitState && <span className={`git-badge git-badge--${entry.gitState}`}>{stateLabels[entry.gitState]}</span>}
                        {entry.type === 'file' && <span className="file-row__size">{formatBytes(entry.size)}</span>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </section>

            <section className="file-preview-pane" aria-label="File preview">
              {/* Memory Bank Mode Header */}
              {memory.activeTier && memory.memoryData ? (
                <>
                  <header className="file-preview-head">
                    <div>
                      <span className="eyebrow" style={{ color: 'var(--accent)' }}>🧠 Memory Bank · {memory.memoryData.badge}</span>
                      <h2 title={memory.memoryData.path}>{memory.memoryData.title}</h2>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>{memory.memoryData.description} <em>({memory.memoryData.rule})</em></p>
                    </div>
                    <div className="file-mode-toggle">
                      <button className={memoryMode === 'rendered' ? 'is-active' : ''} type="button" onClick={() => setMemoryMode('rendered')}>Rendered</button>
                      <button className={memoryMode === 'source' ? 'is-active' : ''} type="button" onClick={() => setMemoryMode('source')}>Source</button>
                      {editable && <button className={memoryMode === 'edit' ? 'is-active' : ''} type="button" onClick={() => setMemoryMode('edit')}>Edit</button>}
                    </div>
                  </header>
                  {memoryMode === 'edit' && (
                    <div className="file-edit-toolbar">
                      <span>{memory.saveSuccess ? '✓ Memory saved successfully!' : 'Editing Memory markdown'}</span>
                      <div>
                        <button className="button button--quiet" type="button" disabled={memory.saving} onClick={() => setMemoryMode('rendered')}>Cancel</button>
                        <button className="button button--primary" type="button" disabled={memory.saving} onClick={handleSaveMemory}>{memory.saving ? 'Saving…' : 'Save Memory'}</button>
                      </div>
                    </div>
                  )}
                  <Suspense fallback={<div className="file-empty file-empty--large">Loading memory presentation…</div>}>
                    {memoryMode === 'rendered' && <MarkdownPreview content={memoryDraft || '# Empty Memory\n\nNo content saved yet.'} />}
                    {memoryMode === 'source' && <SourceEditor content={memoryDraft} language="markdown" editable={false} />}
                    {memoryMode === 'edit' && <SourceEditor content={memoryDraft} language="markdown" editable onChange={setMemoryDraft} />}
                  </Suspense>
                </>
              ) : (
                /* Standard Project File Mode */
                <>
                  <header className="file-preview-head">
                    <div>
                      <span className="eyebrow">{files.mode === 'diff' ? 'Git diff' : files.mode === 'edit' ? 'File editor' : files.mode === 'rendered' ? 'Rendered Markdown' : 'Source'}</span>
                      <h2 title={files.selectedPath}>{files.selectedPath ?? 'Select a file or choose a Memory tier'}</h2>
                    </div>
                    {files.selectedPath && (
                      <div className="file-mode-toggle">
                        {isMarkdown && <button className={files.mode === 'rendered' ? 'is-active' : ''} type="button" onClick={() => files.setMode('rendered')}>Rendered</button>}
                        <button className={files.mode === 'source' ? 'is-active' : ''} type="button" onClick={() => files.setMode('source')}>Source</button>
                        {editable && <button className={files.mode === 'edit' ? 'is-active' : ''} type="button" disabled={!files.canEdit} title={!files.canEdit ? 'Only complete text files up to 1 MB can be edited' : undefined} onClick={() => files.setMode('edit')}>Edit</button>}
                        <button className={files.mode === 'diff' ? 'is-active' : ''} type="button" onClick={() => files.setMode('diff')}>Diff</button>
                      </div>
                    )}
                  </header>
                  {files.mode === 'edit' && (
                    <div className="file-edit-toolbar">
                      <span>{files.dirty ? 'Unsaved changes' : files.notice || 'No unsaved changes'}</span>
                      <div><button className="button button--quiet" type="button" disabled={files.saving} onClick={() => files.setMode(isMarkdown ? 'rendered' : 'source')}>Cancel</button><button className="button button--primary" type="button" disabled={!files.dirty || files.saving} onClick={files.save}>{files.saving ? 'Saving…' : 'Save'}</button></div>
                    </div>
                  )}
                  {!files.selectedPath && <div className="file-empty file-empty--large">Choose a project file to inspect, or click one of the 🧠 Memory Bank buttons above.</div>}
                  {files.selectedPath && files.mode !== 'diff' && files.preview && (
                    files.preview.binary
                      ? <div className="file-empty file-empty--large">Binary file · {formatBytes(files.preview.size)} · preview unavailable</div>
                      : <>
                          {files.preview.truncated && <div className="file-warning">Preview limited to the first 1 MB. Large files are read-only.</div>}
                          <Suspense fallback={<div className="file-empty file-empty--large">Loading file presentation…</div>}>
                            {files.mode === 'rendered' && files.preview.content !== null && <MarkdownPreview content={files.preview.content} />}
                            {files.mode === 'source' && files.preview.content !== null && <SourceEditor content={files.preview.content} language={files.preview.language} editable={false} />}
                            {files.mode === 'edit' && <SourceEditor content={files.draft} language={files.preview.language} editable onChange={files.setDraft} />}
                          </Suspense>
                        </>
                  )}
                  {files.selectedPath && files.mode === 'diff' && <>
                    {files.diffTruncated && <div className="file-warning">Diff limited to the first 2 MB.</div>}
                    <DiffView diff={files.diff} />
                  </>}
                </>
              )}
            </section>
          </div>

          <aside className="changes-pane changes-pane--bottom" aria-label="Changed files">
            <header className="changes-pane__header">
              <div><span className="eyebrow">Git working tree</span><h2>Changed Files ({changeCount})</h2></div>
              {selectedChange && <div className="change-summary"><Chip tone={selectedChange.state === 'conflicted' ? 'warning' : 'neutral'}>{selectedChange.state}</Chip></div>}
            </header>
            {!files.gitStatus?.available && <div className="file-empty">Git is not available.</div>}
            {files.gitStatus?.clean && <div className="file-empty">No changes since the baseline.</div>}
            <div className="changes-list changes-list--horizontal">
              {files.gitStatus?.entries.map((entry) => (
                <button className={`change-row ${files.selectedPath === entry.path && files.mode === 'diff' ? 'is-selected' : ''}`} type="button" key={`${entry.path}-${entry.state}`} onClick={() => files.selectChangedFile(entry.path)}>
                  <span className={`git-badge git-badge--${entry.state}`}>{stateLabels[entry.state]}</span>
                  <span><strong>{entry.path.split('/').at(-1)}</strong><em>{entry.path}</em></span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </Panel>
  )
}
