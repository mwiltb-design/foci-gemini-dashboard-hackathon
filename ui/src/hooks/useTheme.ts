import { useEffect, useState } from 'react'

export type ThemeId = 'obsidian' | 'midnight' | 'emerald' | 'catppuccin' | 'cyberpunk' | 'light'

export interface ThemeOption {
  id: ThemeId
  name: string
  icon: string
  accent: string
  bg: string
  panel: string
  description: string
}

export const THEMES: ThemeOption[] = [
  {
    id: 'obsidian',
    name: 'Obsidian Dark',
    icon: '🌙',
    accent: '#69d3b2',
    bg: '#101318',
    panel: '#171c23',
    description: 'Classic deep slate with crisp mint/violet accents (Default)',
  },
  {
    id: 'midnight',
    name: 'Midnight Navy',
    icon: '🌌',
    accent: '#38bdf8',
    bg: '#0b1120',
    panel: '#131f37',
    description: 'Rich deep navy with glowing cyan & azure highlights',
  },
  {
    id: 'emerald',
    name: 'Forest Emerald',
    icon: '🌲',
    accent: '#34d399',
    bg: '#0c1613',
    panel: '#162621',
    description: 'Dark botanical slate with vibrant emerald green accents',
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin Mocha',
    icon: '🌸',
    accent: '#cba6f7',
    bg: '#181825',
    panel: '#252538',
    description: 'Soft pastel modern dark with soothing lavender tones',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    icon: '⚡',
    accent: '#f43f5e',
    bg: '#050508',
    panel: '#12101c',
    description: 'High-contrast OLED black with electric pink and yellow glow',
  },
  {
    id: 'light',
    name: 'Clean Slate Light',
    icon: '☀️',
    accent: '#0d9488',
    bg: '#f8fafc',
    panel: '#ffffff',
    description: 'Crisp, high-contrast light theme optimized for daytime coding',
  },
]

export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => {
    try {
      const saved = localStorage.getItem('pi-dashboard-theme') as ThemeId
      return THEMES.some((t) => t.id === saved) ? saved : 'obsidian'
    } catch {
      return 'obsidian'
    }
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('pi-dashboard-theme', theme)
    } catch {}
  }, [theme])

  return {
    theme,
    setTheme,
    themes: THEMES,
  }
}
