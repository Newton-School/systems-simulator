import type { RequestOutcomeRecord } from '../../../../engine/core/event-stream'

/** One node a traced request visited, collapsed from its state timeline. */
export interface TraceHop {
  nodeId: string
  state: string
  detail?: string
  reasonCode?: string
  arrivalMs: number
  /** The read was served by a follower with replication lag, so it may be stale. */
  maybeStale?: boolean
}

export function buildHops(record: RequestOutcomeRecord): TraceHop[] {
  const collapsed: TraceHop[] = []
  for (const transition of record.stateTimeline) {
    if (!transition.nodeId) continue
    const last = collapsed[collapsed.length - 1]
    const stale = transition.state === 'stale-read-possible'
    if (last && last.nodeId === transition.nodeId) {
      if (stale) last.maybeStale = true
      last.state = transition.state
      last.detail = transition.detail ?? last.detail
      last.reasonCode = transition.reasonCode ?? last.reasonCode
    } else {
      collapsed.push({
        nodeId: transition.nodeId,
        state: transition.state,
        detail: transition.detail ?? undefined,
        reasonCode: transition.reasonCode ?? undefined,
        arrivalMs: Number(transition.timestampUs) / 1000,
        ...(stale ? { maybeStale: true } : {})
      })
    }
  }
  return collapsed
}
