import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { Chip } from './Panel'

export type StackPreset = 'basic' | 'developer' | 'business' | 'custom'

interface SystemFeaturesPayload {
  stackPreset: StackPreset
  enabledFeatures: string[]
  allFeatures: string[]
  alwaysEnabledFeatures: string[]
  optionalFeatures: string[]
  providersEnabled: Record<string, boolean>
  showRulesEditor: boolean
}

const PRESET_DEFINITIONS: Record<'basic' | 'developer' | 'business', {
  name: string
  icon: string
  subtitle: string
  features: string[]
  providers: Record<string, boolean>
  showRulesEditor: boolean
}> = {
  basic: {
    name: 'User / Basic',
    icon: '★',
    subtitle: 'Clean & focused: Chat, Files, Terminal, and Sub-PI solo worker.',
    features: ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins', 'terminal', 'workers'],
    providers: { 'sub-pi': true, 'antigravity-cli': false, 'codex-cli': false, 'claude-cli': false },
    showRulesEditor: false,
  },
  developer: {
    name: 'Developer',
    icon: '⚡',
    subtitle: 'Full stack: Multi-agent CLIs (Antigravity & Codex), Rules Editor, & App Previewer.',
    features: ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins', 'terminal', 'workers', 'previewer'],
    providers: { 'sub-pi': true, 'antigravity-cli': true, 'codex-cli': true, 'claude-cli': false },
    showRulesEditor: true,
  },
  business: {
    name: 'Business',
    icon: '🏢',
    subtitle: 'Advanced: Full worker stack, Automations/Cron, and Business integrations.',
    features: ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins', 'terminal', 'workers', 'previewer', 'cron'],
    providers: { 'sub-pi': true, 'antigravity-cli': true, 'codex-cli': true, 'claude-cli': true },
    showRulesEditor: true,
  },
}

