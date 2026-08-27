import { useCallback, useEffect, useRef, useState } from 'react'
import { authenticationRequired, notifyAuthenticationRequired } from '../api'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface SessionState {
  model?: { id?: string; provider?: string } | null
  thinkingLevel?: string
  isStreaming?: boolean
  sessionId?: string
  sessionName?: string
  messageCount?: number
  contextUsage?: { tokens?: number | null; contextWindow?: number; percent?: number | null }
}

export interface ChatMessageItem {
  type: 'message'
  id: string
  role: 'user' | 'assistant'
  text: string
  thinking?: string
  error?: string
}

export interface ChatToolItem {
  type: 'tool'
  id: string
  name: string
  args: unknown
  output: string
  status: 'running' | 'complete' | 'error'
}

export interface ChatNoticeItem {
  type: 'notice'
  id: string
  text: string
  tone: 'info' | 'warning' | 'error'
}

export type ChatItem = ChatMessageItem | ChatToolItem | ChatNoticeItem

export interface ExtensionUiRequest {
  type: 'extension_ui_request'
  id: string
  method: 'select' | 'confirm' | 'input' | 'editor'
  title?: string
  message?: string
  options?: string[]
  placeholder?: string
  prefill?: string
}

interface ServerEnvelope {
  type: string
  status?: string
  message?: string
  state?: SessionState
  messages?: unknown[]
  event?: Record<string, unknown>
  command?: string
  success?: boolean
  data?: unknown
}

