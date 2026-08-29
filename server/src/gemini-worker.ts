import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { GoogleGenAI } from '@google/genai'
import type { WorkerAdapter, WorkerProviderStatus, WorkerRunHooks, WorkerRunInput, WorkerRunOutput } from './worker-types.js'

const DEFAULT_GEMINI_MODEL = 'gemini-3.7-flash'

interface GeminiWorkerOptions {
  workspace: string
  enabled: boolean
}

function truncate(input: string, limit: number): { text: string; truncated: boolean } {
  if (input.length <= limit) return { text: input, truncated: false }
  return { text: `${input.slice(0, Math.max(0, limit - 80))}\n\n[Truncated to worker result limit.]`, truncated: true }
}

export class GeminiWorkerAdapter implements WorkerAdapter {
  readonly provider: WorkerProviderStatus
  private readonly model: string

  constructor(private readonly options: GeminiWorkerOptions) {
    const hasKey = Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)
    this.model = process.env.GEMINI_WORKER_MODEL ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
    this.provider = {
      id: 'gemini-worker',
      name: 'Gemini Worker',
      description: 'Cloud-native bounded worker powered by Gemini for research, review, and implementation artifacts.',
      kind: 'built-in',
      status: options.enabled && hasKey ? 'ready' : options.enabled ? 'unavailable' : 'disabled',
      statusLabel: options.enabled && hasKey ? `Ready (${this.model})` : options.enabled ? 'Set GEMINI_API_KEY to enable' : 'Workers disabled',
      modes: ['research', 'review', 'implement'],
      enabled: options.enabled && hasKey,
    }
  }

  async run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput> {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini Worker')
    await hooks.onSession(`gemini-worker-${input.taskId}`)
    await hooks.onProgress('Gemini worker is analyzing the task.', 1)

    const ai = new GoogleGenAI({ apiKey })
    const prompt = [
      'You are a bounded Foci Dashboard worker in a multi-agent hackathon system.',
      `Mode: ${input.mode}`,
      `Bounds: ${input.bounds.turnLimit} turns, ${Math.round(input.bounds.timeoutMs / 1000)} seconds, ${input.bounds.resultLimitBytes} result bytes.`,
      'Return a concise, useful result with: Summary, Actions Taken, Risks/Warnings, and Next Steps.',
      input.mode === 'implement'
        ? 'For implementation mode in this Cloud MVP, produce a concrete implementation plan or patch-style artifact. Do not pretend you changed files unless the artifact says it is a proposed change.'
        : '',
      input.ruleContext ? `Worker rules:\n${input.ruleContext}` : '',
      `User task:\n${input.prompt}`,
    ].filter(Boolean).join('\n\n')

    const response = await ai.models.generateContent({ model: this.model, contents: prompt })
    await hooks.onProgress('Gemini worker is packaging the result artifact.', 2)
    const raw = response.text ?? 'Gemini worker completed without text output.'
    const limited = truncate(raw, input.bounds.resultLimitBytes)

    const artifactRel = `worker-artifacts/${input.taskId}-${input.mode}.md`
    const artifactPath = resolve(this.options.workspace, artifactRel)
    await mkdir(dirname(artifactPath), { recursive: true })
    await writeFile(artifactPath, `# Gemini Worker Artifact\n\n${raw}\n`, 'utf8')

    return {
      result: limited.text,
      resultTruncated: limited.truncated,
      changedFiles: [{ path: relative(this.options.workspace, artifactPath).replace(/\\/g, '/'), state: 'created' }],
      resultEnvelope: {
        summary: limited.text.split('\n').slice(0, 6).join('\n'),
        actionsTaken: ['Ran a bounded Gemini worker task', `Created artifact ${artifactRel}`],
        changedFiles: [{ path: artifactRel, state: 'created' }],
        warnings: limited.truncated ? ['Result was truncated for Dashboard display; full artifact was written to the workspace.'] : [],
        artifactLinks: [artifactRel],
        sessionId: `gemini-worker-${input.taskId}`,
      },
    }
  }

  async cancel(_taskId: string): Promise<void> {
    // Current Gemini SDK request cancellation is handled at coordinator timeout level for this MVP.
  }
}
