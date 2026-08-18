export type JsonObject = Record<string, unknown>

export interface RpcResponse extends JsonObject {
  id?: string
  type: 'response'
  command: string
  success: boolean
  data?: unknown
  error?: string
}

export interface RpcEvent extends JsonObject {
  type: string
}

export type BrowserCommand =
  | { type: 'prompt'; message: string }
  | { type: 'abort' }
  | { type: 'new_session' }
  | { type: 'switch_session'; sessionId: string }
  | { type: 'rename_session'; sessionId: string; name: string }
  | { type: 'fork_session'; sessionId: string; entryId?: string }
  | { type: 'refresh' }
  | { type: 'extension_ui_response'; id: string; value?: string; confirmed?: boolean; cancelled?: boolean }

export type ServerMessage =
  | { type: 'connection'; status: 'connected' | 'starting' | 'error'; message?: string }
  | { type: 'state'; state: unknown }
  | { type: 'history'; messages: unknown[] }
  | { type: 'sessions_changed' }
  | { type: 'workspace_changed' }
  | { type: 'skills_changed' }
  | { type: 'cron_changed' }
  | { type: 'board_changed' }
  | { type: 'event'; event: RpcEvent }
  | { type: 'command_result'; command: string; success: boolean; data?: unknown }
  | { type: 'error'; message: string }
