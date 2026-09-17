import { describe, expect, it } from 'vitest'
import { matchesScenarioSearch, type SearchableScenario } from './scenarioSearch'

const scenario: SearchableScenario = {
  title: 'Key-Based Sharding',
  description: 'Requests with the same shard key always land on the same shard.',
  badge: 'intermediate',
  subtitle: 'Hash-Routed Storage',
  diagram: 'Client -> Shard Router -> Shard A / B / C',
  focusLabel: 'Why Run It',
  focusText: 'See stable key distribution across reruns.'
}

describe('matchesScenarioSearch', () => {
  it('searches all scenario teaching metadata', () => {
    expect(matchesScenarioSearch(scenario, 'sharding')).toBe(true)
    expect(matchesScenarioSearch(scenario, 'intermediate')).toBe(true)
    expect(matchesScenarioSearch(scenario, 'stable distribution')).toBe(true)
  })

  it('supports multi-term searches and ignores casing', () => {
    expect(matchesScenarioSearch(scenario, 'HASH storage')).toBe(true)
    expect(matchesScenarioSearch(scenario, 'cache beginner')).toBe(false)
  })

  it('shows every scenario for an empty query', () => {
    expect(matchesScenarioSearch(scenario, '   ')).toBe(true)
  })
})
