import { Moon, Sun } from 'lucide-react'

import { useTheme } from './theme-provider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const targetThemeLabel = theme === 'dark' ? '浅色' : '深色'

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`切换到${targetThemeLabel}主题`}
      title={`切换到${targetThemeLabel}主题`}
      data-theme-toggle
      onClick={toggleTheme}
    >
      {theme === 'dark'
        ? <Sun aria-hidden="true" size={18} strokeWidth={1.8} />
        : <Moon aria-hidden="true" size={18} strokeWidth={1.8} />}
    </button>
  )
}
