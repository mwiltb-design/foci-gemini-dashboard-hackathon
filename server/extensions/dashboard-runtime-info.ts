import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { StringEnum } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

const outputPath = process.env.PI_DASHBOARD_RUNTIME_INFO_PATH ?? resolve(homedir(), '.pi/agent/dashboard/runtime-tools.json')

export default function dashboardRuntimeInfo(pi: ExtensionAPI) {
  let writeChain = Promise.resolve()

  pi.registerTool({
    name: 'dashboard_project_status',
    label: 'Project Status',
    description: 'Report structured progress for the Project Board card assigned in the current dashboard session. Use plan-ready for a completed user-owned plan, awaiting-approval before any action that needs the user, blocked when work cannot continue, and completed only after appropriate checks pass.',
    promptSnippet: 'Report progress, approval requests, blockers, or completion for an assigned Project Board card',
    promptGuidelines: [
      'When working in a linked Project Board session, follow the user’s latest Chat instructions even when they revise the original card plan. Use dashboard_project_status for a plan ready, approval request, blocker, or verified whole-card completion; do not mark the whole card completed after handling only one requested plan step.',
    ],
    parameters: Type.Object({
      cardId: Type.String({ description: 'Project Board card ID from the assignment prompt' }),
      status: StringEnum(['working', 'plan-ready', 'awaiting-approval', 'blocked', 'completed'] as const),
      message: Type.String({ description: 'Concise progress summary, approval question, blocker, or completion/check summary' }),
    }),
    async execute(_toolCallId, params) {
      const terminal = params.status !== 'working'
      return {
        content: [{ type: 'text', text: terminal ? `Project status recorded: ${params.status}. Stop work now.` : 'Project progress recorded.' }],
        details: { cardId: params.cardId, status: params.status, message: params.message },
        ...(terminal ? { terminate: true } : {}),
      }
    },
  })

  function capture() {
    const active = new Set(pi.getActiveTools())
    const tools = pi.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      active: active.has(tool.name),
      promptGuidelines: tool.promptGuidelines ?? [],
      parameterNames: tool.parameters && typeof tool.parameters === 'object' && 'properties' in tool.parameters
        ? Object.keys((tool.parameters as { properties?: Record<string, unknown> }).properties ?? {})
        : [],
      sourceInfo: tool.sourceInfo,
    }))
    const payload = { capturedAt: new Date().toISOString(), tools }
    writeChain = writeChain.then(async () => {
      await mkdir(dirname(outputPath), { recursive: true })
      const temporary = `${outputPath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, outputPath)
    }).catch(() => undefined)
    return writeChain
  }

  pi.on('session_start', capture)
  pi.on('session_tree', capture)
  pi.on('before_agent_start', capture)
}
