import { lazy, Suspense, useEffect, useState, type ComponentType, type FormEvent } from 'react'
import appPackage from '../package.json'
import { ExtensionDialog } from './components/ExtensionDialog'
import { Sidebar } from './components/Sidebar'
import { PluginBrowser } from './components/PluginBrowser'
import { PluginManager } from './components/PluginManager'
import { Onboarding, type OnboardingState } from './components/Onboarding'
import { TerminalCommandGuide } from './components/TerminalCommandGuide'
import { Topbar } from './components/Topbar'
import { navigation, viewMeta } from './data/mockData'
import { apiFetch, AUTH_REQUIRED_EVENT } from './api'
import { usePiChat } from './hooks/usePiChat'
import { usePlugins } from './hooks/usePlugins'
import type { ViewId, ViewMeta } from './types'
import {
  ChatView,
  FilesView,
  SessionsView,
  SettingsView,
  SkillsView,
  WorkersView,
} from './views/Views'

const viewIds = new Set<ViewId>(['chat', 'files', 'terminal', 'sessions', 'skills', 'workers', 'settings'])
const TerminalView = lazy(() => import('./components/TerminalBrowser').then((module) => ({ default: module.TerminalBrowser })))

function viewFromHash(): ViewId {
  const candidate = window.location.hash.replace(/^#\/?/, '') as ViewId
  return viewIds.has(candidate) ? candidate : 'chat'
}

function pluginFromHash(): string | undefined {
  const match = window.location.hash.match(/^#\/?plugins\/([^/]+)$/)
  if (!match) return undefined
  try { return decodeURIComponent(match[1]) } catch { return undefined }
}

function pluginsPageFromHash(): boolean {
  return /^#\/?plugins\/?$/.test(window.location.hash)
}

const viewComponents: Partial<Record<ViewId, ComponentType>> = {}

type DashboardFeature = ViewId | 'files-editor' | 'plugins'

interface DashboardConfig {
  profile: 'core' | 'workbench'
  features: DashboardFeature[]
  pluginSources?: Array<'github' | 'workspace' | 'local-preview'>
}

function DashboardApp({ config }: { config: DashboardConfig }) {
  const enabledViews = new Set<ViewId>(config.features.filter((feature): feature is ViewId => viewIds.has(feature as ViewId)))
  const enabledNavigation = navigation.filter((item) => enabledViews.has(item.id))
  const [view, setView] = useState<ViewId>(() => {
    const requested = viewFromHash()
    return enabledViews.has(requested) ? requested : 'chat'
  })
  const [pluginId, setPluginId] = useState<string | undefined>(() => pluginFromHash())
  const [managedPluginId, setManagedPluginId] = useState<string>()
  const [pluginsPage, setPluginsPage] = useState(() => pluginsPageFromHash())
  const [menuOpen, setMenuOpen] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(view === 'terminal')
  const chat = usePiChat()
  const pluginRegistry = usePlugins(config.features.includes('plugins'))
  const activePlugin = pluginRegistry.plugins.find((plugin) => plugin.id === pluginId && plugin.enabled)

  useEffect(() => {
    const updateView = () => {
      const requestedPlugin = pluginFromHash()
      const requestedPluginsPage = pluginsPageFromHash()
      setPluginId(requestedPlugin)
      setPluginsPage(requestedPluginsPage)
      if (!requestedPlugin && !requestedPluginsPage) {
        const requested = viewFromHash()
        setView(enabledViews.has(requested) ? requested : 'chat')
      }
    }
    window.addEventListener('hashchange', updateView)
    return () => window.removeEventListener('hashchange', updateView)
  }, [])

  useEffect(() => {
    const requestedPlugin = pluginFromHash()
    if (pluginsPageFromHash()) {
      if (!config.features.includes('plugins')) window.location.hash = '/chat'
    } else if (requestedPlugin) {
      if (!pluginRegistry.loading && !pluginRegistry.plugins.some((plugin) => plugin.id === requestedPlugin && plugin.enabled)) window.location.hash = '/chat'
    } else if (!enabledViews.has(viewFromHash())) window.location.hash = '/chat'
  }, [config.profile, view, pluginRegistry.loading, pluginRegistry.plugins])

  useEffect(() => {
    document.title = `${pluginsPage ? 'Plugins' : activePlugin?.name ?? viewMeta[view].title} · Pi Dashboard`
    window.scrollTo({ top: 0, behavior: 'instant' })
    if (view === 'terminal' && !activePlugin && !pluginsPage) setTerminalMounted(true)
  }, [view, activePlugin, pluginsPage])

  function navigate(nextView: ViewId) {
    if (!pluginId && !pluginsPage && nextView === view) return
    window.location.hash = `/${nextView}`
  }

  function navigatePlugin(nextPluginId: string) {
    if (pluginId === nextPluginId) return
    window.location.hash = `/plugins/${encodeURIComponent(nextPluginId)}`
  }

  function navigatePluginsPage(preferredPluginId?: string) {
    if (pluginsPage) return
    setManagedPluginId(preferredPluginId)
    window.location.hash = '/plugins'
  }

  const ActiveView = viewComponents[view]
  const mobileNavigation = enabledNavigation.filter((item) => item.mobilePriority)
  const modelId = chat.state.model?.id
  const topbarMeta: ViewMeta = pluginsPage
    ? { section: 'Extensions', title: 'Plugins', eyebrow: 'Plugin management' }
    : activePlugin
      ? { section: 'Plugins', title: activePlugin.name, eyebrow: 'Installed plugin' }
      : viewMeta[view]

  return (
    <div className="app-shell">
      <Sidebar
        currentView={view}
        currentPluginId={activePlugin?.id}
        currentPluginsPage={pluginsPage}
        navigation={enabledNavigation}
        plugins={pluginRegistry.plugins}
        pluginsError={pluginRegistry.error}
        showPlugins={config.features.includes('plugins')}
        open={menuOpen}
        backendConnected={chat.connection === 'connected'}
        model={modelId}
        version={appPackage.version}
        onNavigate={navigate}
        onNavigatePlugin={navigatePlugin}
        onManagePlugins={navigatePluginsPage}
        onClose={() => setMenuOpen(false)}
      />
      <main className={`main-content${!pluginsPage && !activePlugin && view === 'chat' ? ' main-content--chat' : ''}`}>
        <Topbar meta={topbarMeta} model={modelId} thinkingLevel={chat.state.thinkingLevel} onOpenMenu={() => setMenuOpen(true)} />
        <div className={`workspace workspace--${pluginsPage ? 'plugin-manager' : activePlugin ? 'plugin' : view}`}>
          {(terminalMounted || view === 'terminal') && <div className={`persistent-terminal${view === 'terminal' && !activePlugin && !pluginsPage ? '' : ' persistent-terminal--hidden'}`} aria-hidden={view !== 'terminal' || Boolean(activePlugin) || pluginsPage}>
            <Suspense fallback={<div className="panel panel--full"><div className="panel__body">Loading terminal…</div></div>}><TerminalView /></Suspense>
          </div>}
          {pluginsPage
            ? <PluginManager
                plugins={pluginRegistry.plugins}
                loading={pluginRegistry.loading}
                registryError={pluginRegistry.error}
                workspaceSourceEnabled={config.pluginSources?.includes('workspace') === true}
                localPreviewEnabled={config.pluginSources?.includes('local-preview') === true}
                preferredPluginId={managedPluginId}
                onReview={pluginRegistry.reviewRepository}
                onInstall={pluginRegistry.install}
                onSetEnabled={pluginRegistry.setEnabled}
                onSetAgentAccess={pluginRegistry.setAgentAccess}
                onRollback={pluginRegistry.rollback}
                onRemove={pluginRegistry.remove}
                onOpen={navigatePlugin}
                onCreateWithPi={(prompt) => { if (chat.newSessionWithPrompt(prompt)) navigate('chat') }}
              />
            : activePlugin
            ? <PluginBrowser
                plugin={activePlugin}
                onDisable={async () => { await pluginRegistry.setEnabled(activePlugin.id, false); window.location.hash = '/chat' }}
                onManage={() => navigatePluginsPage(activePlugin.id)}
                onOpenChatSession={(sessionId) => { if (chat.switchSession(sessionId)) navigate('chat') }}
              />
            : view === 'chat'
            ? <ChatView chat={chat} />
            : view === 'files'
              ? <FilesView workspaceRevision={chat.workspaceRevision} editable={config.features.includes('files-editor')} />
              : view === 'terminal'
                ? null
              : view === 'sessions'
                    ? <SessionsView chat={chat} onOpenChat={() => navigate('chat')} />
                    : view === 'skills'
                      ? <SkillsView
                          revision={chat.skillsRevision}
                          plugins={pluginRegistry.plugins}
                          onCreateWithPi={(prompt) => {
                            const started = chat.newSessionWithPrompt(prompt)
                            if (started) navigate('chat')
                            return started
                          }}
                        />
                      : view === 'settings'
                    ? <SettingsView revision={`${chat.connection}:${chat.state.model?.provider ?? ''}:${chat.state.model?.id ?? ''}:${chat.state.thinkingLevel ?? ''}:${chat.sessionsRevision}`} />
                    : view === 'workers'
                      ? <WorkersView onOpenSession={(sessionId) => { if (chat.switchSession(sessionId)) navigate('chat') }} />
                    : ActiveView && <ActiveView />}
          {!activePlugin && !pluginsPage && view === 'terminal' && <TerminalCommandGuide />}
        </div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileNavigation.map((item) => (
          <button className={!activePlugin && !pluginsPage && view === item.id ? 'is-active' : ''} type="button" key={item.id} onClick={() => navigate(item.id)}>
            <span>{item.icon}</span>{item.label}
          </button>
        ))}
        <button type="button" onClick={() => setMenuOpen(true)}><span>☰</span>More</button>
      </nav>
      {chat.uiRequest && <ExtensionDialog request={chat.uiRequest} onRespond={chat.respondToUi} />}
    </div>
  )
}

function ConfiguredDashboard({ authenticationEnabled }: { authenticationEnabled: boolean }) {
  const [config, setConfig] = useState<DashboardConfig | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([apiFetch('/api/config'), apiFetch('/api/onboarding')])
      .then(async ([configResponse, onboardingResponse]) => {
        const configBody = await configResponse.json() as DashboardConfig & { error?: string }
        const onboardingBody = await onboardingResponse.json() as OnboardingState & { error?: string }
        if (!configResponse.ok) throw new Error(configBody.error ?? 'Unable to load dashboard profile')
        if (!onboardingResponse.ok) throw new Error(onboardingBody.error ?? 'Unable to load onboarding status')
        setConfig(configBody)
        setOnboarding(onboardingBody)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load dashboard profile'))
  }, [])

  if (error) return <main className="auth-screen"><div className="auth-card"><h1>Dashboard unavailable</h1><p>{error}</p></div></main>
  if (!config || !onboarding) return <main className="auth-screen"><div className="auth-card">Loading workspace…</div></main>
  if (!onboarding.completed && !onboarding.dismissed) return <Onboarding initial={onboarding} terminalEnabled={config.features.includes('terminal')} workersEnabled={config.features.includes('workers')} authenticationEnabled={authenticationEnabled} onClose={setOnboarding} />
  return <DashboardApp config={config} />
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ token }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Unable to sign in')
      onAuthenticated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  return <main className="auth-screen"><form className="auth-card" onSubmit={login}>
    <span className="eyebrow">Pi Dashboard</span>
    <h1>Sign in</h1>
    <p>Enter the dashboard access token configured for this server.</p>
    <label><span>Access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" autoFocus /></label>
    {error && <div className="form-error">{error}</div>}
    <button className="button button--primary" type="submit" disabled={busy || !token}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form></main>
}

