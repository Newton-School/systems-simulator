import { describe, expect, it } from 'vitest'
import { searchSettings } from './settingsSearch'

describe('searchSettings', () => {
  it('finds settings across different tabs', () => {
    expect(searchSettings('latency').some((entry) => entry.tab === 'display')).toBe(true)
    expect(searchSettings('cost').some((entry) => entry.tab === 'environments')).toBe(true)
    expect(searchSettings('fault recovery').some((entry) => entry.tab === 'simulation')).toBe(true)
  })

  it('finds component-library items and categories', () => {
    const results = searchSettings('load balancer')

    expect(results.some((entry) => entry.tab === 'library')).toBe(true)
  })

  it('requires every query term to match', () => {
    expect(searchSettings('latency percentile').map((entry) => entry.id)).toContain(
      'display-percentile'
    )
    expect(searchSettings('definitely-not-a-setting')).toEqual([])
  })
})
