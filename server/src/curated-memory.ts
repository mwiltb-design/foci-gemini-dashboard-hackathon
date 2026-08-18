export const CURATED_MEMORY_SCHEMA_VERSION = 1

export interface CuratedMemorySettings {
  schemaVersion: 1
  globalEnabled: boolean
  projectEnabled: boolean
  skillEnabled: boolean
}

export const DEFAULT_CURATED_MEMORY_SETTINGS: CuratedMemorySettings = {
  schemaVersion: CURATED_MEMORY_SCHEMA_VERSION,
  globalEnabled: true,
  projectEnabled: true,
  skillEnabled: true,
}

export const USER_PROFILE_TEMPLATE = `# User profile

<!--
Optional stable personal context. Add facts only after the user explicitly approves them.
Do not infer or store credentials, secrets, raw conversation history, or temporary details.
-->

## Approved context

`

export const DASHBOARD_REFERENCE_MEMORY = `<!-- pi-dashboard-reference -->
## Pi Dashboard documentation

When a question concerns Pi Dashboard behavior, configuration, troubleshooting, operations, plugins, skills, tools, or workers, consult the bundled routing file at \`/opt/pi-dashboard/server/skills/dashboard-reference/SKILL.md\`. Follow its routing to read only the relevant reference file; do not preload the complete documentation set.
`

export const GLOBAL_MEMORY_TEMPLATE = `# Durable global memory

<!--
Durable cross-project collaboration patterns, environment facts, and reusable conventions.
Keep entries concise. Exclude personal facts awaiting approval, secrets, raw logs, temporary work,
and facts that are easy to rediscover.
-->

## Collaboration and environment

${DASHBOARD_REFERENCE_MEMORY}
`

export const PROJECT_MEMORY_TEMPLATE = `# Project memory

<!--
Project-only architecture, decisions, conventions, implementation facts, lessons, status, and next steps.
Do not store personal profile facts, credentials, secrets, or raw logs here.
-->

## Project context

`

export function normalizeCuratedMemorySettings(value: unknown): CuratedMemorySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CURATED_MEMORY_SETTINGS }
  const raw = value as Record<string, unknown>
  return {
    schemaVersion: CURATED_MEMORY_SCHEMA_VERSION,
    globalEnabled: typeof raw.globalEnabled === 'boolean' ? raw.globalEnabled : DEFAULT_CURATED_MEMORY_SETTINGS.globalEnabled,
    projectEnabled: typeof raw.projectEnabled === 'boolean' ? raw.projectEnabled : DEFAULT_CURATED_MEMORY_SETTINGS.projectEnabled,
    skillEnabled: typeof raw.skillEnabled === 'boolean' ? raw.skillEnabled : DEFAULT_CURATED_MEMORY_SETTINGS.skillEnabled,
  }
}
