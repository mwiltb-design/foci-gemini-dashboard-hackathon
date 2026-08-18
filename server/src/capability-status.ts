import type { DashboardProfileName } from './profile.js'

export interface OptionalCapabilityStatus {
  id: 'terminal' | 'workers'
  name: string
  description: string
  enabled: boolean
  status: 'disabled' | 'ready' | 'unavailable'
  statusLabel: string
  management: 'host-configuration'
  restartRequired: boolean
  dataPolicy: string
  windowsCommand: string
  unixCommand: string
}

export function terminalCapabilityStatus(profile: DashboardProfileName, enabled: boolean, socketReady: boolean): OptionalCapabilityStatus {
  const status = !enabled ? 'disabled' : socketReady ? 'ready' : 'unavailable'
  return {
    id: 'terminal',
    name: 'Isolated Project Linux Terminal',
    description: 'Offline project-only shell with no PI state, provider credentials, Docker socket, unrelated host folders, or network access.',
    enabled,
    status,
    statusLabel: status === 'ready'
      ? 'Enabled and service available'
      : status === 'unavailable'
        ? 'Enabled, but the terminal service is unavailable'
        : `Disabled in the ${profile} profile`,
    management: 'host-configuration',
    restartRequired: true,
    dataPolicy: 'Disabling stops the service and preserves project files. Terminal processes and scrollback are ephemeral.',
    windowsCommand: '.\\scripts\\configure-features.ps1',
    unixCommand: './scripts/configure-features.sh',
  }
}

export function workersCapabilityStatus(profile: DashboardProfileName, enabled: boolean, rpcReady: boolean): OptionalCapabilityStatus {
  const status = !enabled ? 'disabled' : rpcReady ? 'ready' : 'unavailable'
  return {
    id: 'workers',
    name: 'Workers',
    description: 'Bounded delegation to a separate Sub PI session with Research, Review, and Implement modes.',
    enabled,
    status,
    statusLabel: status === 'ready'
      ? 'Enabled; Sub PI runtime available'
      : status === 'unavailable'
        ? 'Enabled, but the Pi runtime is unavailable'
        : `Disabled in the ${profile} profile`,
    management: 'host-configuration',
    restartRequired: true,
    dataPolicy: 'Disabling prevents new work and preserves saved task history and inspectable Pi sessions.',
    windowsCommand: '.\\scripts\\configure-features.ps1',
    unixCommand: './scripts/configure-features.sh',
  }
}
