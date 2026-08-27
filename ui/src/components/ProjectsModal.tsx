import { useState, type FormEvent } from 'react'
import { useProjects } from '../hooks/useProjects'
import { Chip } from './Panel'

export function ProjectsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { data, loading, busy, error, createProject, switchProject, openProjectInNewWindow } = useProjects()
  const [newName, setNewName] = useState('')
  const [template, setTemplate] = useState('standard')
  const [successNotice, setSuccessNotice] = useState('')

  if (!isOpen) return null

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const created = await createProject(newName, template)
    if (created) {
      setSuccessNotice(`Created project "${created.name}"! Switching workspace...`)
      setNewName('')
      await switchProject(created.path)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0, 0, 0, 0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
    }}>
      <div style={{
        background: '#12171d', border: '1px solid var(--line)', borderRadius: '12px',
        width: '100%', maxWidth: '640px', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)', overflow: 'hidden'
      }}>
        <header style={{
          padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div>
            <span style={{ fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sandboxed Projects Root</span>
            <h2 style={{ margin: 0, fontSize: '16px', color: 'var(--text)' }}>Project Manager</h2>
          </div>
          <button className="button button--quiet" type="button" onClick={onClose}>✕ Close</button>
        </header>

        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active Workspace Info */}
          <div style={{ padding: '12px 14px', background: '#0a0e12', borderRadius: '8px', border: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Active Project:</span>
              <Chip tone="accent">Current Session</Chip>
            </div>
            <strong style={{ fontSize: '14px', color: 'var(--accent)', fontFamily: 'monospace' }}>
              {data?.activeProjectSlug || 'workspace'}
            </strong>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px', wordBreak: 'break-all' }}>
              📂 {data?.activeWorkspace || 'Loading workspace...'}
            </div>
          </div>

          {/* Create New Project */}
          <form onSubmit={handleCreate} style={{
            padding: '16px', background: 'var(--panel-2)', border: '1px solid var(--line)',
            borderRadius: '9px', display: 'flex', flexDirection: 'column', gap: '10px'
          }}>
            <strong style={{ fontSize: '13px', color: 'var(--text)' }}>＋ Create New Sandboxed Project</strong>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)' }}>
              Creates a dedicated project folder inside <code>{data?.rootDir || 'Foci Dashboards'}</code> with starter memory.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: '8px' }}>
              <input
                autoFocus
                placeholder="Project Name (e.g. Project-Alpha)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{
                  padding: '9px 12px', background: 'var(--field)', border: '1px solid var(--line)',
                  borderRadius: '7px', color: 'var(--text)', font: '12px sans-serif'
                }}
              />
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                style={{
                  padding: '9px 10px', background: 'var(--field)', border: '1px solid var(--line)',
                  borderRadius: '7px', color: 'var(--text)', font: '11px sans-serif'
                }}
              >
                <option value="standard">Clean Starter</option>
                <option value="python">Python Project</option>
                <option value="web">Web Project</option>
              </select>
              <button className="button button--primary" type="submit" disabled={!newName.trim() || busy}>
                {busy ? 'Creating...' : 'Create Project'}
              </button>
            </div>

            {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}
            {successNotice && <div style={{ color: 'var(--accent)', fontSize: '11px' }}>{successNotice}</div>}
          </form>

          {/* Existing Projects List */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <strong style={{ fontSize: '13px', color: 'var(--text)' }}>
                Existing Projects ({data?.projects.length ?? 0})
              </strong>
              <small style={{ color: 'var(--muted)' }}>Root: {data?.rootDir}</small>
            </div>

            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)' }}>Loading projects...</div>
            ) : data?.projects.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
                No project folders created yet in {data?.rootDir}. Create your first one above!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {data?.projects.map((proj) => (
                  <div
                    key={proj.id}
                    style={{
                      padding: '10px 14px', background: '#0d1217', border: '1px solid var(--line)',
                      borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '13px', color: 'var(--text)' }}>📁 {proj.name}</strong>
                      <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                        {proj.fileCount} files {proj.hasMemory && '· MEMORY.md'} {proj.hasNotes && '· Notes.md'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {proj.path.toLowerCase() === data.activeWorkspace.toLowerCase() ? (
                        <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 600, padding: '4px 8px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '4px' }}>🟢 Active</span>
                      ) : (
                        <>
                          <button
                            className="button button--primary"
                            type="button"
                            disabled={busy}
                            onClick={() => switchProject(proj.path)}
                            style={{ fontSize: '11px', padding: '4px 10px' }}
                          >
                            Switch Here
                          </button>
                          <button
                            className="button button--quiet"
                            type="button"
                            onClick={() => openProjectInNewWindow(proj.path)}
                            title="Open project in a new isolated window"
                            style={{ fontSize: '11px', padding: '4px 8px' }}
                          >
                            🗔 New Window
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
