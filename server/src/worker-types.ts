export const WORKER_MODES = ['research', 'review', 'implement'] as const
export type WorkerMode = typeof WORKER_MODES[number]

export const WORKER_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'timed-out'] as const
export type WorkerStatus = typeof WORKER_STATUSES[number]

export interface WorkerBounds {
  timeoutMs: number
  turnLimit: number
  resultLimitBytes: number
}

export interface WorkerChangedFile {
  path: string
  state: string
}

export interface WorkerTask {
  id: string
  providerId: string
  providerName: string
  mode: WorkerMode
  prompt: string
  status: WorkerStatus
  progress: string
  turns: number
  bounds: WorkerBounds
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  sessionId?: string
  result?: string
  resultTruncated?: boolean
  error?: string
  model?: { provider: string; id: string }
  thinkingLevel?: string
  changedFiles: WorkerChangedFile[]
}

export interface WorkerProviderStatus {
  id: string
  name: string
  description: string
  kind: 'built-in' | 'external'
  status: 'ready' | 'disabled' | 'unavailable' | 'planned'
  statusLabel: string
  modes: WorkerMode[]
}

export interface WorkerRunInput {
  taskId: string
  mode: WorkerMode
  prompt: string
  bounds: WorkerBounds
  model?: { provider: string; id: string }
  thinkingLevel?: string
}

export interface WorkerRunHooks {
  onSession(sessionId: string): Promise<void> | void
  onProgress(progress: string, turns: number): Promise<void> | void
}

export interface WorkerRunOutput {
  result: string
  resultTruncated: boolean
  changedFiles: WorkerChangedFile[]
}

export interface WorkerAdapter {
  readonly provider: WorkerProviderStatus
  run(input: WorkerRunInput, hooks: WorkerRunHooks): Promise<WorkerRunOutput>
  cancel(taskId: string): Promise<void>
}
