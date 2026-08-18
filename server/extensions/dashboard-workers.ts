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
    label: 'Delegate to Sub PI',
    description: 'Send one narrow bounded task to the built-in Sub PI worker. Returns only its concise result and saved-session reference; Primary PI must review all findings and changes.',
    promptSnippet: 'Delegate a narrow research, review, or implementation task to Sub PI when parallel context would help',
    promptGuidelines: [
      'Use Sub PI only for a narrow, bounded task with a concrete deliverable.',
      'Review Sub PI results and project changes yourself before presenting them as accepted.',
      'Do not delegate work that requires user approval, credentials, unrelated session control, or further worker delegation.',
    ],
    parameters: Type.Object({
      mode: Type.Union([Type.Literal('research'), Type.Literal('review'), Type.Literal('implement')], { description: 'Read-only research, read-only review, or project-writing implementation.' }),
      prompt: Type.String({ minLength: 1, maxLength: 12000, description: 'The complete bounded task and expected concise deliverable.' }),
    }),
    async execute(_toolCallId, parameters) {
      try {
        const created = await request('POST', '/internal/workers/tasks', parameters)
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
        const message = error instanceof Error ? error.message : 'Sub PI delegation failed'
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
