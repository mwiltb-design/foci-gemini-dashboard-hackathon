import { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatItem } from '../hooks/usePiChat'

function formatArgs(args: unknown): string {
  if (args === undefined || args === null) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

export function ChatTimeline({ items, running }: { items: ChatItem[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: running ? 'smooth' : 'auto', block: 'end' })
  }, [items, running])

  if (items.length === 0) {
    return (
      <div className="chat-empty">
        <span className="brand-mark">π</span>
        <h2>Start a Pi conversation</h2>
        <p>This session runs locally in the dashboard backend. Pi can read and modify files in the dashboard project.</p>
      </div>
    )
  }

  return (
    <div className="chat-feed" aria-live="polite">
      {items.map((item) => {
        if (item.type === 'message') {
          return (
            <article className={`message message--${item.role}`} key={item.id}>
              <small>{item.role === 'assistant' ? 'Pi' : 'You'}</small>
              {item.thinking && <details className="thinking"><summary>Thinking</summary><p>{item.thinking}</p></details>}
              <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text || (item.role === 'assistant' && running ? '…' : '')}</ReactMarkdown></div>
              {item.error && <span className="message__error">{item.error}</span>}
            </article>
          )
        }
        if (item.type === 'tool') {
          return (
            <details className={`tool-card tool-card--${item.status}`} key={item.id} open={item.status === 'running'}>
              <summary>
                <span className="tool-card__status">{item.status === 'running' ? '◌' : item.status === 'error' ? '×' : '✓'}</span>
                <span><small>Tool</small><strong>{item.name}</strong></span>
                <em>{item.status}</em>
              </summary>
              {item.args != null && <div><span className="eyebrow">Input</span><pre>{formatArgs(item.args)}</pre></div>}
              {item.output && <div><span className="eyebrow">Result</span><pre>{item.output}</pre></div>}
            </details>
          )
        }
        return <div className={`chat-notice chat-notice--${item.tone}`} key={item.id}>{item.text}</div>
      })}
      <div ref={endRef} />
    </div>
  )
}
