import { describe, expect, it } from 'vitest'
import type { ResultsTabId } from '@renderer/types/ui'
import { groupForTab, RESULTS_TAB_GROUPS } from './resultsTabGroups'

const ALL_TABS: ResultsTabId[] = [
  'overview',
  'bottlenecks',
  'nodes',
  'events',
  'failures',
  'traces',
  'traffic'
]

describe('results tab groups', () => {
  it('places every existing tab in exactly one group', () => {
    for (const tab of ALL_TABS) {
      expect(RESULTS_TAB_GROUPS.filter((group) => group.members.includes(tab))).toHaveLength(1)
    }
  })

  it('only opens members that belong to the group, and at least one', () => {
    for (const group of RESULTS_TAB_GROUPS) {
      expect(group.openByDefault.length).toBeGreaterThan(0)
      for (const tab of group.openByDefault) expect(group.members).toContain(tab)
    }
  })

  it('finds the group for a tab, so debug-from-event-log lands on Requests', () => {
    expect(groupForTab('traces').id).toBe('requests')
    expect(groupForTab('events').id).toBe('timeline')
  })
})
