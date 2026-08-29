import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { request as httpRequest } from 'node:http'
import { Type } from '@sinclair/typebox'

const token = process.env.PI_DASHBOARD_WORKER_INTERNAL_TOKEN ?? ''
const port = Number(process.env.PORT ?? 4317)
const MAX_RESPONSE_BYTES = 64 * 1024
const POLL_MS = 1_000

function request(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        'x-pi-dashboard-worker-token': token,
        'content-type': 'application/json',
        'content-length': String(payload.length),
      },
      timeout: 15_000,
    }, (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) response.destroy(new Error('Worker response is too large'))
        else chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        let parsed: Record<string, unknown>
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { reject(new Error('Dashboard returned an invalid worker response')); return }
        if ((response.statusCode ?? 500) >= 400) reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'Worker request failed'))
        else resolve(parsed)
      })
    })
    req.on('timeout', () => req.destroy(new Error('Worker request timed out')))
    req.on('error', reject)
    req.end(payload)
  })
}

export default function dashboardWorkers(pi: ExtensionAPI) {
  if (!token) return
  pi.registerTool({
    name: 'dashboard_delegate_worker',
    label: 'Delegate to Worker',
    description: 'Send one bounded task to an enabled worker provider (Gemini Worker or Antigravity CLI). Consult WORKERS.md rules for provider specialization. Returns a concise result envelope; Primary agent must review all findings and changes.',
    promptSnippet: 'Delegate a narrow research, review, or implementation task to a specialized worker CLI',
    promptGuidelines: [
      'Consult WORKERS.md routing rules when choosing a provider: gemini-worker for reliable Cloud Run-safe research/review/artifacts, antigravity-cli for deep repo/cloud/build/implementation work when authenticated.',
      'Use workers for narrow, bounded tasks with concrete deliverables.',
      'Review worker results and project changes yourself before presenting them as accepted.',
      'Do not delegate work that requires interactive user approval, credentials, or recursive worker delegation.',
    ],
    parameters: Type.Object({
      providerId: Type.Optional(Type.Union([
        Type.Literal('gemini-worker'),
        Type.Literal('antigravity-cli'),
      ], { description: 'Target worker provider. Defaults to gemini-worker if omitted.' })),
      mode: Type.Union([
        Type.Literal('research'),
        Type.Literal('review'),
        Type.Literal('implement'),
      ], { description: 'Read-only research, read-only review, or project-writing implementation.' }),
      prompt: Type.String({ minLength: 1, maxLength: 12000, description: 'The complete bounded task and expected deliverable.' }),
      bounds: Type.Optional(Type.Object({
        turnLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 30, description: 'Maximum turns (1-30)' })),
        timeoutMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 30, description: 'Maximum minutes (1-30)' })),
        resultLimitKb: Type.Optional(Type.Number({ minimum: 1, maximum: 64, description: 'Maximum result size in KB (1-64)' })),
      }, { description: 'Optional execution bounds override' })),
    }),
    async execute(_toolCallId, parameters) {
      try {
        const payload = {
          providerId: parameters.providerId,
          mode: parameters.mode,
          prompt: parameters.prompt,
          ...(parameters.bounds ? {
            bounds: {
              ...(parameters.bounds.turnLimit ? { turnLimit: parameters.bounds.turnLimit } : {}),
              ...(parameters.bounds.timeoutMinutes ? { timeoutMs: parameters.bounds.timeoutMinutes * 60_000 } : {}),
              ...(parameters.bounds.resultLimitKb ? { resultLimitBytes: parameters.bounds.resultLimitKb * 1024 } : {}),
            },
          } : {}),
        }
        const created = await request('POST', '/internal/workers/tasks', payload)
        const id = String(created.id ?? '')
        if (!id) throw new Error('Dashboard did not return a worker task ID')
        let task = created
        while (task.status === 'queued' || task.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS))
          task = await request('GET', `/internal/workers/tasks/${encodeURIComponent(id)}`)
        }
        const summary = {
          taskId: id,
          status: task.status,
          sessionId: task.sessionId,
          result: task.result,
          resultTruncated: task.resultTruncated,
          changedFiles: task.changedFiles,
          error: task.error,
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          details: summary,
          isError: task.status !== 'completed',
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Worker delegation failed'
        return {
          content: [{ type: 'text', text: message }],
          details: {
            taskId: '',
            status: 'failed',
            sessionId: undefined,
            result: undefined,
            resultTruncated: false,
            changedFiles: undefined,
            error: message,
          },
          isError: true,
        }
      }
    },
  })
}
