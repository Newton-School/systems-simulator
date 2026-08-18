import type { DisplaySettings } from '@renderer/types/ui'
import { DEFAULT_DISPLAY_SETTINGS } from '@renderer/types/ui'

const DISPLAY_SETTINGS_STORAGE_KEY = 'nssimulator.display-settings'
const LEGACY_THEME_STORAGE_KEY = 'theme'

function storage(): Storage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
    return null
  }

  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function loadDisplaySettings(): DisplaySettings {
  const persisted = storage()?.getItem(DISPLAY_SETTINGS_STORAGE_KEY)
  const legacyTheme = storage()?.getItem(LEGACY_THEME_STORAGE_KEY)

  if (!persisted) {
    return {
      ...DEFAULT_DISPLAY_SETTINGS,
      ...(legacyTheme === 'light' || legacyTheme === 'dark' ? { theme: legacyTheme } : {})
    }
  }

  try {
    const parsed = JSON.parse(persisted) as Partial<DisplaySettings>
    return {
      ...DEFAULT_DISPLAY_SETTINGS,
      ...parsed,
      theme:
        parsed.theme === 'light' || parsed.theme === 'dark'
          ? parsed.theme
          : legacyTheme === 'light' || legacyTheme === 'dark'
            ? legacyTheme
            : DEFAULT_DISPLAY_SETTINGS.theme
    }
  } catch {
    return DEFAULT_DISPLAY_SETTINGS
  }
}

export function persistDisplaySettings(settings: DisplaySettings): void {
  const target = storage()
  if (!target) return

  try {
    target.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    target.setItem(LEGACY_THEME_STORAGE_KEY, settings.theme)
  } catch {
    // Best-effort persistence should never crash the renderer.
  }
}
