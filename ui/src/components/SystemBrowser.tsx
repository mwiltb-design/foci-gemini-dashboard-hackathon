import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useSystemStatus, type AvailableModel, type SystemSnapshot } from '../hooks/useSystemStatus'
import { Chip, Panel } from './Panel'
import { RemoteAccessCard } from './RemoteAccessCard'
import { ThemeSettingsCard } from './ThemeSettingsCard'
import { StackFeatureSelectorCard } from './StackFeatureSelectorCard'

function modelKey(provider?: string, id?: string): string {
  return provider && id ? `${provider}\u0000${id}` : ''
}

function splitModel(value: string): { provider: string; model: string } {
  const [provider = '', model = ''] = value.split('\u0000')
  return { provider, model }
}

function bytes(value?: number): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KB`
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function date(value?: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function ModelSelect({ models, value, onChange }: { models: AvailableModel[]; value: string; onChange: (value: string) => void }) {
  const groups = useMemo(() => {
    const result = new Map<string, AvailableModel[]>()
    for (const model of models) result.set(model.provider, [...(result.get(model.provider) ?? []), model])
    return result
  }, [models])
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {!models.some((model) => modelKey(model.provider, model.id) === value) && value && <option value={value}>Current selection (not available)</option>}
      {[...groups].map(([provider, entries]) => <optgroup label={provider} key={provider}>{entries.map((model) => <option value={modelKey(model.provider, model.id)} key={modelKey(model.provider, model.id)}>{model.name} · {model.id}</option>)}</optgroup>)}
    </select>
  )
}

interface ModelFormProps {
  title: string
  description: string
  models: AvailableModel[]
  levels: string[]
  initialProvider?: string
  initialModel?: string
  initialThinking?: string
  busy: boolean
  button: string
  warning?: string
  onSubmit: (provider: string, model: string, thinking: string) => Promise<boolean>
}

function ModelForm({ title, description, models, levels, initialProvider, initialModel, initialThinking, busy, button, warning, onSubmit }: ModelFormProps) {
  const fallback = models[0] ? modelKey(models[0].provider, models[0].id) : ''
  const [selectedModel, setSelectedModel] = useState(modelKey(initialProvider, initialModel) || fallback)
  const [thinking, setThinking] = useState(initialThinking ?? 'medium')

  useEffect(() => setSelectedModel(modelKey(initialProvider, initialModel) || fallback), [initialProvider, initialModel, fallback])
  useEffect(() => setThinking(initialThinking ?? 'medium'), [initialThinking])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const selected = splitModel(selectedModel)
    if (!selected.provider || !selected.model) return
    await onSubmit(selected.provider, selected.model, thinking)
  }

  return (
    <form className="system-model-form" onSubmit={submit}>
      <header><div><span className="eyebrow">Model configuration</span><h2>{title}</h2><p>{description}</p></div></header>
      {warning && <div className="system-inline-warning">{warning}</div>}
      <div className="system-model-fields">
        <label><span>Model</span><ModelSelect models={models} value={selectedModel} onChange={setSelectedModel} /></label>
        <label><span>Thinking level</span><select value={thinking} onChange={(event) => setThinking(event.target.value)}>{levels.map((level) => <option value={level} key={level}>{level}</option>)}</select></label>
        <button className="button button--primary" type="submit" disabled={busy || !selectedModel}>{button}</button>
      </div>
    </form>
  )
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: 'accent' | 'warning' }) {
  return <div className="system-fact"><span>{label}</span><strong className={tone === 'accent' ? 'text-accent' : tone === 'warning' ? 'text-warning' : ''}>{value}</strong></div>
}



function CuratedMemorySettings({ memory, busy, onSave }: {
  memory: SystemSnapshot['backend']['curatedMemory']
  busy: boolean
  onSave: (settings: { globalEnabled: boolean; projectEnabled: boolean; skillEnabled: boolean }) => Promise<boolean>
}) {
  const [globalEnabled, setGlobalEnabled] = useState(memory.settings.globalEnabled)
  const [projectEnabled, setProjectEnabled] = useState(memory.settings.projectEnabled)
  const [skillEnabled, setSkillEnabled] = useState(memory.settings.skillEnabled)

  useEffect(() => {
    setGlobalEnabled(memory.settings.globalEnabled)
    setProjectEnabled(memory.settings.projectEnabled)
    setSkillEnabled(memory.settings.skillEnabled)
  }, [memory.settings])

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave({ globalEnabled, projectEnabled, skillEnabled })
  }

  return <section className="system-section system-memory">
    <header><div><span className="eyebrow">Curated memory</span><h2>Markdown memory layers</h2><p>Small, readable context files remain authoritative. Turning a layer off preserves its file and contents.</p></div><Chip tone={globalEnabled || projectEnabled ? 'accent' : 'warning'}>{globalEnabled || projectEnabled ? 'active' : 'paused'}</Chip></header>
    <form className="memory-settings-form curated-memory-form" onSubmit={submit}>
      <label><input type="checkbox" checked={globalEnabled} onChange={(event) => setGlobalEnabled(event.target.checked)} /><span><strong>Global memory and approved user profile</strong><small>Use USER.md and global MEMORY.md across projects.</small></span></label>
      <label><input type="checkbox" checked={projectEnabled} onChange={(event) => setProjectEnabled(event.target.checked)} /><span><strong>Project memory</strong><small>Use this workspace's MEMORY.md only in this project.</small></span></label>
      <label><input type="checkbox" checked={skillEnabled} onChange={(event) => setSkillEnabled(event.target.checked)} /><span><strong>Curated Memory skill</strong><small>Provide the reviewed workflow for remember, forget, and checkpoint requests.</small></span></label>
      <button className="button button--primary" type="submit" disabled={busy}>Save curated memory settings</button>
    </form>
  </section>
}

function MemoryCheckpointSettings({ memory, files, busy, onSave, onRun, onReset }: {
  memory: SystemSnapshot['backend']['memoryCheckpoint']
  files: SystemSnapshot['backend']['files']
  busy: boolean
  onSave: (settings: { enabled: boolean; mode: 'adaptive' | 'custom'; customUserMessages: number; customToolCalls: number }) => Promise<boolean>
  onRun: () => Promise<boolean>
  onReset: () => Promise<boolean>
}) {
  const [enabled, setEnabled] = useState(memory.settings.enabled)
  const [mode, setMode] = useState<'adaptive' | 'custom'>(memory.settings.mode)
  const [userMessages, setUserMessages] = useState(memory.settings.customUserMessages)
  const [toolCalls, setToolCalls] = useState(memory.settings.customToolCalls)
  const status = memory.status

  useEffect(() => {
    setEnabled(memory.settings.enabled)
    setMode(memory.settings.mode)
    setUserMessages(memory.settings.customUserMessages)
    setToolCalls(memory.settings.customToolCalls)
  }, [memory.settings])

  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave({ enabled, mode, customUserMessages: userMessages, customToolCalls: toolCalls })
  }

  function runNow() {
    if (window.confirm('Run a memory checkpoint now? This starts a short Gemini turn using the active model.')) void onRun()
  }

  const userPercent = Math.min(100, status.userMessages / Math.max(1, status.effectiveUserMessages) * 100)
  const toolPercent = Math.min(100, status.toolCalls / Math.max(1, status.effectiveToolCalls) * 100)

  return <section className="system-section system-memory">
    <header><div><span className="eyebrow">Memory</span><h2>Automatic checkpoints</h2><p>Periodically review durable collaboration facts without changing the future Enhanced Memory database.</p></div><Chip tone={memory.settings.enabled ? 'accent' : 'warning'}>{status.checkpointRunning ? 'running' : memory.settings.enabled ? 'enabled' : 'disabled'}</Chip></header>
    <form className="memory-settings-form" onSubmit={submit}>
      <button className={`memory-master-toggle ${enabled ? 'is-enabled' : ''}`} type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled((value) => !value)}><span />{enabled ? 'Automatic checkpoints enabled' : 'Automatic checkpoints disabled'}</button>
      <div className="memory-mode-grid">
        <label><span>Frequency mode</span><select value={mode} onChange={(event) => setMode(event.target.value as 'adaptive' | 'custom')}><option value="adaptive">Adaptive — based on memory size</option><option value="custom">Custom thresholds</option></select></label>
        <label><span>User messages</span><input type="number" min={1} max={100} value={userMessages} onChange={(event) => setUserMessages(Number(event.target.value))} /></label>
        <label><span>Tool calls</span><input type="number" min={5} max={500} value={toolCalls} onChange={(event) => setToolCalls(Number(event.target.value))} /></label>
        <button className="button button--primary" type="submit" disabled={busy}>Save memory settings</button>
      </div>
      <small>Custom mode runs when either limit is reached. Defaults are 20 user messages or 40 tool calls.</small>
    </form>
    <div className="memory-progress-grid">
      <div><span><strong>User messages</strong><em>{status.userMessages} / {status.effectiveUserMessages}</em></span><i><b style={{ width: `${userPercent}%` }} /></i></div>
      <div><span><strong>Tool calls</strong><em>{status.toolCalls} / {status.effectiveToolCalls}</em></span><i><b style={{ width: `${toolPercent}%` }} /></i></div>
    </div>
    <div className="memory-actions">
      <span>Last checkpoint: <strong>{date(status.lastCheckpointAt)}</strong></span>
      <div><button className="button button--quiet" type="button" disabled={busy} onClick={() => void onReset()}>Reset counters</button><button className="button" type="button" disabled={busy || status.checkpointRunning} onClick={runNow}>{status.checkpointRunning ? 'Checkpoint running…' : 'Run checkpoint now'}</button></div>
    </div>
    <div className="system-file-list memory-file-list">{files.map((file) => <div key={file.path}><span className={file.exists ? 'is-ready' : ''}>{file.exists ? '✓' : '—'}</span><div><strong>{file.label}</strong><code>{file.path}</code></div><em>{file.exists ? `${bytes(file.bytes)} · ${date(file.modifiedAt)}` : 'not created'}</em></div>)}</div>
  </section>
}

function SystemContent({ snapshot, busy, onActive, onDefaults, onCuratedMemorySave, onMemorySave, onMemoryRun, onMemoryReset, onResumeOnboarding, onRestart }: {
  snapshot: SystemSnapshot
  busy: boolean
  onActive: (provider: string, model: string, thinking: string) => Promise<boolean>
  onDefaults: (provider: string, model: string, thinking: string) => Promise<boolean>
  onCuratedMemorySave: (settings: { globalEnabled: boolean; projectEnabled: boolean; skillEnabled: boolean }) => Promise<boolean>
  onMemorySave: (settings: { enabled: boolean; mode: 'adaptive' | 'custom'; customUserMessages: number; customToolCalls: number }) => Promise<boolean>
  onMemoryRun: () => Promise<boolean>
  onMemoryReset: () => Promise<boolean>
  onResumeOnboarding: () => Promise<boolean>
  onRestart: () => Promise<boolean>
}) {
  const activeModel = snapshot.pi.state.model
  const config = snapshot.backend.configuration
  const globalDefaults = config.global
  const stats = snapshot.pi.sessionStats
  const context = stats?.contextUsage
  const defaultWarnings = config.projectOverridesDefaults ? 'This project has a local model or thinking override. Global defaults do not replace project-level overrides.' : ''

  const [shortcutNotice, setShortcutNotice] = useState('')

  function restart() {
    if (window.confirm('Restart the local Agent RPC process? The current saved session will be preserved, but the dashboard will briefly disconnect.')) void onRestart()
  }

  async function handleCreateShortcut() {
    try {
      const res = await fetch('/api/system/create-shortcut', { method: 'POST' })
      const data = await res.json()
      setShortcutNotice(data.message || (data.success ? 'Shortcut created on Desktop!' : 'Failed to create shortcut'))
      setTimeout(() => setShortcutNotice(''), 5000)
    } catch {
      setShortcutNotice('Failed to create shortcut')
      setTimeout(() => setShortcutNotice(''), 5000)
    }
  }

  return (
    <>
      <div className="system-overview">
        <Fact label="Agent RPC" value={snapshot.pi.rpcConnected ? 'Online' : 'Degraded'} tone={snapshot.pi.rpcConnected ? 'accent' : 'warning'} />
        <Fact label="Git working tree" value={!snapshot.workspace.git.available ? 'Unavailable' : snapshot.workspace.git.clean ? 'Clean' : 'Changed'} tone={snapshot.workspace.git.clean ? 'accent' : 'warning'} />
        <Fact label="Backend uptime" value={uptime(snapshot.backend.uptimeSeconds)} />
        <Fact label="Connected browsers" value={String(snapshot.backend.connectedClients)} />
      </div>

      {shortcutNotice && <div className="connection-banner">{shortcutNotice}</div>}
      {snapshot.pi.error && <div className="board-error">Agent RPC: {snapshot.pi.error}</div>}
      {stats?.error && <div className="board-error">Session statistics: {stats.error}</div>}
      <div className="system-grid system-grid--models">
        <ModelForm
          title="Active session"
          description="Applies immediately to the current Chat session. It does not change future-session defaults."
          models={snapshot.pi.availableModels}
          levels={snapshot.pi.thinkingLevels}
          initialProvider={activeModel?.provider}
          initialModel={activeModel?.id}
          initialThinking={snapshot.pi.state.thinkingLevel}
          busy={busy || Boolean(snapshot.pi.state.isStreaming)}
          button="Apply now"
          onSubmit={onActive}
        />
        <ModelForm
          title="New-session defaults"
          description="Updates the allowlisted global Gemini defaults used by future sessions and scheduled jobs."
          models={snapshot.pi.availableModels}
          levels={snapshot.pi.thinkingLevels}
          initialProvider={globalDefaults.defaultProvider ?? config.effectiveDefaults.provider}
          initialModel={globalDefaults.defaultModel ?? config.effectiveDefaults.model}
          initialThinking={globalDefaults.defaultThinkingLevel ?? config.effectiveDefaults.thinkingLevel}
          busy={busy}
          button="Save defaults"
          warning={defaultWarnings || undefined}
          onSubmit={onDefaults}
        />
      </div>

      <StackFeatureSelectorCard />

      <ThemeSettingsCard />

      <div className="system-grid">
        <section className="system-section">
          <header>
            <div><span className="eyebrow">Runtime</span><h2>Dashboard services</h2></div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="button button--quiet" type="button" onClick={handleCreateShortcut}>📌 Desktop Shortcut</button>
              <button className="button button--quiet" type="button" disabled={busy || Boolean(snapshot.pi.state.isStreaming)} onClick={restart}>Restart Agent RPC</button>
            </div>
          </header>
          <div className="system-list">
            <div><span>Dashboard</span><code>v{snapshot.backend.dashboardVersion}</code></div>
            <div><span>Agent runtime</span><code>{snapshot.backend.piVersion}</code></div>
            <div><span>Node.js</span><code>{snapshot.backend.nodeVersion}</code></div>
            <div><span>Platform</span><code>{snapshot.backend.platform}</code></div>
            <div><span>Backend started</span><code>{date(snapshot.backend.startedAt)}</code></div>
          </div>
        </section>

        <section className="system-section">
          <header><div><span className="eyebrow">Current session</span><h2>Usage and context</h2></div><Chip>{snapshot.pi.state.messageCount ?? stats?.totalMessages ?? 0} messages</Chip></header>
          <div className="system-list">
            <div><span>Session</span><code>{snapshot.pi.state.sessionName ?? snapshot.pi.state.sessionId ?? '—'}</code></div>
            <div><span>Context</span><code>{context?.percent == null ? 'Awaiting usage' : `${context.percent.toFixed(1)}% · ${context.tokens ?? 0} / ${context.contextWindow ?? 0}`}</code></div>
            <div><span>Tool calls</span><code>{stats?.toolCalls ?? 0}</code></div>
            <div><span>Estimated cost</span><code>{typeof stats?.cost === 'number' ? `$${stats.cost.toFixed(4)}` : '—'}</code></div>
          </div>
        </section>

        <section className="system-section">
          <header><div><span className="eyebrow">Workspace</span><h2>Project and persistence</h2></div><Chip tone={snapshot.workspace.git.clean ? 'accent' : 'warning'}>{snapshot.workspace.git.branch ?? 'no Git'}</Chip></header>
          <div className="system-list system-list--paths">
            <div><span>Workspace</span><code>{snapshot.workspace.path}</code></div>
            <div><span>Sessions ({snapshot.persistence.sessions})</span><code>{snapshot.persistence.sessionRoot}</code></div>
            <div><span>Activity log</span><code>{snapshot.persistence.activityPath}</code></div>
          </div>
        </section>

        <section className="system-section">
          <header><div><span className="eyebrow">Configuration</span><h2>Safe settings summary</h2></div><Chip>{config.global.theme ?? 'dark'} theme</Chip></header>
          <div className="system-list">
            <div><span>Global settings</span><code>{config.globalPath}</code></div>
            <div><span>Project settings</span><code>{config.projectPath}</code></div>
            <div><span>Project trust fallback</span><code>{config.global.defaultProjectTrust ?? 'ask'}</code></div>
            <div><span>Compaction</span><code>{config.global.compactionEnabled === false ? 'disabled' : 'enabled'}</code></div>
            <div><span>Automatic retry</span><code>{config.global.retryEnabled === false ? 'disabled' : 'enabled'}</code></div>
            <div><span>Transport</span><code>{config.global.transport ?? 'auto'}</code></div>
            <div><span>Guided setup</span><button className="button button--quiet" type="button" disabled={busy} onClick={() => void onResumeOnboarding()}>Resume onboarding</button></div>
          </div>
        </section>

        <CuratedMemorySettings memory={snapshot.backend.curatedMemory} busy={busy} onSave={onCuratedMemorySave} />

        <MemoryCheckpointSettings memory={snapshot.backend.memoryCheckpoint} files={snapshot.backend.files} busy={busy} onSave={onMemorySave} onRun={onMemoryRun} onReset={onMemoryReset} />

        <RemoteAccessCard />

        <section className="system-section system-security">
          <header><div><span className="eyebrow">Security readiness</span><h2>Localhost boundary</h2></div><Chip tone={snapshot.security.authenticationEnabled ? 'accent' : 'warning'}>{snapshot.security.authenticationEnabled ? 'protected' : 'local only'}</Chip></header>
          <div className="system-readiness">
            <div className={snapshot.security.frontendExpectedOnLocalhost ? 'is-ready' : ''}><span>{snapshot.security.frontendExpectedOnLocalhost ? '✓' : '!'}</span><div><strong>Local frontend binding</strong><small>Bound to 127.0.0.1 (Local process)</small></div></div>
            <div className={snapshot.security.authenticationEnabled ? 'is-ready' : ''}><span>{snapshot.security.authenticationEnabled ? '✓' : '!'}</span><div><strong>Application authentication</strong><small>{snapshot.security.authenticationEnabled ? 'Enabled (Password active)' : 'Local only (Password required for remote)'}</small></div></div>
            <div className={snapshot.security.workspaceIsolationEnforced ? 'is-ready' : ''}><span>{snapshot.security.workspaceIsolationEnforced ? '✓' : '!'}</span><div><strong>Workspace/process isolation</strong><small>{snapshot.security.processIsolation}</small></div></div>
            <div className="is-ready"><span>✓</span><div><strong>Backend network scope</strong><small>{snapshot.security.backendNetworkScope}</small></div></div>
          </div>
        </section>
      </div>

      <section className="system-section system-errors">
        <header><div><span className="eyebrow">Diagnostics</span><h2>Recent backend errors</h2></div><Chip>{snapshot.recentErrors.length} retained</Chip></header>
        {!snapshot.recentErrors.length ? <div className="system-no-errors">No recent backend errors recorded.</div> : <div className="system-error-list">{snapshot.recentErrors.map((error) => <div key={error.id}><span>{date(error.timestamp)}</span><strong>{error.summary}</strong><code>{error.type}</code></div>)}</div>}
      </section>
    </>
  )
}

export function SystemBrowser({ revision }: { revision: string }) {
  const system = useSystemStatus(revision)
  return (
    <Panel eyebrow="Configuration and health" title="Settings & System Status" action={<button className="button button--quiet" type="button" onClick={system.refresh}>↻ Refresh status</button>} fullWidth>
      <div className="panel__body">
        {system.error && <div className="board-error">{system.error}</div>}
        {system.loading || !system.snapshot ? <div className="system-loading">Inspecting dashboard services…</div> : <SystemContent snapshot={system.snapshot} busy={system.busy} onActive={system.updateActive} onDefaults={system.updateDefaults} onCuratedMemorySave={system.updateCuratedMemory} onMemorySave={system.updateMemoryCheckpoint} onMemoryRun={system.runMemoryCheckpoint} onMemoryReset={system.resetMemoryCheckpoint} onResumeOnboarding={system.resumeOnboarding} onRestart={system.restartRpc} />}
      </div>
    </Panel>
  )
}
