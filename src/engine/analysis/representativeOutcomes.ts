/**
 * Synthesizes a small set of representative {@link RequestOutcomeRecord}s from an
 * analytic {@link FluidEvaluation}.
 *
 * The fluid path never creates per-request objects (that is the whole point — it
 * answers steady-state questions in O(nodes+edges) at any scale). But the canvas
 * "Show request flow" tracer is driven entirely by `output.requestOutcomes`: it
 * needs full-path records with a `stateTimeline` of node hops to animate a dot
 * travelling across the topology. Without them, clicking "Show request flow" on a
 * fluid run silently does nothing.
 *
 * So we walk the routing graph and emit one record per representative source→
 * terminal path, timed by the fluid per-node/per-edge latencies, plus (when the
 * design sheds load) one rejected record terminating at the bottleneck — so the
 * covering-set picker exercises every branch and shows a failure alongside the
 * happy path. These records are illustrative, not a ledger: the exact numbers
 * live in the SimulationOutput summary/perNode, never in these synthetic rows.
 */

import type { RequestOutcomeRecord } from '../core/event-stream'
import { classifyRequestOutcome } from '../core/requestOutcomeSemantics'
import {
  buildRequestSemanticsSnapshot,
  type RequestStateTransition,
  type RequestTimelineState
} from '../core/simulationSemantics'
import type { TopologyJSON } from '../core/types'
import { distributionMean, type FluidEvaluation } from './fluidModel'

/** Hard cap on distinct paths we enumerate, for legibility and bounded work. */
const MAX_PATHS = 24
/** Hard cap on hops per path (defensive against pathological graphs). */
const MAX_PATH_LENGTH = 32

function finiteMs(ms: number | undefined): number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** Directed adjacency over edges that actually carry flow, in topology order. */
function buildFlowAdjacency(
  topology: TopologyJSON,
  fluid: FluidEvaluation
): Map<string, { targetId: string; edgeLatencyMs: number }[]> {
  const adjacency = new Map<string, { targetId: string; edgeLatencyMs: number }[]>()
  for (const node of topology.nodes) adjacency.set(node.id, [])
  for (const edge of topology.edges) {
    if ((fluid.perEdge[edge.id]?.flowRps ?? 0) <= 0) continue
    const list = adjacency.get(edge.source)
    if (!list) continue
    const mean = distributionMean(edge.latency?.distribution)
    list.push({
      targetId: edge.target,
      edgeLatencyMs: Number.isFinite(mean) && mean > 0 ? mean : 0
    })
  }
  return adjacency
}

/** Source node the load is injected at (workload source, else a node with no inflow). */
function resolveSourceId(topology: TopologyJSON, fluid: FluidEvaluation): string | null {
  const declared = topology.workload?.sourceNodeId
  if (declared && fluid.perNode[declared]) return declared
  const hasInflow = new Set<string>()
  for (const edge of topology.edges) {
    if ((fluid.perEdge[edge.id]?.flowRps ?? 0) > 0) hasInflow.add(edge.target)
  }
  for (const node of topology.nodes) {
    if (!hasInflow.has(node.id)) return node.id
  }
  return topology.nodes[0]?.id ?? null
}

/** Depth-first enumeration of simple source→terminal paths that carry flow. */
function enumeratePaths(
  sourceId: string,
  adjacency: Map<string, { targetId: string; edgeLatencyMs: number }[]>
): { nodeIds: string[]; edgeLatencyMs: number[] }[] {
  const paths: { nodeIds: string[]; edgeLatencyMs: number[] }[] = []

  const walk = (nodeId: string, nodeIds: string[], edgeLatencyMs: number[], seen: Set<string>) => {
    if (paths.length >= MAX_PATHS) return
    const next = adjacency.get(nodeId) ?? []
    const branches = next.filter((hop) => !seen.has(hop.targetId))
    if (branches.length === 0 || nodeIds.length >= MAX_PATH_LENGTH) {
      paths.push({ nodeIds: [...nodeIds], edgeLatencyMs: [...edgeLatencyMs] })
      return
    }
    for (const hop of branches) {
      if (paths.length >= MAX_PATHS) return
      seen.add(hop.targetId)
      nodeIds.push(hop.targetId)
      edgeLatencyMs.push(hop.edgeLatencyMs)
      walk(hop.targetId, nodeIds, edgeLatencyMs, seen)
      nodeIds.pop()
      edgeLatencyMs.pop()
      seen.delete(hop.targetId)
    }
  }

  walk(sourceId, [sourceId], [], new Set([sourceId]))
  return paths
}

