import type { RequestOutcomeRecord } from '../../../engine/core/event-stream'

interface CoverageEdge {
  id: string
  source: string
  target: string
}

/** The ordered distinct node hops a request visited, from its state timeline. */
function nodeHops(record: RequestOutcomeRecord): string[] {
  const hops: string[] = []
  for (const transition of record.stateTimeline) {
    if (!transition.nodeId) continue
    if (hops[hops.length - 1] !== transition.nodeId) hops.push(transition.nodeId)
  }
  return hops
}

/** Edge ids a request traversed (consecutive hops matched to a topology edge). */
function edgesCoveredBy(record: RequestOutcomeRecord, edges: CoverageEdge[]): Set<string> {
  const covered = new Set<string>()
  const hops = nodeHops(record)
  for (let i = 0; i < hops.length - 1; i++) {
    const a = hops[i]
    const b = hops[i + 1]
    const edge = edges.find(
      (candidate) =>
        (candidate.source === a && candidate.target === b) ||
        (candidate.source === b && candidate.target === a)
    )
    if (edge) covered.add(edge.id)
  }
  return covered
}

/**
 * Greedy set-cover: pick the fewest requests whose paths together traverse every
 * edge that any request actually used — so a handful of dots exercises the whole
 * topology (all branches, plus wherever requests get rejected / cached / fanned
 * out). Prefers variety of terminal outcomes as a tie-break so failures and hits
 * are represented, not just the happy path. Capped at `limit` dots for legibility.
 */
export function selectCoveringRequestIds(
  outcomes: readonly RequestOutcomeRecord[],
  edges: readonly CoverageEdge[],
  limit = 8
): string[] {
  if (outcomes.length === 0) return []
  const edgeList = edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))

  const coverageByRequest = outcomes.map((record) => ({
    requestId: record.requestId,
    status: record.status,
    edges: edgesCoveredBy(record, edgeList)
  }))

  // Universe = edges some request actually traversed (ignore unreachable edges).
  const universe = new Set<string>()
  for (const entry of coverageByRequest) entry.edges.forEach((id) => universe.add(id))

  const chosen: string[] = []
  const covered = new Set<string>()
  const seenStatuses = new Set<string>()
  const remaining = [...coverageByRequest]

  while (covered.size < universe.size && chosen.length < limit && remaining.length > 0) {
    let bestIndex = -1
    let bestGain = -1
    let bestStatusBonus = -1
    for (let i = 0; i < remaining.length; i++) {
      let gain = 0
      remaining[i].edges.forEach((id) => {
        if (!covered.has(id)) gain += 1
      })
      const statusBonus = seenStatuses.has(remaining[i].status) ? 0 : 1
      if (gain > bestGain || (gain === bestGain && statusBonus > bestStatusBonus)) {
        bestGain = gain
        bestStatusBonus = statusBonus
        bestIndex = i
      }
    }
    if (bestIndex < 0 || bestGain <= 0) break
    const pick = remaining.splice(bestIndex, 1)[0]
    chosen.push(pick.requestId)
    pick.edges.forEach((id) => covered.add(id))
    seenStatuses.add(pick.status)
  }

  return chosen
}
