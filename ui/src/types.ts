export type ViewId =
  | 'chat'
  | 'files'
  | 'terminal'
  | 'sessions'
  | 'skills'
  | 'workers'
  | 'previewer'
  | 'settings'

export interface NavigationItem {
  id: ViewId
  label: string
  icon: string
  mobilePriority?: boolean
}

export interface PluginSummary {
  id: string
  name: string
  version: string
  dashboardVersion?: string
  description: string
  icon: string
  enabled: boolean
  frontendUrl: string
  permissions: string[]
  source: 'bundled' | 'repository'
  removable: boolean
  repository?: string
  commit?: string
  digest?: string
  rollbackAvailable: boolean
  backend: boolean
  runtimeStatus?: 'not-applicable' | 'disabled' | 'healthy' | 'unavailable' | 'version-mismatch'
  storageBytes?: number
  agentTools: Array<{ name: string; label: string; description: string; access: 'read' | 'write'; parameterNames: string[] }>
  agentSkills: Array<{ name: string; description: string; access?: 'read' | 'write' }>
  agentAccess: { read: boolean; write: boolean }
}

export interface PluginReview {
  reviewId: string
  digest: string
  repository: string
  commit: string
  plugin: Pick<PluginSummary, 'id' | 'name' | 'version' | 'dashboardVersion' | 'description' | 'icon' | 'permissions'>
  files: Array<{ path: string; size: number }>
  totalBytes: number
  expiresAt: string
  operation: 'install' | 'upgrade'
  currentVersion?: string
}

export interface ViewMeta {
  section: string
  title: string
  eyebrow: string
}