interface BuiltRecord {
  record: RequestOutcomeRecord
  /** Cumulative arrival time (ms) at each node in the path — for the rejected cut. */
  arrivalsMs: number[]
}

function makeRecord(
  requestId: string,
  path: { nodeIds: string[]; edgeLatencyMs: number[] },
  fluid: FluidEvaluation,
  status: 'success' | 'rejected',
  reasonCode: string | null,
  rejectAtIndex: number | null
): BuiltRecord {
  const lastIndex = rejectAtIndex ?? path.nodeIds.length - 1
  const timeline: RequestStateTransition[] = []
  const arrivalsMs: number[] = []
  let timeMs = 0

  for (let i = 0; i <= lastIndex; i++) {
    const nodeId = path.nodeIds[i]
    arrivalsMs.push(timeMs)
    const isLast = i === lastIndex
    let state: RequestTimelineState
    if (isLast) {
      state = status === 'rejected' ? 'rejected' : i === 0 ? 'generated' : 'completed'
    } else {
      state = i === 0 ? 'generated' : 'processing'
    }
    timeline.push({
      scope: 'request',
      state,
      timestampUs: String(Math.round(timeMs * 1000)),
      source: 'engine',
      nodeId,
      ...(isLast && reasonCode ? { reasonCode } : {})
    })
    // Advance by this node's service time, then the edge to the next hop.
    timeMs += finiteMs(fluid.perNode[nodeId]?.latency?.meanResponseMs)
    if (i < lastIndex) timeMs += finiteMs(path.edgeLatencyMs[i])
  }

  const classification = classifyRequestOutcome(status, reasonCode)
  const terminalNodeId = path.nodeIds[lastIndex] ?? null

  return {
    arrivalsMs,
    record: {
      requestId,
      status,
      reasonCode,
      createdAtMs: 0,
      terminalAtMs: timeMs,
      nodeId: terminalNodeId,
      attempts: 1,
      latencyMs: timeMs,
      requestType: null,
      method: null,
      host: null,
      path: null,
      operationLabel: 'representative request',
      outcomeFamily: classification.family,
      statusClass: classification.statusClass,
      statusCodeHint: classification.statusCodeHint,
      semantics: buildRequestSemanticsSnapshot(status),
      stateTimeline: timeline
    }
  }
}

/**
 * Build representative request-outcome records for an analytic run so the canvas
 * request-flow tracer has full-path traces to animate. Returns `[]` when there is
 * no flow (nothing to trace).
 */
export function buildRepresentativeOutcomes(
  topology: TopologyJSON,
  fluid: FluidEvaluation
): RequestOutcomeRecord[] {
  const sourceId = resolveSourceId(topology, fluid)
  if (!sourceId) return []

  const adjacency = buildFlowAdjacency(topology, fluid)
  const paths = enumeratePaths(sourceId, adjacency)
  if (paths.length === 0) return []

  const records: RequestOutcomeRecord[] = []
  paths.forEach((path, index) => {
    records.push(
      makeRecord(`fluid-path-${index}-success`, path, fluid, 'success', null, null).record
    )
  })

  // If the design sheds load, add one rejected trace terminating at the first
  // node on any path that drops requests, so a failure path is representable.
  if (fluid.dropRate > 0) {
    for (let p = 0; p < paths.length; p++) {
      const path = paths[p]
      const dropIndex = path.nodeIds.findIndex((nodeId) => {
        const node = fluid.perNode[nodeId]
        return node && node.offeredRps > 0 && node.droppedRps > 0
      })
      if (dropIndex >= 0) {
        const reasonCode = fluid.perNode[path.nodeIds[dropIndex]]?.overloaded
          ? 'capacity_exceeded'
          : 'node_error_rate'
        records.push(
          makeRecord(`fluid-path-${p}-rejected`, path, fluid, 'rejected', reasonCode, dropIndex)
            .record
        )
        break
      }
    }
  }

  return records
}
