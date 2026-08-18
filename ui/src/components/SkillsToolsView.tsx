import { useState } from 'react'
import type { PluginSummary } from '../types'
import { SkillBrowser } from './SkillBrowser'
import { ToolBrowser } from './ToolBrowser'

type CatalogTab = 'installed-skills' | 'available-skills' | 'active-tools' | 'available-tools'

export function SkillsToolsView({ revision, plugins, onCreateWithPi }: {
  revision: number
  plugins: PluginSummary[]
  onCreateWithPi: (prompt: string) => boolean
}) {
  const [tab, setTab] = useState<CatalogTab>('installed-skills')

  return (
    <>
      <nav className="capability-tabs" aria-label="Skills and tools">
        <button className={tab === 'installed-skills' ? 'is-active' : ''} type="button" onClick={() => setTab('installed-skills')}>
          <span>✓</span><strong>Installed Skills</strong><em>Available to PI now</em>
        </button>
        <button className={tab === 'available-skills' ? 'is-active' : ''} type="button" onClick={() => setTab('available-skills')}>
          <span>✦</span><strong>Available Skills</strong><em>Discoverable, not usable</em>
        </button>
        <button className={tab === 'active-tools' ? 'is-active' : ''} type="button" onClick={() => setTab('active-tools')}>
          <span>●</span><strong>Active Tools</strong><em>Exposed to PI now</em>
        </button>
        <button className={tab === 'available-tools' ? 'is-active' : ''} type="button" onClick={() => setTab('available-tools')}>
          <span>○</span><strong>Available Tools</strong><em>Registered or dependency-gated</em>
        </button>
      </nav>
      {tab === 'installed-skills' && <SkillBrowser revision={revision} mode="installed" plugins={plugins} onCreateWithPi={onCreateWithPi} />}
      {tab === 'available-skills' && <SkillBrowser revision={revision} mode="available" plugins={plugins} onCreateWithPi={onCreateWithPi} />}
      {tab === 'active-tools' && <ToolBrowser revision={revision} mode="active" />}
      {tab === 'available-tools' && <ToolBrowser revision={revision} mode="available" />}
    </>
  )
}
