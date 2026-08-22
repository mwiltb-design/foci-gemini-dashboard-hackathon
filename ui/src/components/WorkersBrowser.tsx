import { FormEvent, useMemo, useState } from 'react'
import { Chip, Panel } from './Panel'
import { useWorkers, type WorkerMode, type WorkerProvider, type WorkerRuleFile, type WorkerStatus } from '../hooks/useWorkers'
import { useSystemStatus, type AvailableModel } from '../hooks/useSystemStatus'
import { WorkerConsole, type WorkerConsoleMode } from './WorkerConsole'

const modes: Array<{ id: WorkerMode; label: string; detail: string }> = [
  { id: 'research', label: 'Research', detail: 'Read-only investigation and concise findings.' },
  { id: 'review', label: 'Review', detail: 'Read-only critique, risk checks, and recommendations.' },
  { id: 'implement', label: 'Implement', detail: 'May edit project files and run focused validation.' },
]

function statusTone(status: WorkerStatus | 'ready' | 'disabled' | 'unavailable' | 'planned') {
  if (status === 'completed' || status === 'ready') return 'accent' as const
  if (status === 'running' || status === 'queued') return 'neutral' as const
  return 'warning' as const
}

function time(value?: string): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function modelKey(provider: string, id: string): string {
  return `${provider}/${id}`
}

function splitModel(value: string): { provider?: string; model?: string } {
  const [provider, ...rest] = value.split('/')
  return { provider, model: rest.join('/') }
}

