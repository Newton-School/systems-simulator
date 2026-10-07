import type { AppendEventInput } from '../core/event-stream'
import type { CausalGraph, CausalGraphNode } from './output'

/**
 * Failure-cascade inference for the results tray's Failures tab.
 *
 * The engine does not track causality between requests, so this is an
 * inference from two things it does know for certain:
 *
 *  1. *When* each node first showed a failure signal (an injected fault, a
 *     rejection, a timeout, a circuit breaker opening), observed live from the
 *     canonical event funnel so it is not limited by event-stream retention.
 *  2. *Who calls whom* (the topology's edges).
 *
 * A node is linked to a failing dependency when it calls that dependency
 * (directly, or through pass-through nodes that showed no failures of their
 * own) and its own failures began at or after the dependency's. Everything
 * else that failed is a root cause. An injected fault is always a root cause:
 * it was caused by the scenario, not by a neighbour.
 */

export type FailureSignalKind = 'rejected' | 'timeout' | 'circuit-open'

export interface NodeFailureObservation {
  nodeId: string
  /** First injected node / broker fault (ms). */
  faultAtMs: number | null
  faultMode: string | null
  /** First failure signal of any kind (ms). */
  firstSignalAtMs: number | null
  counts: Record<FailureSignalKind, number>
  reasonCounts: Map<string, number>
  /** Signal kind of the very first failure signal, used as the effect label. */
  firstSignalKind: FailureSignalKind | null
  firstSignalReason: string | null
}

export interface CausalEdge {
  source: string
  target: string
}