let itemCounter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++itemCounter}`

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === 'object')
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('')
}

function thinkingFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === 'object')
    .filter((block) => block.type === 'thinking' && typeof block.thinking === 'string')
    .map((block) => block.thinking as string)
    .join('')
}

function resultText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  return textFromContent((result as Record<string, unknown>).content)
}

function historyToItems(messages: unknown[]): ChatItem[] {
  const items: ChatItem[] = []
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue
    const message = raw as Record<string, unknown>
    const role = message.role
    if (role === 'user' || role === 'assistant') {
      const text = textFromContent(message.content)
      const thinking = thinkingFromContent(message.content)
      if (text || thinking || role === 'user') {
        items.push({ type: 'message', id: nextId(String(role)), role, text, ...(thinking ? { thinking } : {}) })
      }
      if (role === 'assistant' && Array.isArray(message.content)) {
        for (const rawBlock of message.content) {
          if (!rawBlock || typeof rawBlock !== 'object') continue
          const block = rawBlock as Record<string, unknown>
          if (block.type === 'toolCall' && typeof block.id === 'string') {
            items.push({ type: 'tool', id: block.id, name: String(block.name ?? 'tool'), args: block.arguments, output: '', status: 'complete' })
          }
        }
      }
    } else if (role === 'toolResult') {
      const id = String(message.toolCallId ?? nextId('tool'))
      const existing = items.find((item): item is ChatToolItem => item.type === 'tool' && item.id === id)
      if (existing) {
        existing.output = textFromContent(message.content)
        existing.status = message.isError ? 'error' : 'complete'
      } else {
        items.push({ type: 'tool', id, name: String(message.toolName ?? 'tool'), args: null, output: textFromContent(message.content), status: message.isError ? 'error' : 'complete' })
      }
    }
  }
  return items
}

function websocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export function usePiChat() {
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [connectionError, setConnectionError] = useState('')
  const [state, setState] = useState<SessionState>({})
  const [items, setItems] = useState<ChatItem[]>([])
  const [running, setRunning] = useState(false)
  const [pendingCommand, setPendingCommand] = useState(false)
  const [uiRequest, setUiRequest] = useState<ExtensionUiRequest | null>(null)
  const [sessionsRevision, setSessionsRevision] = useState(0)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [skillsRevision, setSkillsRevision] = useState(0)
  const [cronRevision, setCronRevision] = useState(0)
  const [boardRevision, setBoardRevision] = useState(0)
  const [composerPrefill, setComposerPrefill] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number | null>(null)
  const reconnectAttempts = useRef(0)
  const currentAssistant = useRef<string | null>(null)
  const optimisticUser = useRef<{ id: string; text: string } | null>(null)
  const newSessionPrefill = useRef('')

  const appendNotice = useCallback((text: string, tone: ChatNoticeItem['tone'] = 'info') => {
    setItems((current) => [...current, { type: 'notice', id: nextId('notice'), text, tone }])
  }, [])

  const handleEvent = useCallback((event: Record<string, unknown>) => {
    switch (event.type) {
      case 'agent_start':
        setRunning(true)
        break
      case 'agent_settled':
        setRunning(false)
        setPendingCommand(false)
        currentAssistant.current = null
        optimisticUser.current = null
        break
      case 'message_start': {
        const message = event.message as Record<string, unknown> | undefined
        if (message?.role === 'user') {
          const text = textFromContent(message.content)
          if (optimisticUser.current?.text === text) optimisticUser.current = null
          else setItems((current) => [...current, { type: 'message', id: nextId('user'), role: 'user', text }])
        } else if (message?.role === 'assistant') {
          const id = nextId('assistant')
          currentAssistant.current = id
          setItems((current) => [...current, { type: 'message', id, role: 'assistant', text: '' }])
        }
        break
      }
      case 'message_update': {
        const delta = event.assistantMessageEvent as Record<string, unknown> | undefined
        const id = currentAssistant.current
        if (!delta || !id) break
        if (delta.type === 'text_delta' && typeof delta.delta === 'string') {
          setItems((current) => current.map((item) => item.type === 'message' && item.id === id ? { ...item, text: item.text + delta.delta } : item))
        } else if (delta.type === 'thinking_delta' && typeof delta.delta === 'string') {
          setItems((current) => current.map((item) => item.type === 'message' && item.id === id ? { ...item, thinking: (item.thinking ?? '') + delta.delta } : item))
        } else if (delta.type === 'error') {
          const reason = String(delta.reason ?? 'error')
          setItems((current) => current.map((item) => item.type === 'message' && item.id === id ? { ...item, error: reason === 'aborted' ? 'Stopped' : 'Response failed' } : item))
        }
        break
      }
      case 'message_end': {
        const message = event.message as Record<string, unknown> | undefined
        if (message?.role !== 'assistant') break
        const id = currentAssistant.current
        const text = textFromContent(message.content)
        const thinking = thinkingFromContent(message.content)
        setItems((current) => {
          if (!id) {
            return text || thinking
              ? [...current, { type: 'message', id: nextId('assistant'), role: 'assistant', text, ...(thinking ? { thinking } : {}) }]
              : current
          }
          if (!text && !thinking) {
            return current.filter((item) => !(item.type === 'message' && item.id === id && !item.error))
          }
          return current.map((item) => item.type === 'message' && item.id === id
            ? { ...item, text, ...(thinking ? { thinking } : { thinking: undefined }) }
            : item)
        })
        currentAssistant.current = null
        break
      }
      case 'tool_execution_start': {
        const id = String(event.toolCallId ?? nextId('tool'))
        setItems((current) => current.some((item) => item.type === 'tool' && item.id === id)
          ? current
          : [...current, { type: 'tool', id, name: String(event.toolName ?? 'tool'), args: event.args, output: '', status: 'running' }])
        break
      }
      case 'tool_execution_update': {
        const id = String(event.toolCallId ?? '')
        const output = resultText(event.partialResult)
        setItems((current) => current.map((item) => item.type === 'tool' && item.id === id ? { ...item, output } : item))
        break
      }
      case 'tool_execution_end': {
        const id = String(event.toolCallId ?? '')
        const output = resultText(event.result)
        setItems((current) => current.map((item) => item.type === 'tool' && item.id === id
          ? { ...item, output, status: event.isError ? 'error' : 'complete' }
          : item))
        break
      }
      case 'extension_ui_request': {
        const method = event.method
        if (method === 'notify') {
          appendNotice(String(event.message ?? 'Foci notification'), event.notifyType === 'error' ? 'error' : event.notifyType === 'warning' ? 'warning' : 'info')
        } else if (method === 'select' || method === 'confirm' || method === 'input' || method === 'editor') {
          setUiRequest(event as unknown as ExtensionUiRequest)
        }
        break
      }
      case 'auto_retry_start':
        appendNotice(`Retrying after an error (attempt ${String(event.attempt ?? '')})`, 'warning')
        break
      case 'compaction_start':
        appendNotice('Gemini is compacting the session context.', 'info')
        break
      case 'extension_error':
        appendNotice(String(event.error ?? 'An extension failed'), 'error')
        break
    }
  }, [appendNotice])

  useEffect(() => {
    let disposed = false

    const scheduleReconnect = () => {
      reconnectAttempts.current += 1
      const delay = Math.min(10_000, 1_000 * 2 ** Math.min(reconnectAttempts.current - 1, 4))
      reconnectTimer.current = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (disposed) return
      setConnection('connecting')
      const socket = new WebSocket(websocketUrl())
      socketRef.current = socket

      socket.addEventListener('open', () => {
        reconnectAttempts.current = 0
        setConnection('connecting')
        setConnectionError('')
      })
      socket.addEventListener('message', (messageEvent) => {
        let envelope: ServerEnvelope
        try {
          envelope = JSON.parse(String(messageEvent.data)) as ServerEnvelope
        } catch {
          setConnectionError('The backend sent an invalid message')
          return
        }

        if (envelope.type === 'connection') {
          if (envelope.status === 'error') {
            setConnection('error')
            setConnectionError(envelope.message ?? 'Foci backend failed to start')
          }
        } else if (envelope.type === 'state' && envelope.state) {
          setState(envelope.state)
          setRunning(Boolean(envelope.state.isStreaming))
        } else if (envelope.type === 'history' && envelope.messages) {
          setItems(historyToItems(envelope.messages))
          setConnection('connected')
        } else if (envelope.type === 'event' && envelope.event) {
          handleEvent(envelope.event)
        } else if (envelope.type === 'sessions_changed') {
          setSessionsRevision((revision) => revision + 1)
        } else if (envelope.type === 'workspace_changed') {
          setWorkspaceRevision((revision) => revision + 1)
        } else if (envelope.type === 'skills_changed') {
          setSkillsRevision((revision) => revision + 1)
        } else if (envelope.type === 'cron_changed') {
          setCronRevision((revision) => revision + 1)
        } else if (envelope.type === 'board_changed') {
          setBoardRevision((revision) => revision + 1)
        } else if (envelope.type === 'command_result') {
          if (envelope.command === 'fork_session' && envelope.success && envelope.data && typeof envelope.data === 'object') {
            const text = (envelope.data as Record<string, unknown>).text
            if (typeof text === 'string') setComposerPrefill(text)
          }
          if (envelope.command === 'new_session') {
            if (envelope.success && newSessionPrefill.current) setComposerPrefill(newSessionPrefill.current)
            newSessionPrefill.current = ''
          }
          setPendingCommand(false)
        } else if (envelope.type === 'error') {
          setConnectionError(envelope.message ?? 'Unknown backend error')
          appendNotice(envelope.message ?? 'Unknown backend error', 'error')
          setPendingCommand(false)
        }
      })
      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        setConnection('disconnected')
        void authenticationRequired()
          .then((required) => {
            if (disposed) return
            if (required) notifyAuthenticationRequired()
            else scheduleReconnect()
          })
          .catch(() => { if (!disposed) scheduleReconnect() })
      })
      socket.addEventListener('error', () => {
        setConnectionError('Cannot reach the local Foci backend')
      })
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current)
      socketRef.current?.close()
    }
  }, [appendNotice, handleEvent])

  const send = useCallback((payload: object): boolean => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setConnectionError('The backend is not connected')
      return false
    }
    socket.send(JSON.stringify(payload))
    return true
  }, [])

  const prompt = useCallback((message: string): boolean => {
    const accepted = send({ type: 'prompt', message })
    if (accepted) {
      const id = nextId('user')
      optimisticUser.current = { id, text: message }
      setItems((current) => [...current, { type: 'message', id, role: 'user', text: message }])
      setPendingCommand(true)
    }
    return accepted
  }, [send])

  const abort = useCallback(() => {
    if (send({ type: 'abort' })) setPendingCommand(true)
  }, [send])

  const newSession = useCallback(() => {
    if (send({ type: 'new_session' })) setPendingCommand(true)
  }, [send])

  const newSessionWithPrompt = useCallback((message: string): boolean => {
    const accepted = send({ type: 'new_session' })
    if (accepted) {
      newSessionPrefill.current = message
      setPendingCommand(true)
    }
    return accepted
  }, [send])

  const switchSession = useCallback((sessionId: string): boolean => {
    const accepted = send({ type: 'switch_session', sessionId })
    if (accepted) setPendingCommand(true)
    return accepted
  }, [send])

  const renameSession = useCallback((sessionId: string, name: string): boolean => {
    const accepted = send({ type: 'rename_session', sessionId, name })
    if (accepted) setPendingCommand(true)
    return accepted
  }, [send])

  const forkSession = useCallback((sessionId: string, entryId?: string): boolean => {
    const accepted = send({ type: 'fork_session', sessionId, ...(entryId ? { entryId } : {}) })
    if (accepted) setPendingCommand(true)
    return accepted
  }, [send])

  const clearComposerPrefill = useCallback(() => setComposerPrefill(''), [])
  const prefillComposer = useCallback((message: string) => setComposerPrefill(message), [])

  const respondToUi = useCallback((response: { value?: string; confirmed?: boolean; cancelled?: boolean }) => {
    if (!uiRequest) return
    send({ type: 'extension_ui_response', id: uiRequest.id, ...response })
    setUiRequest(null)
  }, [send, uiRequest])

  return {
    connection,
    connectionError,
    state,
    items,
    running,
    pendingCommand,
    uiRequest,
    sessionsRevision,
    workspaceRevision,
    skillsRevision,
    cronRevision,
    boardRevision,
    composerPrefill,
    prompt,
    abort,
    newSession,
    newSessionWithPrompt,
    switchSession,
    renameSession,
    forkSession,
    prefillComposer,
    clearComposerPrefill,
    respondToUi,
  }
}

export type PiChatController = ReturnType<typeof usePiChat>