export function WorkersBrowser({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const workers = useWorkers()
  const system = useSystemStatus()

  const [activeTab, setActiveTab] = useState<'tasks' | 'rules'>('tasks')
  const [selectedProviderId, setSelectedProviderId] = useState('sub-pi')
  const [mode, setMode] = useState<WorkerMode>('research')
  const [selectedModelKey, setSelectedModelKey] = useState('default')
  const [selectedThinking, setSelectedThinking] = useState('default')
  const [turnLimit, setTurnLimit] = useState(8)
  const [timeoutMinutes, setTimeoutMinutes] = useState(10)
  const [resultLimitKb, setResultLimitKb] = useState(12)
  const [showBounds, setShowBounds] = useState(false)
  const [prompt, setPrompt] = useState('')

  // Console terminal modal
  const [activeConsole, setActiveConsole] = useState<{ providerId: string; providerName: string; mode: WorkerConsoleMode } | null>(null)

  // Rule editor state
  const [selectedRuleId, setSelectedRuleId] = useState<string>('workers-router')
  const [ruleEditorContent, setRuleEditorContent] = useState<string>('')
  const [ruleSaveStatus, setRuleSaveStatus] = useState<string>('')

  const active = Boolean(workers.snapshot?.activeTaskId)
  const providers = workers.snapshot?.providers ?? []
  const currentProvider = providers.find((p) => p.id === selectedProviderId) || providers[0]

  const availableModels = system.snapshot?.pi.availableModels ?? []
  const availableThinking: string[] = system.snapshot?.pi.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high']

  const groupedModels = useMemo(() => {
    const map = new Map<string, AvailableModel[]>()
    for (const model of availableModels) {
      const list = map.get(model.provider) ?? []
      list.push(model)
      map.set(model.provider, list)
    }
    return map
  }, [availableModels])

  const currentRule = useMemo(() => {
    return workers.snapshot?.rules.find((r) => r.id === selectedRuleId) ?? workers.snapshot?.rules[0]
  }, [workers.snapshot?.rules, selectedRuleId])

  // Sync rule editor when selection changes
  const handleSelectRule = (rule: WorkerRuleFile) => {
    setSelectedRuleId(rule.id)
    setRuleEditorContent(rule.content)
    setRuleSaveStatus('')
  }

  // Handle provider enable/disable toggle
  const handleToggleProvider = async (provider: WorkerProvider, e: React.MouseEvent) => {
    e.stopPropagation()
    const nextEnabled = !provider.enabled
    await workers.updateConfig({
      providersEnabled: {
        ...(workers.snapshot?.configuration.providersEnabled ?? {}),
        [provider.id]: nextEnabled,
      },
    })
  }

  // Save rule file
  const handleSaveRule = async () => {
    if (!currentRule) return
    setRuleSaveStatus('Saving…')
    const success = await workers.saveRule(currentRule.id, ruleEditorContent || currentRule.content)
    if (success) {
      setRuleSaveStatus('Saved successfully!')
      setTimeout(() => setRuleSaveStatus(''), 3000)
    } else {
      setRuleSaveStatus('Failed to save')
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    let modelPayload: { provider: string; id: string } | undefined
    if (selectedModelKey !== 'default' && selectedProviderId === 'sub-pi') {
      const parsed = splitModel(selectedModelKey)
      if (parsed.provider && parsed.model) {
        modelPayload = { provider: parsed.provider, id: parsed.model }
      }
    }
    const thinkingPayload = selectedThinking !== 'default' && selectedProviderId === 'sub-pi' ? selectedThinking : undefined

    const boundsPayload = {
      turnLimit,
      timeoutMs: timeoutMinutes * 60_000,
      resultLimitBytes: resultLimitKb * 1024,
    }

    const ok = await workers.start({
      providerId: selectedProviderId,
      mode,
      prompt,
      bounds: boundsPayload,
      model: modelPayload,
      thinkingLevel: thinkingPayload,
    })

    if (ok) setPrompt('')
  }

  return (
    <Panel
      eyebrow="Bounded delegation & Multi-worker CLI"
      title="Workers"
      action={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', background: 'var(--card-bg, #1a222d)', borderRadius: '6px', padding: '2px', border: '1px solid var(--line)' }}>
            <button
              type="button"
              onClick={() => setActiveTab('tasks')}
              style={{
                background: activeTab === 'tasks' ? 'var(--accent, #63e6be)' : 'transparent',
                color: activeTab === 'tasks' ? '#000' : 'var(--muted)',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: activeTab === 'tasks' ? 'bold' : 'normal',
                cursor: 'pointer',
              }}
            >
              Tasks & Queue
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('rules')
                if (currentRule && !ruleEditorContent) setRuleEditorContent(currentRule.content)
              }}
              style={{
                background: activeTab === 'rules' ? 'var(--accent, #63e6be)' : 'transparent',
                color: activeTab === 'rules' ? '#000' : 'var(--muted)',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: activeTab === 'rules' ? 'bold' : 'normal',
                cursor: 'pointer',
              }}
            >
              Rules & Router (Markdown)
            </button>
          </div>
          <Chip tone={active ? 'warning' : 'accent'}>{active ? '1 active' : 'ready'}</Chip>
        </div>
      }
      fullWidth
    >
      <div className="workers-layout">
        {/* Top: Provider Readiness Grid */}
        <section className="workers-providers" aria-label="Worker providers">
          <header>
            <div>
              <span className="eyebrow">Provider readiness</span>
              <h2>Available Workers & CLIs</h2>
            </div>
          </header>
          <div className="worker-provider-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            {providers.map((provider) => {
              const isSubPi = provider.id === 'sub-pi'
              const mark = isSubPi ? 'π' : provider.id === 'antigravity-cli' ? '⚡' : provider.id === 'codex-cli' ? '⌥' : '✦'

              return (
                <article className={`worker-provider worker-provider--${provider.status}`} key={provider.id} style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="worker-provider__mark">{mark}</span>
                      <Chip tone={statusTone(provider.status)}>{provider.status}</Chip>
                    </div>

                    {/* Enable / Disable Toggle Switch */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleProvider(provider, e)}
                      title={provider.enabled ? 'Click to disable worker' : 'Click to enable worker'}
                      style={{
                        background: provider.enabled ? 'rgba(99, 230, 190, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${provider.enabled ? 'var(--accent, #63e6be)' : 'var(--line)'}`,
                        color: provider.enabled ? 'var(--accent, #63e6be)' : 'var(--muted)',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '10px',
                        cursor: 'pointer',
                      }}
                    >
                      {provider.enabled ? '✓ Enabled' : '○ Disabled'}
                    </button>
                  </div>

                  <strong>{provider.name}</strong>
                  <p>{provider.description}</p>
                  <small>{provider.statusLabel}</small>

                  {/* Connect / Manage Action Buttons */}
                  {provider.enabled && provider.kind === 'external' && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                      {provider.status === 'unavailable' ? (
                        <button
                          className="button button--quiet"
                          type="button"
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          onClick={() => setActiveConsole({ providerId: provider.id, providerName: provider.name, mode: 'login' })}
                        >
                          Connect ↗
                        </button>
                      ) : (
                        <button
                          className="button button--quiet"
                          type="button"
                          style={{ fontSize: '11px', padding: '3px 8px' }}
                          onClick={() => setActiveConsole({ providerId: provider.id, providerName: provider.name, mode: 'manage' })}
                        >
                          Manage CLI ⚙
                        </button>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        {/* Modal Terminal Console */}
        {activeConsole && (
          <div style={{ margin: '16px 0' }}>
            <WorkerConsole
              providerId={activeConsole.providerId}
              providerName={activeConsole.providerName}
              mode={activeConsole.mode}
              onClose={() => setActiveConsole(null)}
              onStatusChange={workers.refresh}
            />
          </div>
        )}

        {/* Tab 1: Tasks & Queue */}
        {activeTab === 'tasks' ? (
          <section className="workers-main">
            <form className="worker-compose" onSubmit={submit}>
              <header>
                <div>
                  <span className="eyebrow">New task</span>
                  <h2>Delegate to {currentProvider?.name ?? 'Worker'}</h2>
                  <p>
                    {currentProvider?.id === 'sub-pi'
                      ? 'Sub PI executes in a separate Pi session. Primary PI receives only the bounded result.'
                      : currentProvider?.id === 'antigravity-cli'
                        ? 'Antigravity CLI executes with full reasoning and workspace permissions (research, review, implement).'
                        : `${currentProvider?.name} runs bounded in the workspace and returns structured findings.`}
                  </p>
                </div>
              </header>

              {/* Provider Selection */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 'bold' }}>Worker Provider:</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {providers.filter((p) => p.enabled).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProviderId(p.id)}
                      disabled={active || workers.busy}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: `1px solid ${selectedProviderId === p.id ? 'var(--accent, #63e6be)' : 'var(--line)'}`,
                        background: selectedProviderId === p.id ? 'rgba(99, 230, 190, 0.12)' : 'var(--card-bg)',
                        color: selectedProviderId === p.id ? 'var(--accent, #63e6be)' : 'var(--text)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: selectedProviderId === p.id ? 'bold' : 'normal',
                      }}
                    >
                      {p.id === 'sub-pi' ? 'π ' : p.id === 'antigravity-cli' ? '⚡ ' : '⌥ '}{p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Mode Selection */}
              <div className="worker-mode-grid">
                {modes.map((item) => (
                  <button
                    className={mode === item.id ? 'is-selected' : ''}
                    type="button"
                    key={item.id}
                    onClick={() => setMode(item.id)}
                    disabled={active || workers.busy || currentProvider?.status !== 'ready'}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.detail}</span>
                  </button>
                ))}
              </div>

              {/* Sub-PI Model and Thinking Selectors */}
              {selectedProviderId === 'sub-pi' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '10px', marginBottom: '8px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                    <span>Assigned Model for Sub-PI:</span>
                    <select
                      value={selectedModelKey}
                      onChange={(e) => setSelectedModelKey(e.target.value)}
                      disabled={active || workers.busy || currentProvider?.status !== 'ready'}
                      style={{ padding: '8px 10px', background: 'var(--field)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '7px', font: '11px sans-serif' }}
                    >
                      <option value="default">⚡ Same as Primary Pi (Default)</option>
                      {[...groupedModels.entries()].map(([provider, models]) => (
                        <optgroup label={provider} key={provider}>
                          {models.map((model) => (
                            <option value={modelKey(model.provider, model.id)} key={modelKey(model.provider, model.id)}>
                              {model.name} · {model.id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                    <span>Thinking / Reasoning Level:</span>
                    <select
                      value={selectedThinking}
                      onChange={(e) => setSelectedThinking(e.target.value)}
                      disabled={active || workers.busy || currentProvider?.status !== 'ready'}
                      style={{ padding: '8px 10px', background: 'var(--field)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '7px', font: '11px sans-serif' }}
                    >
                      <option value="default">Default Thinking</option>
                      {availableThinking.map((level) => (
                        <option key={level} value={level}>{level}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {/* Dynamic Bounds Accordion */}
              <div style={{ marginTop: '8px', marginBottom: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowBounds(!showBounds)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 0',
                  }}
                >
                  <span>{showBounds ? '▾' : '▸'}</span>
                  <span>Execution Bounds: {turnLimit} turns · {timeoutMinutes}m timeout · {resultLimitKb}KB cap</span>
                </button>

                {showBounds && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', padding: '10px', background: 'var(--card-bg, #141a21)', borderRadius: '6px', border: '1px solid var(--line)', marginTop: '6px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>Max Turns ({turnLimit}):</span>
                      <input
                        type="range"
                        min="1"
                        max="30"
                        value={turnLimit}
                        onChange={(e) => setTurnLimit(Number(e.target.value))}
                        disabled={active || workers.busy}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>Timeout ({timeoutMinutes} min):</span>
                      <input
                        type="range"
                        min="1"
                        max="30"
                        value={timeoutMinutes}
                        onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
                        disabled={active || workers.busy}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>Result Limit ({resultLimitKb} KB):</span>
                      <input
                        type="range"
                        min="4"
                        max="64"
                        value={resultLimitKb}
                        onChange={(e) => setResultLimitKb(Number(e.target.value))}
                        disabled={active || workers.busy}
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Prompt Box */}
              <label className="worker-prompt">
                <span>Bounded prompt</span>
                <textarea
                  rows={5}
                  maxLength={12000}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder={`Describe a narrow task for ${currentProvider?.name ?? 'the worker'} and the concise deliverable Primary PI should receive…`}
                  disabled={active || workers.busy || currentProvider?.status !== 'ready'}
                />
              </label>

              <div className="worker-compose__footer">
                <small>Auto-approves workspace actions · Injects Level 2 rule guidelines</small>
                <button
                  className="button button--primary"
                  type="submit"
                  disabled={!prompt.trim() || active || workers.busy || currentProvider?.status !== 'ready'}
                >
                  {workers.busy ? 'Starting…' : `Start ${currentProvider?.name ?? 'Worker'}`}
                </button>
              </div>
            </form>

            {workers.error && <div className="form-error">{workers.error}</div>}

            {/* History and Detail Panes */}
            <div className="worker-workspace">
              <aside className="worker-history">
                <header>
                  <span className="eyebrow">Shared queue & history</span>
                  <button type="button" onClick={workers.refresh}>↻</button>
                </header>
                {workers.loading ? (
                  <div className="worker-empty">Loading tasks…</div>
                ) : workers.snapshot?.tasks.length ? (
                  workers.snapshot.tasks.map((task) => (
                    <button
                      className={workers.selectedId === task.id ? 'is-selected' : ''}
                      type="button"
                      key={task.id}
                      onClick={() => workers.setSelectedId(task.id)}
                    >
                      <div>
                        <strong>{task.providerName}</strong>
                        <Chip tone={statusTone(task.status)}>{task.status}</Chip>
                      </div>
                      <p>{task.prompt}</p>
                      <small>{task.mode} · {time(task.createdAt)}</small>
                    </button>
                  ))
                ) : (
                  <div className="worker-empty">No worker tasks yet.</div>
                )}
              </aside>

              <section className="worker-detail">
                {!workers.selected ? (
                  <div className="worker-empty">Select a task to inspect its bounded result and saved session.</div>
                ) : (
                  <>
                    <header>
                      <div>
                        <span className="eyebrow">Task detail</span>
                        <h2>{workers.selected.providerName} · {workers.selected.mode}</h2>
                        <p>{workers.selected.prompt}</p>
                      </div>
                      <Chip tone={statusTone(workers.selected.status)}>{workers.selected.status}</Chip>
                    </header>
                    <div className="worker-progress">
                      <div><span>Progress</span><strong>{workers.selected.progress}</strong></div>
                      <div><span>Turns</span><strong>{workers.selected.turns} / {workers.selected.bounds.turnLimit}</strong></div>
                      <div><span>Started</span><strong>{time(workers.selected.startedAt)}</strong></div>
                    </div>
                    {(workers.selected.status === 'running' || workers.selected.status === 'queued') && (
                      <div className="worker-running-actions">
                        <button className="button button--stop" type="button" disabled={workers.busy} onClick={() => void workers.cancel(workers.selected!.id)}>
                          Cancel task
                        </button>
                      </div>
                    )}
                    {workers.selected.error && <div className="worker-error">{workers.selected.error}</div>}

                    {/* Result Envelope */}
                    {workers.selected.resultEnvelope?.actionsTaken?.length ? (
                      <section className="worker-actions" style={{ padding: '8px 12px', background: 'rgba(99, 230, 190, 0.05)', borderRadius: '6px', border: '1px solid var(--line)', marginBottom: '8px' }}>
                        <span className="eyebrow" style={{ color: 'var(--accent)' }}>Actions Taken</span>
                        <ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontSize: '11px' }}>
                          {workers.selected.resultEnvelope.actionsTaken.map((action, idx) => (
                            <li key={idx}>{action}</li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    <section className="worker-result">
                      <span className="eyebrow">Bounded result</span>
                      <pre>{workers.selected.result ?? 'Result will appear when the worker finishes.'}</pre>
                      {workers.selected.resultTruncated && <small>The Dashboard truncated this result. Inspect the saved session for full details.</small>}
                    </section>

                    <section className="worker-files">
                      <span className="eyebrow">Changed files detected</span>
                      {workers.selected.changedFiles.length ? (
                        <ul>
                          {workers.selected.changedFiles.map((file) => (
                            <li key={file.path}>
                              <code>{file.path}</code>
                              <span>{file.state}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No changed files were detected for this task.</p>
                      )}
                    </section>

                    <footer>
                      {workers.selected.sessionId ? (
                        <button className="button button--quiet" type="button" onClick={() => onOpenSession(workers.selected!.sessionId!)}>
                          Open saved Sub PI session ↗
                        </button>
                      ) : (
                        <span>Native CLI execution complete.</span>
                      )}
                    </footer>
                  </>
                )}
              </section>
            </div>
          </section>
        ) : (
          /* Tab 2: Rules & Router (Markdown Editor) */
          <section className="workers-main" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '12px' }}>
            <aside style={{ borderRight: '1px solid var(--line)', paddingRight: '12px' }}>
              <header style={{ marginBottom: '12px' }}>
                <span className="eyebrow">Rule Files</span>
                <h3 style={{ fontSize: '13px', margin: '4px 0' }}>Global Guidelines</h3>
                <small style={{ color: 'var(--muted)', fontSize: '10px' }}>Stored in ~/.pi-dashboard/workers/</small>
              </header>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 'bold', marginTop: '4px' }}>Level 1: Router</span>
                {workers.snapshot?.rules.filter((r) => r.level === 1).map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => handleSelectRule(rule)}
                    style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${selectedRuleId === rule.id ? 'var(--accent, #63e6be)' : 'var(--line)'}`,
                      background: selectedRuleId === rule.id ? 'rgba(99, 230, 190, 0.12)' : 'var(--card-bg)',
                      color: selectedRuleId === rule.id ? 'var(--accent, #63e6be)' : 'var(--text)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <strong>{rule.fileName}</strong>
                    <div style={{ fontSize: '10px', color: 'var(--muted)' }}>Dispatcher guidelines</div>
                  </button>
                ))}

                <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 'bold', marginTop: '12px' }}>Level 2: Worker Prompts</span>
                {workers.snapshot?.rules.filter((r) => r.level === 2).map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => handleSelectRule(rule)}
                    style={{
                      textAlign: 'left',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: `1px solid ${selectedRuleId === rule.id ? 'var(--accent, #63e6be)' : 'var(--line)'}`,
                      background: selectedRuleId === rule.id ? 'rgba(99, 230, 190, 0.12)' : 'var(--card-bg)',
                      color: selectedRuleId === rule.id ? 'var(--accent, #63e6be)' : 'var(--text)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <strong>{rule.fileName}</strong>
                    <div style={{ fontSize: '10px', color: 'var(--muted)' }}>{rule.title}</div>
                  </button>
                ))}
              </div>
            </aside>

            <section style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="eyebrow">{currentRule?.level === 1 ? 'Level 1: Router Rules' : 'Level 2: Worker Guidelines'}</span>
                  <h3 style={{ margin: '2px 0', fontSize: '14px' }}>{currentRule?.title ?? 'Rule Editor'}</h3>
                  <small style={{ color: 'var(--muted)' }}>{currentRule?.fileName} · Last updated: {time(currentRule?.updatedAt)}</small>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {ruleSaveStatus && <span style={{ fontSize: '11px', color: 'var(--accent)' }}>{ruleSaveStatus}</span>}
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={handleSaveRule}
                    disabled={workers.busy}
                  >
                    Save Rule (.md)
                  </button>
                </div>
              </div>

              <textarea
                value={ruleEditorContent || currentRule?.content || ''}
                onChange={(e) => setRuleEditorContent(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '420px',
                  fontFamily: 'Consolas, "SFMono-Regular", monospace',
                  fontSize: '12px',
                  padding: '12px',
                  background: 'var(--field, #0f141a)',
                  color: 'var(--text, #d8e4df)',
                  border: '1px solid var(--line)',
                  borderRadius: '8px',
                  resize: 'vertical',
                  lineHeight: '1.5',
                }}
              />
            </section>
          </section>
        )}
      </div>
    </Panel>
  )
}
