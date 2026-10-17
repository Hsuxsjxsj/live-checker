import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'hsu-live-theme'

const THEME_COLORS: Record<Theme, string> = {
  light: '#f6f7f5',
  dark: '#151b18',
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme(): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme | null>(readStoredTheme)
  const [systemTheme, setSystemTheme] = useState<Theme>(readSystemTheme)
  const theme = preference ?? systemTheme

  useEffect(() => {
    if (preference !== null || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [preference])

  useEffect(() => applyDocumentTheme(theme), [theme])

  const toggleTheme = useCallback(() => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setPreference(nextTheme)
    persistTheme(nextTheme)
    applyDocumentTheme(nextTheme)
  }, [theme])

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (value === null) throw new Error('THEME_PROVIDER_MISSING')
  return value
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : null
  } catch {
    return null
  }
}

function readSystemTheme(): Theme {
  if (typeof window.matchMedia !== 'function') {
    return isTheme(document.documentElement.dataset.theme)
      ? document.documentElement.dataset.theme
      : 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The selected theme still applies for this page when storage is unavailable.
  }
}

function applyDocumentTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[theme])
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}
