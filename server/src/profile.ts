export const DASHBOARD_FEATURES = ['chat', 'files', 'files-editor', 'terminal', 'sessions', 'settings', 'skills', 'workers', 'plugins'] as const
type RetiredBuiltinFeature = 'preview' | 'cron' | 'board'
export type DashboardFeature = typeof DASHBOARD_FEATURES[number] | RetiredBuiltinFeature
export type DashboardProfileName = 'core' | 'workbench'

const CORE_FEATURES: DashboardFeature[] = ['chat', 'files', 'files-editor', 'sessions', 'skills', 'settings', 'plugins']
const WORKBENCH_FEATURES: DashboardFeature[] = [...DASHBOARD_FEATURES]
// Keep files-editor accepted for compatibility with existing installations where it was optional.
const OPTIONAL_ADDONS: DashboardFeature[] = ['files-editor', 'terminal', 'workers']

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