export function StackFeatureSelectorCard() {
  const [data, setData] = useState<SystemFeaturesPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedStatus, setSavedStatus] = useState(false)

  useEffect(() => {
    loadFeatures()
  }, [])

  async function loadFeatures() {
    try {
      const res = await apiFetch('/api/system/features')
      if (res.ok) {
        const json = await res.json() as SystemFeaturesPayload
        setData(json)
      }
    } catch {
      // Non-fatal
    }
  }

  async function saveChanges(updates: {
    stackPreset?: StackPreset
    features?: string[]
    providersEnabled?: Record<string, boolean>
    showRulesEditor?: boolean
  }) {
    if (!data) return
    setBusy(true)
    try {
      const payload = {
        stackPreset: updates.stackPreset ?? data.stackPreset,
        features: updates.features ?? data.enabledFeatures,
        providersEnabled: updates.providersEnabled ?? data.providersEnabled,
        showRulesEditor: updates.showRulesEditor !== undefined ? updates.showRulesEditor : data.showRulesEditor,
      }
      const res = await apiFetch('/api/system/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const updated = await res.json() as SystemFeaturesPayload
        setData((prev) => prev ? { ...prev, ...updated } : null)
        setSavedStatus(true)
        setTimeout(() => setSavedStatus(false), 2000)
      }
    } finally {
      setBusy(false)
    }
  }

  function handleSelectPreset(presetKey: 'basic' | 'developer' | 'business') {
    const preset = PRESET_DEFINITIONS[presetKey]
    saveChanges({
      stackPreset: presetKey,
      features: preset.features,
      providersEnabled: preset.providers,
      showRulesEditor: preset.showRulesEditor,
    })
  }

  function handleToggleFeature(featureId: string) {
    if (!data) return
    const current = new Set(data.enabledFeatures)
    if (current.has(featureId)) {
      current.delete(featureId)
    } else {
      current.add(featureId)
    }
    saveChanges({
      stackPreset: 'custom',
      features: Array.from(current),
    })
  }

  function handleToggleProvider(providerId: string) {
    if (!data) return
    const currentProviders = { ...data.providersEnabled }
    currentProviders[providerId] = !currentProviders[providerId]
    saveChanges({
      stackPreset: 'custom',
      providersEnabled: currentProviders,
    })
  }

  function handleToggleRulesEditor() {
    if (!data) return
    saveChanges({
      stackPreset: 'custom',
      showRulesEditor: !data.showRulesEditor,
    })
  }

  if (!data) return null

  const activeFeatures = new Set(data.enabledFeatures)

  return (
    <section className="system-section system-stack-selector">
      <header>
        <div>
          <span className="eyebrow">Dashboard Experience</span>
          <h2>Stack & Feature Configuration</h2>
          <p>Choose an experience preset or check the exact features and workers you want enabled.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {savedStatus && <span style={{ color: 'var(--accent)', fontSize: '11px', fontWeight: 600 }}>✓ Saved</span>}
          <Chip tone="accent">
            {data.stackPreset === 'basic' ? '★ User / Basic' : data.stackPreset === 'developer' ? '⚡ Developer' : data.stackPreset === 'business' ? '🏢 Business' : '⚙ Custom'}
          </Chip>
        </div>
      </header>

      {/* Preset Cards */}
      <div className="stack-presets-grid">
        {(Object.keys(PRESET_DEFINITIONS) as Array<'basic' | 'developer' | 'business'>).map((key) => {
          const preset = PRESET_DEFINITIONS[key]
          const isSelected = data.stackPreset === key
          return (
            <button
              key={key}
              type="button"
              className={`stack-preset-card ${isSelected ? 'is-selected' : ''}`}
              onClick={() => handleSelectPreset(key)}
              disabled={busy}
            >
              <div className="stack-preset-card__header">
                <span className="stack-preset-card__icon">{preset.icon}</span>
                <strong>{preset.name}</strong>
              </div>
              <p>{preset.subtitle}</p>
            </button>
          )
        })}
      </div>

      {/* Feature Checkboxes */}
      <div className="stack-features-container">
        {/* Group 1: Core */}
        <div className="stack-feature-group">
          <h3>Core Features (Always Active)</h3>
          <div className="stack-feature-checkboxes">
            <label className="feature-checkbox is-disabled">
              <input type="checkbox" checked disabled />
              <span><strong>Chat</strong> — Conversation & prompt execution</span>
            </label>
            <label className="feature-checkbox is-disabled">
              <input type="checkbox" checked disabled />
              <span><strong>Files & Editor</strong> — Project workspace file browser</span>
            </label>
            <label className="feature-checkbox is-disabled">
              <input type="checkbox" checked disabled />
              <span><strong>Sessions</strong> — Conversation history & catalogs</span>
            </label>
            <label className="feature-checkbox is-disabled">
              <input type="checkbox" checked disabled />
              <span><strong>Skills & Tools</strong> — Agent abilities & integrations</span>
            </label>
            <label className="feature-checkbox is-disabled">
              <input type="checkbox" checked disabled />
              <span><strong>Plugins</strong> — Installed extension ecosystem</span>
            </label>
            <label className="feature-checkbox is-disabled">
              <input type="checkbox" checked disabled />
              <span><strong>Settings</strong> — System & model configurations</span>
            </label>
          </div>
        </div>

        {/* Group 2: Developer Tools */}
        <div className="stack-feature-group">
          <h3>Developer & Preview Tools</h3>
          <div className="stack-feature-checkboxes">
            <label className="feature-checkbox">
              <input
                type="checkbox"
                checked={activeFeatures.has('terminal')}
                onChange={() => handleToggleFeature('terminal')}
                disabled={busy}
              />
              <span><strong>Native Terminal</strong> — PowerShell, Bash, CMD inside dashboard</span>
            </label>
            <label className="feature-checkbox">
              <input
                type="checkbox"
                checked={activeFeatures.has('previewer')}
                onChange={() => handleToggleFeature('previewer')}
                disabled={busy}
              />
              <span><strong>App Previewer</strong> — Live web app & HTML responsive preview</span>
            </label>
          </div>
        </div>

        {/* Group 3: Workers & Multi-Agent */}
        <div className="stack-feature-group">
          <h3>Workers & Autonomous Delegation</h3>
          <div className="stack-feature-checkboxes">
            <label className="feature-checkbox">
              <input
                type="checkbox"
                checked={activeFeatures.has('workers')}
                onChange={() => handleToggleFeature('workers')}
                disabled={busy}
              />
              <span><strong>Enable Workers Engine</strong> — Task delegation tab & coordinator</span>
            </label>

            {activeFeatures.has('workers') && (
              <div className="stack-nested-providers" style={{ paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                <label className="feature-checkbox">
                  <input
                    type="checkbox"
                    checked={data.providersEnabled['sub-pi'] ?? true}
                    onChange={() => handleToggleProvider('sub-pi')}
                    disabled={busy}
                  />
                  <span><strong>Sub-PI Worker</strong> — Built-in isolated Pi agent</span>
                </label>
                <label className="feature-checkbox">
                  <input
                    type="checkbox"
                    checked={data.providersEnabled['antigravity-cli'] ?? false}
                    onChange={() => handleToggleProvider('antigravity-cli')}
                    disabled={busy}
                  />
                  <span><strong>Antigravity CLI</strong> — Google Antigravity reasoning & research</span>
                </label>
                <label className="feature-checkbox">
                  <input
                    type="checkbox"
                    checked={data.providersEnabled['codex-cli'] ?? false}
                    onChange={() => handleToggleProvider('codex-cli')}
                    disabled={busy}
                  />
                  <span><strong>Codex CLI</strong> — OpenAI Codex TypeScript & test generation</span>
                </label>
                <label className="feature-checkbox">
                  <input
                    type="checkbox"
                    checked={data.providersEnabled['claude-cli'] ?? false}
                    onChange={() => handleToggleProvider('claude-cli')}
                    disabled={busy}
                  />
                  <span><strong>Claude CLI</strong> — Anthropic Claude documentation & code review</span>
                </label>
                <label className="feature-checkbox">
                  <input
                    type="checkbox"
                    checked={data.showRulesEditor ?? true}
                    onChange={handleToggleRulesEditor}
                    disabled={busy}
                  />
                  <span><strong>Rules & Router Markdown Editor</strong> — In-app WORKERS.md & Level 2 rule editor</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Group 4: Automations */}
        <div className="stack-feature-group">
          <h3>Automations & Business</h3>
          <div className="stack-feature-checkboxes">
            <label className="feature-checkbox">
              <input
                type="checkbox"
                checked={activeFeatures.has('cron')}
                onChange={() => handleToggleFeature('cron')}
                disabled={busy}
              />
              <span><strong>Automated Tasks & Background Cron</strong> — Scheduled recurring agent runs</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  )
}
