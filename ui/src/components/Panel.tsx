import type { ReactNode } from 'react'

interface PanelProps {
  eyebrow?: string
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  fullWidth?: boolean
}

export function Panel({ eyebrow, title, action, children, className = '', fullWidth = false }: PanelProps) {
  return (
    <section className={`panel ${fullWidth ? 'panel--full' : ''} ${className}`.trim()}>
      {(eyebrow || title || action) && (
        <header className="panel__header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            {title && <h1>{title}</h1>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warning' }) {
  return <span className={`chip chip--${tone}`}>{children}</span>
}
