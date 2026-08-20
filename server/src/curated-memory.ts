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

export const USER_PROFILE_TEMPLATE = `# User Profile (USER.md)

<!--
Facts about the user. The AI MUST ask permission before modifying this file.
-->

## Personal Context & Background
- **Name:** 
- **Location:** 
- **Role / Background:** 

## User-Defined Skills & Strengths
- 

## Interests & Long-Term Goals
- 
`

export const DASHBOARD_REFERENCE_MEMORY = `<!-- pi-dashboard-reference -->
## Pi Dashboard documentation

When a question concerns Pi Dashboard behavior, configuration, troubleshooting, operations, plugins, skills, tools, or workers, consult the bundled routing file in the dashboard reference skill. Follow its routing to read only the relevant reference file; do not preload the complete documentation set.
`

export const GLOBAL_MEMORY_TEMPLATE = `# Global Collaboration Memory (MEMORY.md)

<!--
Cross-project communication preferences, interaction habits, and universal rules.
Maintained collaboratively and refined during session checkpoints.
-->

## Communication Preferences
- When a question is asked, ALWAYS answer it first and stop. Never jump into coding before answering.
- Explain commands and walk through steps; use a friendly and clear tone.
- Target Windows PowerShell for terminal commands.
- Prefer Python for automation scripts and Markdown for documentation.

## Universal Development Conventions
- Isolate Python dependencies using virtual environments (\`.venv\`).
- Document script inputs, outputs, and requirements at the top of files.
- Keep terminal commands safe and explain destructive actions before running.
`

export const PROJECT_MEMORY_TEMPLATE = `# Project Technical Memory (MEMORY.md)

<!--
Living technical blueprint for this workspace. Ingested at the start of every session.
Heavily curated, updated, and pruned by the AI during checkpoints.
-->

## Architecture & Tech Stack
- **Framework / Language:** 
- **Directory Layout:** 

## Key Technical Decisions
- 

## Active Technical State & Milestones
- 
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
