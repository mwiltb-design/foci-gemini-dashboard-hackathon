import { useMemo, useState } from 'react'
import { apiFetch } from '../api'
import { ProviderLogin } from './ProviderLogin'

export interface OnboardingState {
  schemaVersion: 1
  completed: boolean
  dismissed: boolean
  updatedAt?: string
  userProfileEditable: boolean
  workspace: string
  appName?: string
  features?: {
    terminal?: boolean
    workers?: boolean
  }
}

interface OnboardingProps {
  initial: OnboardingState
  terminalEnabled: boolean
  workersEnabled: boolean
  authenticationEnabled: boolean
  onClose: (state: OnboardingState) => void
}

async function update(action: 'skip' | 'complete', body: Record<string, unknown> = {}): Promise<OnboardingState> {
  const response = await apiFetch('/api/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  const result = await response.json() as OnboardingState & { error?: string }
  if (!response.ok) throw new Error(result.error ?? 'Unable to update onboarding')
  return result
}

export function Onboarding({ initial, terminalEnabled, workersEnabled, authenticationEnabled, onClose }: OnboardingProps) {
  const [step, setStep] = useState(0)
  const [appName, setAppName] = useState(initial.appName || 'Foci Dashboard')
  const [authToken, setAuthToken] = useState('')
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [work, setWork] = useState('')
  const [goals, setGoals] = useState('')
  const [approved, setApproved] = useState(false)
  const [rawUserMd, setRawUserMd] = useState('')
  const [rawMemoryMd, setRawMemoryMd] = useState('')
  const [enableTerminal, setEnableTerminal] = useState(terminalEnabled)
  const [enableWorkers, setEnableWorkers] = useState(workersEnabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const profileItems = useMemo(() => [
    name.trim() ? `Preferred name: ${name.trim()}.` : '',
    location.trim() ? `Location: ${location.trim()}.` : '',
    work.trim() ? `Work or professional context: ${work.trim()}.` : '',
    goals.trim() ? `Goals or interests: ${goals.trim()}.` : '',
  ].filter(Boolean), [name, location, work, goals])

  async function skip() {
    setBusy(true); setError('')
    try { onClose(await update('skip')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to skip onboarding') }
    finally { setBusy(false) }
  }

  async function finish() {
    setBusy(true); setError('')
    try {
      const payload: Record<string, unknown> = {
        appName: appName.trim() || 'Foci Dashboard',
        authToken: authToken.trim() || undefined,
        importedUserProfile: rawUserMd.trim() || undefined,
        importedGlobalMemory: rawMemoryMd.trim() || undefined,
        features: { terminal: enableTerminal, workers: enableWorkers },
        profileItems,
        profileApproved: profileItems.length ? approved : false,
      }
      onClose(await update('complete', payload))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete onboarding') }
    finally { setBusy(false) }
  }

  return <main className="onboarding-screen">
    <section className="onboarding-card" aria-labelledby="onboarding-title">
      <header className="onboarding-header">
        <div><span className="eyebrow">{appName}</span><h1 id="onboarding-title">Set up your workspace</h1></div>
        <span>Step {step + 1} of 5</span>
      </header>
      <div className="onboarding-progress" aria-hidden="true"><i style={{ width: `${(step + 1) * 20}%` }} /></div>

      {step === 0 && <div className="onboarding-body">
        <h2>Your private project workspace</h2>
        <p>Dashboard works only inside the project folder selected during setup. Provider credentials and personal memory stay in your private background data profile.</p>
        <div className="onboarding-fields" style={{ margin: '14px 0', gap: '10px' }}>
          <label><span>Dashboard Display Name</span><input value={appName} maxLength={64} onChange={(e) => setAppName(e.target.value)} placeholder="Foci Dashboard" /></label>
          <label><span>Dashboard Access Password (Optional)</span><input type="password" value={authToken} onChange={(e) => setAuthToken(e.target.value)} placeholder="Leave blank for password-free local access" /></label>
        </div>
        <dl><div><dt>Project Workspace</dt><dd><code>{initial.workspace}</code></dd></div><div><dt>Browser sign-in</dt><dd>{authenticationEnabled || authToken ? 'Enabled' : 'Disabled for local instance'}</dd></div></dl>
        <aside>AI provider authentication uses Gemini’s supported login flow inside the next onboarding step.</aside>
      </div>}

      {step === 1 && <div className="onboarding-body">
        <h2>Sign in to an AI provider</h2>
        <p>Use the embedded Gemini console to choose a provider and complete its normal authentication flow. When Gemini confirms the login, use the finish button to return here automatically.</p>
        <ProviderLogin />
      </div>}

      {step === 2 && <div className="onboarding-body">
        <h2>Import Profile & Global Memory (Optional)</h2>
        <p>If you already have a <code>USER.md</code> or global <code>MEMORY.md</code> from another assistant or previous session, paste or write it below to import it into your profile.</p>
        <div className="onboarding-fields">
          <label><span>Import USER.md Content</span><textarea value={rawUserMd} rows={3} placeholder="# User Profile..." onChange={(e) => setRawUserMd(e.target.value)} /></label>
          <label><span>Import Global MEMORY.md Content</span><textarea value={rawMemoryMd} rows={3} placeholder="# Global Memory..." onChange={(e) => setRawMemoryMd(e.target.value)} /></label>
        </div>
        <aside>If left blank, a clean default profile will be created for you automatically.</aside>
      </div>}

      {step === 3 && <div className="onboarding-body">
        <h2>Optional user profile details</h2>
        {!initial.userProfileEditable && !rawUserMd
          ? <aside>An existing USER.md was found and preserved. Onboarding will not replace it; review it later through your normal file workflow.</aside>
          : <>
            <p>These fields are optional. Do not enter passwords, tokens, financial identifiers, medical records, or anything you do not want used as future conversation context.</p>
            <div className="onboarding-fields">
              <label><span>Preferred name</span><input value={name} maxLength={120} onChange={(event) => { setName(event.target.value); setApproved(false) }} /></label>
              <label><span>Location</span><input value={location} maxLength={120} onChange={(event) => { setLocation(event.target.value); setApproved(false) }} /></label>
              <label><span>Work or professional context</span><input value={work} maxLength={180} onChange={(event) => { setWork(event.target.value); setApproved(false) }} /></label>
              <label><span>Goals or interests</span><textarea value={goals} maxLength={220} onChange={(event) => { setGoals(event.target.value); setApproved(false) }} /></label>
            </div>
            {profileItems.length > 0 && <div className="onboarding-review"><strong>Exact USER.md facts to add</strong><ul>{profileItems.map((item) => <li key={item}>{item}</li>)}</ul><label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I reviewed and approve these personal facts.</label></div>}
          </>}
      </div>}

      {step === 4 && <div className="onboarding-body">
        <h2>Feature Modules</h2>
        <p>Choose which optional modules you would like enabled in your dashboard navigation:</p>
        <article className="onboarding-capability" style={{ cursor: 'pointer' }} onClick={() => setEnableTerminal(!enableTerminal)}>
          <div>
            <strong>Embedded Native Terminal</strong>
            <p>Integrated PowerShell / Command terminal powered by native pseudo-terminal execution.</p>
          </div>
          <input type="checkbox" checked={enableTerminal} onChange={(e) => setEnableTerminal(e.target.checked)} />
        </article>
        <article className="onboarding-capability" style={{ cursor: 'pointer' }} onClick={() => setEnableWorkers(!enableWorkers)}>
          <div>
            <strong>Sub-Agent Workers</strong>
            <p>Bounded Research, Review, and Implement delegation to a separate Gemini worker coordinator.</p>
          </div>
          <input type="checkbox" checked={enableWorkers} onChange={(e) => setEnableWorkers(e.target.checked)} />
        </article>
        <aside>Core views (Chat, Files, Sessions, Skills & Tools, Plugins, Settings) are always enabled.</aside>
      </div>}

      {error && <div className="form-error">{error}</div>}
      <footer className="onboarding-actions">
        <button className="button button--quiet" type="button" disabled={busy} onClick={() => void skip()}>Skip for now</button>
        <div>{step > 0 && <button className="button button--quiet" type="button" disabled={busy} onClick={() => setStep((value) => value - 1)}>Back</button>}{step < 4
          ? <button className="button button--primary" type="button" disabled={busy || (step === 3 && profileItems.length > 0 && !approved)} onClick={() => setStep((value) => value + 1)}>Continue</button>
          : <button className="button button--primary" type="button" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving…' : 'Finish setup'}</button>}</div>
      </footer>
    </section>
  </main>
}
