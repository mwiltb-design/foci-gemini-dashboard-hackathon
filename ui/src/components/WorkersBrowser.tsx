import { FormEvent, useMemo, useState } from 'react'
import { Chip, Panel } from './Panel'
import { useWorkers, type WorkerMode, type WorkerStatus } from '../hooks/useWorkers'
import { useSystemStatus, type AvailableModel } from '../hooks/useSystemStatus'

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
  const [mode, setMode] = useState<WorkerMode>('research')
  const [selectedModelKey, setSelectedModelKey] = useState('default')
  const [selectedThinking, setSelectedThinking] = useState('default')
  const [prompt, setPrompt] = useState('')
  const subPi = workers.snapshot?.providers.find((provider) => provider.id === 'sub-pi')
  const active = Boolean(workers.snapshot?.activeTaskId)

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

  async function submit(event: FormEvent) {
    event.preventDefault()
    let modelPayload: { provider: string; id: string } | undefined
    if (selectedModelKey !== 'default') {
      const parsed = splitModel(selectedModelKey)
      if (parsed.provider && parsed.model) {
        modelPayload = { provider: parsed.provider, id: parsed.model }
      }
    }
    const thinkingPayload = selectedThinking !== 'default' ? selectedThinking : undefined
    if (await workers.start(mode, prompt, modelPayload, thinkingPayload)) setPrompt('')
  }

  return (
    <Panel eyebrow="Bounded delegation" title="Workers" action={<Chip tone={active ? 'warning' : 'accent'}>{active ? '1 active' : 'ready'}</Chip>} fullWidth>
      <div className="workers-layout">
        <section className="workers-providers" aria-label="Worker providers">
          <header><div><span className="eyebrow">Provider readiness</span><h2>Available workers</h2></div></header>
          <div className="worker-provider-grid">
            {workers.snapshot?.providers.map((provider) => <article className={`worker-provider worker-provider--${provider.status}`} key={provider.id}>
              <div><span className="worker-provider__mark">{provider.id === 'sub-pi' ? 'π' : '◇'}</span><Chip tone={statusTone(provider.status)}>{provider.status}</Chip></div>
              <strong>{provider.name}</strong>
              <p>{provider.description}</p>
              <small>{provider.statusLabel}</small>
            </article>)}
          </div>
        </section>

        <section className="workers-main">
          <form className="worker-compose" onSubmit={submit}>
            <header><div><span className="eyebrow">New task</span><h2>Delegate to Sub PI</h2><p>Sub PI uses a separate saved Pi session. Primary PI receives only the bounded result and remains responsible for review.</p></div></header>
            <div className="worker-mode-grid">
              {modes.map((item) => <button className={mode === item.id ? 'is-selected' : ''} type="button" key={item.id} onClick={() => setMode(item.id)} disabled={active || workers.busy || subPi?.status !== 'ready'}>
                <strong>{item.label}</strong><span>{item.detail}</span>
              </button>)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '10px', marginBottom: '8px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                <span>Assigned Model for Sub-PI:</span>
                <select
                  value={selectedModelKey}
                  onChange={(e) => setSelectedModelKey(e.target.value)}
                  disabled={active || workers.busy || subPi?.status !== 'ready'}
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
                  disabled={active || workers.busy || subPi?.status !== 'ready'}
                  style={{ padding: '8px 10px', background: 'var(--field)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '7px', font: '11px sans-serif' }}
                >
                  <option value="default">Default Thinking</option>
                  {availableThinking.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="worker-prompt"><span>Bounded prompt</span><textarea rows={5} maxLength={12000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe one narrow task and the concise result Primary PI should receive…" disabled={active || workers.busy || subPi?.status !== 'ready'} /></label>
            <div className="worker-compose__footer">
              <small>Default bounds: 8 turns · 10 minutes · 12 KB result · one job at a time</small>
              <button className="button button--primary" type="submit" disabled={!prompt.trim() || active || workers.busy || subPi?.status !== 'ready'}>{workers.busy ? 'Starting…' : 'Start Sub PI'}</button>
            </div>
          </form>

          {workers.error && <div className="form-error">{workers.error}</div>}

          <div className="worker-workspace">
            <aside className="worker-history">
              <header><span className="eyebrow">Shared queue & history</span><button type="button" onClick={workers.refresh}>↻</button></header>
              {workers.loading ? <div className="worker-empty">Loading tasks…</div> : workers.snapshot?.tasks.length
                ? workers.snapshot.tasks.map((task) => <button className={workers.selectedId === task.id ? 'is-selected' : ''} type="button" key={task.id} onClick={() => workers.setSelectedId(task.id)}>
                    <div><strong>{task.providerName}</strong><Chip tone={statusTone(task.status)}>{task.status}</Chip></div>
                    <p>{task.prompt}</p><small>{task.mode} · {time(task.createdAt)}</small>
                  </button>)
                : <div className="worker-empty">No worker tasks yet.</div>}
            </aside>

            <section className="worker-detail">
              {!workers.selected ? <div className="worker-empty">Select a task to inspect its bounded result and saved session.</div> : <>
                <header>
                  <div><span className="eyebrow">Task detail</span><h2>{workers.selected.providerName} · {workers.selected.mode}</h2><p>{workers.selected.prompt}</p></div>
                  <Chip tone={statusTone(workers.selected.status)}>{workers.selected.status}</Chip>
                </header>
                <div className="worker-progress">
                  <div><span>Progress</span><strong>{workers.selected.progress}</strong></div>
                  <div><span>Turns</span><strong>{workers.selected.turns} / {workers.selected.bounds.turnLimit}</strong></div>
                  <div><span>Started</span><strong>{time(workers.selected.startedAt)}</strong></div>
                </div>
                {(workers.selected.status === 'running' || workers.selected.status === 'queued') && <div className="worker-running-actions"><button className="button button--stop" type="button" disabled={workers.busy} onClick={() => void workers.cancel(workers.selected!.id)}>Cancel task</button></div>}
                {workers.selected.error && <div className="worker-error">{workers.selected.error}</div>}
                <section className="worker-result"><span className="eyebrow">Bounded result</span><pre>{workers.selected.result ?? 'Result will appear when Sub PI finishes.'}</pre>{workers.selected.resultTruncated && <small>The Dashboard truncated this result. Inspect the saved session for the full transcript.</small>}</section>
                <section className="worker-files"><span className="eyebrow">Changed files detected</span>{workers.selected.changedFiles.length
                  ? <ul>{workers.selected.changedFiles.map((file) => <li key={file.path}><code>{file.path}</code><span>{file.state}</span></li>)}</ul>
                  : <p>No changed files were detected for this task.</p>}</section>
                <footer>{workers.selected.sessionId
                  ? <button className="button button--quiet" type="button" onClick={() => onOpenSession(workers.selected!.sessionId!)}>Open saved Sub PI session</button>
                  : <span>Saved session will be available after the worker starts.</span>}</footer>
              </>}
            </section>
          </div>
        </section>
      </div>
    </Panel>
  )
}
