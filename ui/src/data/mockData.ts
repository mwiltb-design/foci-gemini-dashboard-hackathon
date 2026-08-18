import type { NavigationItem, ViewId, ViewMeta } from '../types'

export const navigation: NavigationItem[] = [
  { id: 'chat', label: 'Chat', icon: '◈', mobilePriority: true },
  { id: 'files', label: 'Files', icon: '▣' },
  { id: 'terminal', label: 'Terminal', icon: '⌘' },
  { id: 'sessions', label: 'Sessions', icon: '◌', mobilePriority: true },
  { id: 'skills', label: 'Skills & Tools', icon: '✦' },
  { id: 'workers', label: 'Workers', icon: '⚒', mobilePriority: true },
]

export const viewMeta: Record<ViewId, ViewMeta> = {
  chat: { section: 'Conversation', title: 'Build the dashboard', eyebrow: 'Conversation' },
  files: { section: 'Project', title: 'Files', eyebrow: 'Project files' },
  terminal: { section: 'Project', title: 'Terminal', eyebrow: 'Isolated project shell' },
  sessions: { section: 'Workspace', title: 'Sessions', eyebrow: 'Conversation history' },
  skills: { section: 'Workspace', title: 'Skills & Tools', eyebrow: 'Agent capabilities' },
  workers: { section: 'Delegation', title: 'Workers', eyebrow: 'External agents' },
  settings: { section: 'System', title: 'Settings', eyebrow: 'Configuration' },
}
