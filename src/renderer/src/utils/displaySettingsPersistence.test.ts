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
      defaultResultsTab: 'traffic' as const,
      componentLibraryMode: 'all' as const,
      hiddenComponentLibraryTemplateIds: ['kv-store', 'redis-cache']
    }

    persistDisplaySettings(settings)

    expect(loadDisplaySettings()).toEqual(settings)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('drops malformed palette visibility values while preserving other settings', () => {
    localStorage.setItem(
      'nssimulator.display-settings',
      JSON.stringify({
        componentLibraryMode: 'unknown-mode',
        hiddenComponentLibraryTemplateIds: ['kv-store', 42, 'kv-store']
      })
    )

    expect(loadDisplaySettings()).toMatchObject({
      componentLibraryMode: 'default',
      hiddenComponentLibraryTemplateIds: ['kv-store']
    })
  })
})
