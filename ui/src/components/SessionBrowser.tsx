import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { PiChatController } from '../hooks/usePiChat'
import { useSessions, type SessionSummary, type SessionTimelineItem } from '../hooks/useSessions'
import { Chip, Panel } from './Panel'

function contextTokens(tokens?: number): string {
  if (tokens == null) return 'Context unavailable'
  return `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)} tokens of context`
}

function dateTime(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

function SessionTimeline({ items, onFork }: { items: SessionTimelineItem[]; onFork: (entryId: string) => void }) {
  if (items.length === 0) return <div className="session-empty">This session has no messages yet.</div>
  return (
    <div className="session-timeline">
      {items.map((item) => {
        if (item.kind === 'message') {
          return (
            <article className={`session-message session-message--${item.role}`} key={item.id}>
              <header>
                <span>{item.role === 'assistant' ? 'Pi' : 'You'}</span>
                <time>{dateTime(item.timestamp)}</time>
              </header>
              {item.thinking && <details><summary>Thinking</summary><p>{item.thinking}</p></details>}
              <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown></div>
              {item.role === 'user' && item.entryId && (
                <button className="session-message__fork" type="button" onClick={() => onFork(item.entryId!)}>↗ Fork from here</button>
              )}
            </article>
          )
        }
        if (item.kind === 'tool') {
          return (
            <details className={`session-tool ${item.isError ? 'is-error' : ''}`} key={item.id}>
              <summary><span>{item.isError ? '×' : '✓'}</span><strong>{item.name}</strong><em>{item.isError ? 'error' : 'complete'}</em></summary>
              {item.args != null && <pre>{JSON.stringify(item.args, null, 2)}</pre>}
              {item.output && <pre>{item.output}</pre>}
            </details>
          )
        }
        return <div className="session-notice" key={item.id}>{item.noticeType.replace('_', ' ')} · {item.text}</div>
      })}
    </div>
  )
}

interface SessionBrowserProps {
  chat: PiChatController
  onOpenChat: () => void
}

export function SessionBrowser({ chat, onOpenChat }: SessionBrowserProps) {
  const browser = useSessions(chat.sessionsRevision)
  const [showArchived, setShowArchived] = useState(false)
  const listedSessions: SessionSummary[] = showArchived ? browser.archivedSessions : browser.filtered
  const selected = [...browser.sessions, ...browser.archivedSessions].find((session) => session.id === browser.selectedId)
  const totalMessages = browser.sessions.reduce((sum, session) => sum + session.messageCount, 0)
  const totalTools = browser.sessions.reduce((sum, session) => sum + session.toolCallCount, 0)
  const busy = chat.running || chat.pendingCommand || chat.connection !== 'connected'

  function openSession() {
    if (!selected) return
    if (selected.id !== browser.currentSessionId && !chat.switchSession(selected.id)) return
    onOpenChat()
  }

  function newSession() {
    if (busy || !window.confirm('Start a new Pi session? The current session will remain saved.')) return
    chat.newSession()
    onOpenChat()
  }

  function renameSession() {
    if (!selected || busy) return
    const name = window.prompt('Session name', selected.name)?.trim()
    if (name && name !== selected.name) chat.renameSession(selected.id, name)
  }

  function duplicateSession() {
    if (!selected || busy || !window.confirm(`Create a separate copy of “${selected.name}”?`)) return
    if (chat.forkSession(selected.id)) onOpenChat()
  }

  function forkFrom(entryId: string) {
    if (!selected || selected.archived || busy || !window.confirm('Fork this session from the selected message? The message will be placed in the Chat composer for review.')) return
    if (chat.forkSession(selected.id, entryId)) onOpenChat()
  }

  async function archiveSession() {
    if (!selected || selected.id === browser.currentSessionId || !window.confirm(`Archive “${selected.name}” from the Dashboard list? Its Pi transcript will be kept.`)) return
    try {
      await browser.setArchived(selected.id, true)
      browser.setSelectedId(browser.sessions.find((session) => session.id !== selected.id)?.id)
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Unable to archive session') }
  }

  async function restoreSession() {
    if (!selected) return
    try {
      await browser.setArchived(selected.id, false)
      setShowArchived(false)
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Unable to restore session') }
  }

  return (
    <Panel eyebrow="Conversation history" title="Sessions" action={<button className="button button--quiet" type="button" onClick={newSession} disabled={busy}>＋ New session</button>} fullWidth>
      <div className="panel__body">
        <div className="metrics">
          <div className="metric"><b>{String(browser.sessions.length).padStart(2, '0')}</b><span>Saved sessions</span></div>
          <div className="metric"><b>{totalMessages}</b><span>Messages</span></div>
          <div className="metric"><b>{totalTools}</b><span>Tool calls</span></div>
        </div>

        {browser.error && <div className="connection-banner">{browser.error}</div>}
        <div className="session-browser">
          <section className="session-list-pane" aria-label="Saved sessions">
            <label className="session-search">
              <span className="sr-only">Search sessions</span>
              <input value={browser.query} onChange={(event) => browser.setQuery(event.target.value)} placeholder="Search sessions…" />
            </label>
            <div className="session-list__controls">
              <button className={`button button--quiet ${showArchived ? 'is-active' : ''}`} type="button" onClick={() => setShowArchived((current) => !current)}>
                {showArchived ? 'Show saved' : `Archived (${browser.archivedSessions.length})`}
              </button>
              {!showArchived && <small>Sessions inactive for 30 days are archived automatically.</small>}
            </div>
            <div className="session-list">
              {browser.loading && <div className="session-empty">Loading sessions…</div>}
              {!browser.loading && listedSessions.length === 0 && <div className="session-empty">{showArchived ? 'No archived sessions.' : 'No matching sessions.'}</div>}
              {listedSessions.map((session) => (
                <button className={`session-row ${browser.selectedId === session.id ? 'is-selected' : ''}`} type="button" key={session.id} onClick={() => browser.setSelectedId(session.id)}>
                  <span className="session-row__title">{session.name}</span>
                  <span className="session-row__meta">
                    {session.id === browser.currentSessionId && <Chip tone="accent">active</Chip>}
                    <time>{dateTime(session.updatedAt)}</time>
                  </span>
                  <span className="session-row__stats">{session.messageCount} messages · {session.toolCallCount} tools{session.errorCount ? ` · ${session.errorCount} errors` : ''}</span>
                  <span className="session-row__context">{contextTokens(session.contextTokens)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="session-detail-pane" aria-label="Selected session">
            {!selected || !browser.detail ? <div className="session-empty">Select a session to inspect it.</div> : (
              <>
                <header className="session-detail-head">
                  <div>
                    <span className="eyebrow">{selected.id === browser.currentSessionId ? 'Active session' : 'Saved session'}</span>
                    <h2>{selected.name}</h2>
                    <p>{selected.model ?? 'No model activity'} · created {dateTime(selected.createdAt)}</p>
                  </div>
                  <div className="session-actions">
                    {selected.archived
                      ? <button className="button button--primary" type="button" onClick={() => void restoreSession()}>Restore</button>
                      : <><button className="button button--primary" type="button" onClick={openSession} disabled={busy}>{selected.id === browser.currentSessionId ? 'Open Chat' : 'Resume'}</button><button className="button button--quiet" type="button" onClick={renameSession} disabled={busy}>Rename</button><button className="button button--quiet" type="button" onClick={duplicateSession} disabled={busy}>Duplicate</button>{selected.id !== browser.currentSessionId && <button className="button button--quiet" type="button" onClick={() => void archiveSession()} disabled={busy}>Archive</button>}</>}
                  </div>
                </header>
                <SessionTimeline items={browser.detail.timeline} onFork={forkFrom} />
              </>
            )}
          </section>
        </div>
      </div>
    </Panel>
  )
}