export default function App() {
  const [auth, setAuth] = useState<{ loading: boolean; enabled: boolean; authenticated: boolean; error?: string }>({ loading: true, enabled: false, authenticated: false })

  useEffect(() => {
    const requireAuthentication = () => setAuth((current) => ({ ...current, loading: false, enabled: true, authenticated: false, error: undefined }))
    window.addEventListener(AUTH_REQUIRED_EVENT, requireAuthentication)

    let attempts = 0
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/status', { credentials: 'same-origin' })
        const text = await response.text()
        let data: { enabled?: boolean; authenticated?: boolean; error?: string } = {}
        try {
          data = text ? JSON.parse(text) : {}
        } catch {
          if (attempts < 5) {
            attempts++
            setTimeout(checkAuth, 500)
            return
          }
          throw new Error('Server returned invalid response')
        }
        if (!response.ok) throw new Error(data.error ?? 'Unable to check authentication')
        setAuth({ loading: false, enabled: data.enabled === true, authenticated: data.authenticated === true })
      } catch (reason) {
        if (attempts < 5) {
          attempts++
          setTimeout(checkAuth, 500)
          return
        }
        setAuth({ loading: false, enabled: false, authenticated: false, error: reason instanceof Error ? reason.message : 'Unable to connect to backend' })
      }
    }

    checkAuth()
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, requireAuthentication)
  }, [])

  if (auth.loading) return <main className="auth-screen"><div className="auth-card">Loading dashboard…</div></main>
  if (auth.error) return <main className="auth-screen"><div className="auth-card"><h1>Dashboard unavailable</h1><p>{auth.error}</p></div></main>
  if (auth.enabled && !auth.authenticated) return <LoginScreen onAuthenticated={() => setAuth((current) => ({ ...current, authenticated: true }))} />
  return <ConfiguredDashboard authenticationEnabled={auth.enabled} />
}
