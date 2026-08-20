import { useTheme } from '../hooks/useTheme'

export function ThemeSettingsCard() {
  const { theme, setTheme, themes } = useTheme()

  return (
    <section className="system-section" style={{ gridColumn: '1 / -1' }}>
      <header>
        <div>
          <span className="eyebrow" style={{ color: 'var(--accent)' }}>Aesthetic & Appearance</span>
          <h2>🎨 Color Theme Palette</h2>
        </div>
        <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Live preview · Auto-saved</span>
      </header>

      <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
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
                borderRadius: '8px',
                padding: '12px 14px',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                transition: 'all 0.15s ease',
                boxShadow: isSelected ? `0 0 10px ${t.accent}30` : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '15px' }}>{t.icon}</span>
                  <strong style={{ fontSize: '13px', color: isSelected ? t.accent : 'var(--text)' }}>
                    {t.name}
                  </strong>
                </div>
                {isSelected && (
                  <span style={{ fontSize: '10px', fontWeight: 700, color: t.accent }}>
                    ✓ Active
                  </span>
                )}
              </div>

              {/* Color preview bar */}
              <div style={{ display: 'flex', gap: '4px', height: '8px', borderRadius: '3px', overflow: 'hidden' }}>
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
    </section>
  )
}
