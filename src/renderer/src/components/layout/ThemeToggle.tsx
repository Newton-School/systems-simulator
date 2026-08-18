import { useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import useStore from '@renderer/store/useStore'

export const ThemeToggle = () => {
  const theme = useStore((s) => s.displaySettings.theme)
  const updateDisplaySettings = useStore((s) => s.updateDisplaySettings)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark')
    } else {
      root.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <button
      onClick={() =>
        updateDisplaySettings((current) => ({
          ...current,
          theme: current.theme === 'dark' ? 'light' : 'dark'
        }))
      }
      className="
        p-2 rounded-md transition-colors
        text-nss-muted hover:text-nss-text hover:bg-nss-surface
        focus:outline-none focus:ring-2 focus:ring-nss-primary/50
      "
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}
