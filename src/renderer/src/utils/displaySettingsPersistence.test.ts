// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DISPLAY_SETTINGS } from '@renderer/types/ui'
import { loadDisplaySettings, persistDisplaySettings } from './displaySettingsPersistence'

describe('displaySettingsPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('falls back to the legacy theme key when no display-settings blob exists', () => {
    localStorage.setItem('theme', 'light')

    expect(loadDisplaySettings()).toEqual({
      ...DEFAULT_DISPLAY_SETTINGS,
      theme: 'light'
    })
  })

  it('round-trips persisted display settings', () => {
    const settings = {
      ...DEFAULT_DISPLAY_SETTINGS,
      theme: 'light' as const,
      defaultMetricLens: 'cost' as const,
      latencyLensPercentile: 'p99' as const,
      autoOpenSimulationTray: false,
      defaultResultsTab: 'traffic' as const
    }

    persistDisplaySettings(settings)

    expect(loadDisplaySettings()).toEqual(settings)
    expect(localStorage.getItem('theme')).toBe('light')
  })
})
