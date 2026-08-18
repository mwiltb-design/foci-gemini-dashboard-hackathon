import { useTools, type ToolAccess, type ToolCatalogMode, type ToolRisk } from '../hooks/useTools'
import { Chip, Panel } from './Panel'

const accessLabels: Record<ToolAccess, string> = { read: 'Read', write: 'Write', execute: 'Execute', custom: 'Custom' }
const riskTone: Record<ToolRisk, 'accent' | 'neutral' | 'warning'> = { low: 'accent', medium: 'neutral', high: 'warning' }

export function ToolBrowser({ revision, mode }: { revision: number; mode: ToolCatalogMode }) {
  const browser = useTools(revision, mode)
  const active = mode === 'active'
  const activeCount = browser.tools.filter((tool) => tool.active).length
  const highRiskCount = browser.tools.filter((tool) => tool.risk === 'high').length
  const dependencyCount = browser.tools.filter((tool) => tool.dependency).length

  return (
    <Panel eyebrow="Live PI runtime catalog" title={active ? 'Active Tools' : 'Available Tools'} action={<button className="button button--quiet" type="button" onClick={browser.refresh}>↻ Refresh</button>} fullWidth>
      <div className="panel__body">
        <div className="metrics">
          <div className="metric"><b>{browser.tools.length}</b><span>{active ? 'Exposed to PI' : 'Not exposed to PI'}</span></div>
          <div className="metric"><b>{active ? activeCount : dependencyCount}</b><span>{active ? 'PI has access' : 'Plugin dependencies'}</span></div>
          <div className="metric"><b>{highRiskCount}</b><span>{active ? 'Active high-impact' : 'High-impact tools'}</span></div>
        </div>
        {browser.error && <div className="connection-banner">{browser.error}</div>}
        <div className="tools-explainer">
          <strong>{active ? 'These tools are exposed to PI in the current runtime.' : 'These tools are known but not currently exposed to PI.'}</strong>
          <span>{active ? 'The live PI snapshot is authoritative.' : 'Plugin tools show their enablement and PI-access dependency; built-in tool toggles remain unavailable pending a separate safety review.'}</span>
        </div>
        <div className={`tools-browser ${active ? 'tools-browser--without-shell' : ''}`}>
          <section className="tools-list-pane">
            <div className="tools-filters">
              <input value={browser.query} onChange={(event) => browser.setQuery(event.target.value)} placeholder="Search tools…" />
              <select value={browser.filter} onChange={(event) => browser.setFilter(event.target.value as 'all' | 'active' | ToolAccess)}>
                <option value="all">All</option><option value="read">Read</option><option value="write">Write</option><option value="execute">Execute</option><option value="custom">Custom</option>
              </select>
            </div>
            <div className="tools-list">
              {browser.loading && <div className="tool-empty">Loading runtime tools…</div>}
              {!browser.loading && browser.filtered.length === 0 && <div className="tool-empty"><strong>No {active ? 'active' : 'available'} tools found</strong></div>}
              {!browser.loading && browser.filtered.map((tool) => (
                <button className={`runtime-tool-row ${browser.selectedName === tool.name ? 'is-selected' : ''}`} type="button" key={tool.name} onClick={() => browser.setSelectedName(tool.name)}>
                  <span className={`runtime-tool-state ${tool.active ? 'is-active' : ''}`}>{tool.active ? '●' : '○'}</span>
                  <span><strong>{tool.name}</strong><em>{tool.description}</em><small>{accessLabels[tool.access]} · {tool.source} · {tool.piAccess ? 'PI access' : 'No PI access'}</small></span>
                  <Chip tone={riskTone[tool.risk]}>{tool.risk}</Chip>
                </button>
              ))}
            </div>
          </section>

          <section className="tool-detail-pane">
            {!browser.selected ? <div className="tool-empty tool-empty--large">Select a tool to inspect its access and runtime source.</div> : (
              <>
                <header className="tool-detail-head">
                  <div><span className="eyebrow">{browser.selected.source} · {browser.selected.scope}</span><h2>{browser.selected.name}</h2><p>{browser.selected.description}</p></div>
                  <Chip tone={browser.selected.piAccess ? 'accent' : 'neutral'}>{browser.selected.piAccess ? 'PI has access' : 'PI has no access'}</Chip>
                </header>
                <div className="tool-detail-body">
                  <div className="tool-facts">
                    <div><span>Access</span><strong>{accessLabels[browser.selected.access]}</strong></div>
                    <div><span>Risk</span><strong className={`risk-${browser.selected.risk}`}>{browser.selected.risk}</strong></div>
                    <div><span>Origin</span><strong>{browser.selected.origin}</strong></div>
                  </div>
                  <section className="tool-status">
                    <span className="eyebrow">Status</span>
                    <p>{browser.selected.status}</p>
                    {browser.selected.dependency && <p>Dependency: {browser.selected.dependency.name} plugin · {browser.selected.dependency.enabled ? 'enabled' : 'disabled'} · PI {browser.selected.dependency.access} access {browser.selected.dependency.granted ? 'granted' : 'not granted'}.</p>}
                  </section>
                  <section><span className="eyebrow">Accepted inputs</span><div className="tool-parameters">{browser.selected.parameterNames.length ? browser.selected.parameterNames.map((parameter) => <code key={parameter}>{parameter}</code>) : <span>No input fields reported</span>}</div></section>
                  {browser.selected.promptGuidelines.length > 0 && <section><span className="eyebrow">Runtime guidelines</span><ul className="tool-guidelines">{browser.selected.promptGuidelines.map((guideline) => <li key={guideline}>{guideline}</li>)}</ul></section>}
                  <div className={`tool-safety-note tool-safety-note--${browser.selected.risk}`}>
                    {browser.selected.access === 'read' && 'This tool is designed to inspect information without changing project files.'}
                    {browser.selected.access === 'write' && 'This tool can change project files. Review resulting Git diffs in the Files view.'}
                    {browser.selected.access === 'execute' && 'This tool can run installed command-line programs. Its impact depends on the command Pi executes.'}
                    {browser.selected.access === 'custom' && 'This extension-provided tool may have capabilities beyond the built-in categories. Review its source before enabling it.'}
                  </div>
                  {browser.selected.dependency
                    ? <button className="button button--quiet" type="button" onClick={() => { window.location.hash = '/plugins' }}>Manage dependency in Plugins</button>
                    : <button className="button button--quiet" type="button" disabled title="No reviewed Dashboard control exists for this runtime tool">No safe catalog action available</button>}
                </div>
              </>
            )}
          </section>

          {!active && <aside className="shell-capabilities">
            <header><span className="eyebrow">Indirect capabilities</span><h2>Command-line programs</h2><p>These are not direct PI tools. Their status is reported separately because Bash may expose them indirectly.</p></header>
            <div className="shell-list">{browser.shell.map((program) => (
              <div className={!program.available ? 'is-unavailable' : ''} key={program.name}>
                <span className="shell-state">{program.available ? '✓' : '—'}</span>
                <span><strong>{program.label}</strong><em>{program.description}</em><small>{program.source} · {program.piAccess ? 'PI access through Bash' : 'No PI access'}<br />{program.status}<br />{program.version ?? 'version unavailable'}</small></span>
              </div>
            ))}</div>
          </aside>}
        </div>
      </div>
    </Panel>
  )
}
