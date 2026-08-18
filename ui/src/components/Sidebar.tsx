import { useState } from 'react'
import type { NavigationItem, PluginSummary, ViewId } from '../types'

interface SidebarProps {
  currentView: ViewId
  currentPluginId?: string
  currentPluginsPage?: boolean
  navigation: NavigationItem[]
  plugins: PluginSummary[]
  pluginsError?: string
  showPlugins: boolean
  open: boolean
  backendConnected: boolean
  model?: string
  version: string
  onNavigate: (view: ViewId) => void
  onNavigatePlugin: (id: string) => void
  onManagePlugins: () => void
  onClose: () => void
}

export function Sidebar({ currentView, currentPluginId, currentPluginsPage, navigation, plugins, pluginsError, showPlugins, open, backendConnected, model, version, onNavigate, onNavigatePlugin, onManagePlugins, onClose }: SidebarProps) {
  const [pluginsOpen, setPluginsOpen] = useState(true)
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled)

  function navigate(view: ViewId) {
    onNavigate(view)
    onClose()
  }

  function navigatePlugin(id: string) {
    onNavigatePlugin(id)
    onClose()
  }

  return (
    <>
      <button
        className={`sidebar-backdrop ${open ? 'is-visible' : ''}`}
        aria-label="Close navigation"
        type="button"
        onClick={onClose}
      />
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="brand-mark">π</span>
          <span>PI DASHBOARD</span>
          <button className="sidebar__close" type="button" aria-label="Close navigation" onClick={onClose}>×</button>
        </div>

        <span className="nav-label">Workspace</span>
        <nav className="nav-list">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={!currentPluginId && !currentPluginsPage && currentView === item.id ? 'is-active' : ''}
              type="button"
              aria-current={!currentPluginId && !currentPluginsPage && currentView === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <span className="nav-list__icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        {showPlugins && <><span className="nav-label">Extensions</span>
        <div className="plugins">
          <div className={`plugins__header${currentPluginsPage ? ' is-active' : ''}`}>
            <button className="plugins__manage" type="button" onClick={() => { onManagePlugins(); onClose() }}>＋ Plugins</button>
            <button className="plugins__toggle" type="button" aria-label="Toggle installed plugins" aria-expanded={pluginsOpen} onClick={() => setPluginsOpen((value) => !value)}>{pluginsOpen ? '⌃' : '⌄'}</button>
          </div>
          {pluginsOpen && (
            <div className="plugins__list">
              {enabledPlugins.map((plugin) => (
                <div className={`plugin-nav-item${currentPluginId === plugin.id ? ' is-active' : ''}`} key={plugin.id}>
                  <button className="plugin-nav-item__link" type="button" onClick={() => navigatePlugin(plugin.id)}>
                    <span>{plugin.icon}</span>{plugin.name}
                  </button>
                </div>
              ))}
              {enabledPlugins.length === 0 && !pluginsError && <span>No plugins enabled</span>}
              {pluginsError && <small className="plugins__error">{pluginsError}</small>}
              <button className="plugins__add" type="button" onClick={() => { onManagePlugins(); onClose() }}>Manage and add plugins ›</button>
            </div>
          )}
        </div></>}

        <div className="system-status">
          <span className="nav-label">System</span>
          <div><span><i className={`status-dot ${backendConnected ? 'status-dot--ready' : 'status-dot--preview'}`} />{backendConnected ? 'Pi online' : 'Connecting'}</span><span>local</span></div>
          <div><span>Model</span><span className="truncate">{model ?? '—'}</span></div>
          <button type="button" onClick={() => navigate('settings')} className={!currentPluginId && !currentPluginsPage && currentView === 'settings' ? 'is-active' : ''}>
            <span>⚙ Settings</span><span>›</span>
          </button>
          <div><span>Version</span><span>{version}</span></div>
        </div>
      </aside>
    </>
  )
}
