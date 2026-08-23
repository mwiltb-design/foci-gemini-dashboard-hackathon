export const DASHBOARD_FEATURES = [
  'chat',
  'files',
  'files-editor',
  'terminal',
  'sessions',
  'settings',
  'skills',
  'workers',
  'plugins',
  'previewer',
  'cron',
] as const

export type DashboardFeature = typeof DASHBOARD_FEATURES[number]
export type DashboardProfileName = 'core' | 'workbench'
export type DashboardStackPreset = 'basic' | 'developer' | 'business' | 'custom'

export const ALWAYS_ENABLED_FEATURES: readonly DashboardFeature[] = [
  'chat',
  'files',
  'files-editor',
  'sessions',
  'skills',
  'settings',
  'plugins',
] as const

export const OPTIONAL_FEATURES: readonly DashboardFeature[] = [
  'terminal',
  'workers',
  'previewer',
  'cron',
] as const

export const STACK_PRESETS: Record<Exclude<DashboardStackPreset, 'custom'>, DashboardFeature[]> = {
  basic: ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins', 'terminal', 'workers'],
  developer: ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins', 'terminal', 'workers', 'previewer'],
  business: ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins', 'terminal', 'workers', 'previewer', 'cron'],
}

const CORE_FEATURES: DashboardFeature[] = ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins']
const WORKBENCH_FEATURES: DashboardFeature[] = [...DASHBOARD_FEATURES]
const OPTIONAL_ADDONS: DashboardFeature[] = ['files-editor', 'terminal', 'workers', 'previewer', 'cron']

export interface DashboardProfile {
  name: DashboardProfileName
  features: DashboardFeature[]
}

export function dashboardProfile(value = process.env.PI_DASHBOARD_PROFILE, addonsValue = process.env.PI_DASHBOARD_ADDONS): DashboardProfile {
  const name = (value?.trim() || 'workbench').toLocaleLowerCase()
  if (name !== 'core' && name !== 'workbench') throw new Error('PI_DASHBOARD_PROFILE must be core or workbench')
  const features = name === 'core' ? [...CORE_FEATURES] : [...WORKBENCH_FEATURES]
  const addons = (addonsValue ?? '').split(',').map((item) => item.trim().toLocaleLowerCase()).filter(Boolean)
  for (const addon of addons) {
    if (!OPTIONAL_ADDONS.includes(addon as DashboardFeature)) throw new Error(`Unsupported dashboard add-on: ${addon}`)
    if (!features.includes(addon as DashboardFeature)) features.push(addon as DashboardFeature)
  }
  return { name, features }
}
