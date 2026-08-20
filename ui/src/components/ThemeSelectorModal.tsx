import { useTheme } from '../hooks/useTheme'

interface ThemeSelectorModalProps {
  isOpen: boolean
  onClose: () => void
}

export function ThemeSelectorModal({ isOpen, onClose }: ThemeSelectorModalProps) {
  const { theme, setTheme, themes } = useTheme()

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          width: '90%',
          maxWidth: '560px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🎨</span>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--text)' }}>Theme Palette</h2>
          </div>
          <button
            className="button button--quiet"
            type="button"
            onClick={onClose}
            style={{ fontSize: '14px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)' }}>
          Choose your workspace aesthetic. Changes apply instantly and persist across sessions.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginTop: '8px' }}>
          {themes.map((t) => {
            const isSelected = theme === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                style={{
                  background: t.panel,
                  border: isSelected ? `2px solid ${t.accent}` : '1px solid var(--line)',
                  borderRadius: '10px',
                  padding: '14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  position: 'relative',
                  transition: 'all 0.15s ease',
                  boxShadow: isSelected ? `0 0 12px ${t.accent}40` : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '16px' }}>{t.icon}</span>
                    <strong style={{ fontSize: '13px', color: isSelected ? t.accent : 'var(--text)' }}>
                      {t.name}
                    </strong>
                  </div>
                  {isSelected && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: t.accent }}>
                      ✓ Active
                    </span>
                  )}
                </div>

                {/* Color preview palette bar */}
                <div style={{ display: 'flex', gap: '4px', height: '10px', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ flex: 2, background: t.bg }} title="Background" />
                  <div style={{ flex: 2, background: t.panel }} title="Panel" />
                  <div style={{ flex: 1, background: t.accent }} title="Accent" />
                </div>

                <span style={{ fontSize: '11px', color: 'var(--muted)', lineHeight: '1.3' }}>
                  {t.description}
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button className="button button--primary" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
