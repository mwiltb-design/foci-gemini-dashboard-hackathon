import type { ViewMeta } from '../types'
import { Chip } from './Panel'

interface TopbarProps {
  meta: ViewMeta
  model?: string
  thinkingLevel?: string
  onOpenMenu: () => void
}

export function Topbar({ meta, model, thinkingLevel, onOpenMenu }: TopbarProps) {
  return (
    <header className="topbar">
      <button className="menu-button" type="button" aria-label="Open navigation" onClick={onOpenMenu}>☰</button>
      <div className="breadcrumb"><span>{meta.section}</span><b>{meta.title}</b></div>
      <div className="topbar__actions">
        <Chip>{model ?? 'model loading'}</Chip>
        <Chip>{thinkingLevel ?? '—'}</Chip>
      </div>
    </header>
  )
}
