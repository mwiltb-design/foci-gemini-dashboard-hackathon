import type { ViewMeta } from '../types'
import { Chip } from './Panel'

interface TopbarProps {
  meta: ViewMeta
  model?: string
  thinkingLevel?: string
  projectSlug?: string
  onOpenMenu: () => void
  onOpenProjects: () => void
}

export function Topbar({ meta, model, thinkingLevel, projectSlug, onOpenMenu, onOpenProjects }: TopbarProps) {
  return (
    <header className="topbar">
      <button className="menu-button" type="button" aria-label="Open navigation" onClick={onOpenMenu}>☰</button>
      <div className="breadcrumb"><span>{meta.section}</span><b>{meta.title}</b></div>
      <div className="topbar__actions">
        <button
          className="button"
          type="button"
          onClick={onOpenProjects}
          title="Click to Switch or Create Sandboxed Projects"
          style={{
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--panel-2)',
            border: '1px solid var(--accent)',
            color: 'var(--text)',
            borderRadius: '6px',
            padding: '4px 10px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <span style={{ color: 'var(--accent)' }}>📁</span>
          <span>Project: <strong style={{ color: 'var(--accent)' }}>{projectSlug || 'Default'}</strong></span>
        </button>
        <Chip>{model ?? 'model loading'}</Chip>
        <Chip>{thinkingLevel ?? '—'}</Chip>
      </div>
    </header>
  )
}
