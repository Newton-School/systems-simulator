import type { EdgeHop, RequestPhaseRecord, RequestSpan } from '../core/events'

/**
 * Per-request phase decomposition — the "one truth" every latency view projects
 * from. A request's end-to-end latency is a sum of subtractions over its
 * timeline: each edge transit (`edgeOut − edgeIn`), each node's queue wait
 * (`serviceStart − nodeArrival`), and each node's service time. The node badge,
 * the summary tray, and the bottleneck locator are all just different sums over
 * these same contributions — they can no longer disagree, only differ, and the
 * difference is itself the diagnostic (e.g. 305ms end-to-end − 16ms node-local
 * = 289ms living on the edge).
 *
 * Pure and integer-µs: no engine state, no floats.
 */

export type PhaseKind = 'edge' | 'queue' | 'service' | 'unattributed'

export interface LatencyContribution {
  /** Stable key: edgeId, nodeId, or 'unattributed'. */
  component: string
  /** Human-facing label (e.g. "client→api" for an edge, the nodeId for a node). */
  label: string
  kind: PhaseKind
  us: bigint
}

/**
 * Decompose a request's end-to-end latency into per-component contributions.
 * The contributions sum exactly to `terminalUs − createdAtUs`: any time not
 * attributable to a captured edge hop or node span is surfaced as a single
 * `unattributed` contribution rather than silently dropped.
 */
export function decomposeLatency(
  createdAtUs: bigint,
  hops: readonly EdgeHop[],
  spans: readonly RequestSpan[],
  terminalUs: bigint
): LatencyContribution[] {
  const contributions: LatencyContribution[] = []
  let attributed = 0n

  for (const hop of hops) {
    const us = hop.edgeOutUs - hop.edgeInUs
    if (us <= 0n) continue
    contributions.push({
      component: hop.edgeId,
      label: `${hop.source}→${hop.target}`,
      kind: 'edge',
      us
    })
    attributed += us
  }

  for (const span of spans) {
    if (span.queueWait > 0n) {
      contributions.push({
        component: span.nodeId,
        label: span.nodeId,
        kind: 'queue',
        us: span.queueWait
      })
      attributed += span.queueWait
    }
    if (span.serviceTime > 0n) {
      contributions.push({
        component: span.nodeId,
        label: span.nodeId,
        kind: 'service',
        us: span.serviceTime
      })
      attributed += span.serviceTime
    }
  }

  const endToEnd = terminalUs - createdAtUs
  const residual = endToEnd - attributed
  if (residual > 0n) {
    contributions.push({
      component: 'unattributed',
      label: 'unattributed',
      kind: 'unattributed',
      us: residual
    })
  }

  return contributions
}

/**
 * Project a first-class phase record into additive latency contributions.
 * Missing timestamps simply omit that segment; any remaining time is surfaced
 * as `unattributed` rather than silently disappearing.
 */
export function decomposePhaseRecord(phaseRecord: RequestPhaseRecord): LatencyContribution[] {
  const contributions: LatencyContribution[] = []
  let attributed = 0n

  for (const edge of phaseRecord.edges) {
    if (edge.edgeOutUs === undefined) {
      continue
    }
    const us = edge.edgeOutUs - edge.edgeInUs
    if (us <= 0n) {
      continue
    }
    contributions.push({
      component: edge.edgeId,
      label: `${edge.source}→${edge.target}`,
      kind: 'edge',
      us
    })
    attributed += us
  }

  for (const node of phaseRecord.nodes) {
    if (node.serviceStartUs !== undefined) {
      const queueUs = node.serviceStartUs - node.nodeArrivalUs
      if (queueUs > 0n) {
        contributions.push({
          component: node.nodeId,
          label: node.nodeId,
          kind: 'queue',
          us: queueUs
        })
        attributed += queueUs
      }
    }

    if (node.serviceStartUs !== undefined && node.departureUs !== undefined) {
      const serviceUs = node.departureUs - node.serviceStartUs
      if (serviceUs > 0n) {
        contributions.push({
          component: node.nodeId,
          label: node.nodeId,
          kind: 'service',
          us: serviceUs
        })
        attributed += serviceUs
      }
    }
  }

  const terminalUs = phaseRecord.terminal?.timeUs
  if (terminalUs !== undefined) {
    const endToEnd = terminalUs - phaseRecord.bornAtUs
    const residual = endToEnd - attributed
    if (residual > 0n) {
      contributions.push({
        component: 'unattributed',
        label: 'unattributed',
        kind: 'unattributed',
        us: residual
      })
    }
  }

  return contributions
}

/** Total edge-transit time across all hops (µs). */
export function edgeTransitUs(hops: readonly EdgeHop[]): bigint {
  let total = 0n
  for (const hop of hops) {
    const us = hop.edgeOutUs - hop.edgeInUs
    if (us > 0n) total += us
  }
  return total
}

/** Total node-local time (queue wait + service) across all spans (µs). */
export function nodeLocalUs(spans: readonly RequestSpan[]): bigint {
  let total = 0n
  for (const span of spans) {
    total += span.queueWait + span.serviceTime
  }
  return total
}