function timestampToMs(value: AppendEventInput['timestampUs']): number {
  if (typeof value === 'bigint') {
    return Number(value) / 1000
  }
  if (typeof value === 'number') {
    return value / 1000
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 1000 : 0
}

function readFaultMode(payload: Record<string, unknown> | undefined): string | null {
  const spec = payload?.['failureSpec']
  if (spec && typeof spec === 'object') {
    const mode = (spec as { mode?: unknown }).mode
    if (typeof mode === 'string' && mode.length > 0) {
      return mode
    }
  }
  return null
}

/** Effect label for a node whose first failure signal had this kind / reason. */
export function failureEffectLabel(kind: FailureSignalKind, reason: string | null): string {
  if (kind === 'timeout') {
    return 'timeout_cascade'
  }
  if (kind === 'circuit-open') {
    return 'circuit_open'
  }
  if (reason === null || reason === 'capacity_exceeded' || reason === 'queue_full') {
    return 'queue_saturation'
  }
  return reason
}

export class CausalGraphRecorder {
  private readonly byNode = new Map<string, NodeFailureObservation>()

  observe(input: AppendEventInput): void {
    switch (input.type) {
      case 'node-failed':
      case 'broker-failed':
        if (input.nodeId) {
          this.recordFault(
            input.nodeId,
            input.type === 'broker-failed'
              ? 'broker_failed'
              : (readFaultMode(input.payload) ?? 'node_failed'),
            timestampToMs(input.timestampUs)
          )
        }
        return
      case 'request-rejected':
        if (input.nodeId) {
          this.recordSignal(
            input.nodeId,
            'rejected',
            input.reasonCode ?? null,
            timestampToMs(input.timestampUs)
          )
        }
        return
      case 'request-timed-out':
        if (input.nodeId) {
          this.recordSignal(
            input.nodeId,
            'timeout',
            input.reasonCode ?? null,
            timestampToMs(input.timestampUs)
          )
        }
        return
      case 'circuit-breaker-open':
        if (input.nodeId) {
          this.recordSignal(input.nodeId, 'circuit-open', null, timestampToMs(input.timestampUs))
        }
        return
      default:
        return
    }
  }

  recordFault(nodeId: string, mode: string, atMs: number): void {
    const entry = this.ensure(nodeId)
    if (entry.faultAtMs === null || atMs < entry.faultAtMs) {
      entry.faultAtMs = atMs
      entry.faultMode = mode
    }
  }

  recordSignal(nodeId: string, kind: FailureSignalKind, reason: string | null, atMs: number): void {
    const entry = this.ensure(nodeId)
    entry.counts[kind]++
    if (reason) {
      entry.reasonCounts.set(reason, (entry.reasonCounts.get(reason) ?? 0) + 1)
    }
    if (entry.firstSignalAtMs === null || atMs < entry.firstSignalAtMs) {
      entry.firstSignalAtMs = atMs
      entry.firstSignalKind = kind
      entry.firstSignalReason = reason
    }
  }

  build(edges: readonly CausalEdge[]): CausalGraph {
    return buildCausalGraph([...this.byNode.values()], edges)
  }

  private ensure(nodeId: string): NodeFailureObservation {
    let entry = this.byNode.get(nodeId)
    if (!entry) {
      entry = {
        nodeId,
        faultAtMs: null,
        faultMode: null,
        firstSignalAtMs: null,
        counts: { rejected: 0, timeout: 0, 'circuit-open': 0 },
        reasonCounts: new Map(),
        firstSignalKind: null,
        firstSignalReason: null
      }
      this.byNode.set(nodeId, entry)
    }
    return entry
  }
}

function affectedAtMs(entry: NodeFailureObservation): number {
  const fault = entry.faultAtMs ?? Number.POSITIVE_INFINITY
  const signal = entry.firstSignalAtMs ?? Number.POSITIVE_INFINITY
  return Math.min(fault, signal)
}

function dominantReason(entry: NodeFailureObservation): string | null {
  let best: string | null = null
  let bestCount = 0
  for (const [reason, count] of entry.reasonCounts) {
    if (count > bestCount || (count === bestCount && best !== null && reason < best)) {
      best = reason
      bestCount = count
    }
  }
  return best
}

function rootEventLabel(entry: NodeFailureObservation): string {
  if (entry.faultMode !== null) {
    return entry.faultMode
  }
  return entry.firstSignalKind
    ? failureEffectLabel(entry.firstSignalKind, entry.firstSignalReason)
    : 'failure'
}

/**
 * Pure builder (exported for tests). Observations with neither a fault nor a
 * signal are ignored.
 */
export function buildCausalGraph(
  observations: readonly NodeFailureObservation[],
  edges: readonly CausalEdge[]
): CausalGraph {
  const affected = observations
    .filter((entry) => entry.faultAtMs !== null || entry.firstSignalAtMs !== null)
    .sort((a, b) => {
      const delta = affectedAtMs(a) - affectedAtMs(b)
      if (delta !== 0) return delta
      // Injected faults first on a tie: they are the scenario's cause.
      const faultDelta = Number(b.faultAtMs !== null) - Number(a.faultAtMs !== null)
      if (faultDelta !== 0) return faultDelta
      return a.nodeId.localeCompare(b.nodeId)
    })

  const affectedById = new Map(affected.map((entry) => [entry.nodeId, entry]))
  const callees = new Map<string, string[]>()
  for (const edge of edges) {
    const list = callees.get(edge.source) ?? []
    list.push(edge.target)
    callees.set(edge.source, list)
  }

  const placedAt = new Map<string, number>()
  const depthById = new Map<string, number>()
  const rootCauses: CausalGraph['rootCauses'] = []
  const propagation: CausalGraph['propagation'] = []
  const nodes: CausalGraphNode[] = []

  /** Earliest already-placed failing dependency reachable through unaffected nodes. */
  const findFailingDependency = (nodeId: string, atMs: number): string | null => {
    const visited = new Set<string>([nodeId])
    const frontier = [...(callees.get(nodeId) ?? [])]
    let best: string | null = null
    let bestAt = Number.POSITIVE_INFINITY
    while (frontier.length > 0) {
      const next = frontier.shift() as string
      if (visited.has(next)) continue
      visited.add(next)
      const placed = placedAt.get(next)
      if (placed !== undefined) {
        if (
          placed <= atMs &&
          (placed < bestAt || (placed === bestAt && best !== null && next < best))
        ) {
          best = next
          bestAt = placed
        }
        continue
      }
      if (affectedById.has(next)) {
        // Failing, but later than this node: it cannot explain this node and
        // we do not look through it.
        continue
      }
      frontier.push(...(callees.get(next) ?? []))
    }
    return best
  }

  for (const entry of affected) {
    const at = affectedAtMs(entry)
    const parent = entry.faultAtMs !== null ? null : findFailingDependency(entry.nodeId, at)
    if (parent === null) {
      rootCauses.push({ nodeId: entry.nodeId, event: rootEventLabel(entry), time: at })
      depthById.set(entry.nodeId, 0)
    } else {
      propagation.push({
        from: parent,
        to: entry.nodeId,
        effect: entry.firstSignalKind
          ? failureEffectLabel(entry.firstSignalKind, entry.firstSignalReason)
          : 'failure',
        time: at
      })
      depthById.set(entry.nodeId, (depthById.get(parent) ?? 0) + 1)
    }
    placedAt.set(entry.nodeId, at)
    nodes.push({
      nodeId: entry.nodeId,
      severity: entry.faultAtMs !== null ? 'failed' : 'degraded',
      firstAffectedMs: at,
      faultMode: entry.faultMode,
      rejected: entry.counts.rejected,
      timedOut: entry.counts.timeout,
      circuitOpens: entry.counts['circuit-open'],
      dominantReason: dominantReason(entry)
    })
  }

  const firstRoot = rootCauses.length > 0 ? Math.min(...rootCauses.map((r) => r.time)) : 0
  const lastAffected = affected.length > 0 ? Math.max(...affected.map(affectedAtMs)) : 0

  return {
    rootCauses,
    propagation,
    impactSummary: {
      totalNodesAffected: affected.length,
      cascadeDepth: depthById.size > 0 ? Math.max(...depthById.values()) : 0,
      timeToFullCascade: affected.length > 0 ? Math.max(0, lastAffected - firstRoot) : 0
    },
    nodes
  }
}
