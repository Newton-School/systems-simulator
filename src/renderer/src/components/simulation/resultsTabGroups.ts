import type { ResultsTabId } from '@renderer/types/ui'

export type ResultsTabGroupId = 'summary' | 'components' | 'requests' | 'timeline'

export interface ResultsTabGroup {
  id: ResultsTabGroupId
  label: string
  /** The existing tabs this group stacks, in the order they are drawn. */
  members: readonly ResultsTabId[]
  /** Members drawn open when the group is shown; the rest fold until asked for. */
  openByDefault: readonly ResultsTabId[]
}

/**
 * Simple shell groups the seven results tabs into four questions a learner asks: how did it
 * go, which part, which requests, and when. Every tab still exists; a group draws its members
 * one under another and folds the heavy ones.
 */
export const RESULTS_TAB_GROUPS: readonly ResultsTabGroup[] = [
  {
    id: 'summary',
    label: 'Summary',
    members: ['overview', 'bottlenecks'],
    openByDefault: ['overview', 'bottlenecks']
  },
  { id: 'components', label: 'Components', members: ['nodes'], openByDefault: ['nodes'] },
  {
    id: 'requests',
    label: 'Requests',
    members: ['failures', 'traces', 'traffic'],
    openByDefault: ['failures']
  },
  { id: 'timeline', label: 'Timeline', members: ['events'], openByDefault: ['events'] }
]

export const MEMBER_TITLES: Readonly<Record<ResultsTabId, string>> = {
  overview: 'Overview',
  bottlenecks: 'Bottlenecks',
  nodes: 'Node metrics',
  events: 'Event log',
  failures: 'Failures',
  traces: 'Traces',
  traffic: 'Traffic'
}

export function groupForTab(tab: ResultsTabId): ResultsTabGroup {
  return RESULTS_TAB_GROUPS.find((group) => group.members.includes(tab)) ?? RESULTS_TAB_GROUPS[0]
}
