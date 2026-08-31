import { useState } from 'react'
import type { PluginSummary } from '../types'
import { SkillBrowser } from './SkillBrowser'
import { ToolBrowser } from './ToolBrowser'

type CatalogTab = 'skills' | 'tools'

export function SkillsToolsView({ revision, plugins, onCreateWithPi }: {
  revision: number
  plugins: PluginSummary[]
  onCreateWithPi: (prompt: string) => boolean
}) {
  const [tab, setTab] = useState<CatalogTab>('skills')

  return (
    <>
      <nav className="capability-tabs" aria-label="Skills and tools">
        <button className={tab === 'skills' ? 'is-active' : ''} type="button" onClick={() => setTab('skills')}>
          <span>🧠</span><strong>Agent Skills</strong><em>Installed knowledge & reference manuals</em>
        </button>
        <button className={tab === 'tools' ? 'is-active' : ''} type="button" onClick={() => setTab('tools')}>
          <span>🛠</span><strong>Runtime Tools</strong><em>Active execution tools & shell capabilities</em>
        </button>
      </nav>
      {tab === 'skills' && <SkillBrowser revision={revision} mode="installed" plugins={plugins} onCreateWithPi={onCreateWithPi} />}
      {tab === 'tools' && <ToolBrowser revision={revision} mode="active" />}
    </>
  )
}
