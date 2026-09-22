/**
 * Analytic (fluid / rate-based) evaluation of a topology.
 *
 * The discrete-event engine (see `engine.ts`) schedules one event per request.
 * At flash-sale scale — "up to 1,000,000 requests per second" — that is tens of
 * millions of heap operations for a few seconds of simulated time, which does not
 * finish and never needed to: the questions asked at that scale ("did you add
 * enough servers to carry the load within an 80% headroom budget?") are answered
 * by steady-state *rates*, not by watching individual requests.
 *
 * This module treats traffic as a continuous flow. It propagates an offered
 * request rate from the source node through the routing graph, clamps each node's
 * throughput at its service capacity, and reports utilization, served/dropped rate
 * and a headroom verdict — all in O(nodes + edges), for any offered rate. It is a
 * pure function of the topology, so it is deterministic and cheap to test.
 *
 * It intentionally does NOT model per-request behaviours (retries, circuit
 * breakers, queue-jitter rejections, traits). Those need the discrete-event
 * engine, which stays the source of truth at loads small enough to simulate. The
 * two paths are reconciled by `shouldUseFluidModel` / `estimateDiscreteEventCount`:
 * simulate when it is cheap and rich behaviour matters, compute when it is not.
 *
 * Scale-invariance note: per-node utilization ρ = λ / capacity is exactly the same
 * whether you run the true rate or a proportionally scaled-down rate, which is why
 * the fluid result at 1,000,000 rps agrees with a discrete-event run at a scaled
 * 1,000 rps on utilization (verified in the tests). Absolute-count-dependent
 * effects (K-bounded loss, Erlang wait probability) are deliberately out of scope
 * here — see the roadmap for the optional Erlang latency tier.
 */

import type {
  ComponentNode,
  DistributionConfig,
  EdgeDefinition,
  TopologyJSON,
  WorkloadProfile
} from '../core/types'
import { deriveNodeConcurrency } from '../nodes/resourceDerivation'
import { approxResponsePercentileMs, mmcLatency } from './queueingLatency'
import { resolveStopCondition } from '../core/stopCondition'

/**
 * Component types that forward traffic without a service bottleneck of their own.
 *
 * All load-balancer / router variants belong here: they distribute the offered
 * load across their downstreams rather than serving it themselves, so modelling
 * them with a finite `c / serviceTime` capacity turns a single balancer into a
 * spurious bottleneck (e.g. an L7 balancer capping a 1,000,000 rps flash sale at
 * its own 640K derivation, then reporting 156% self-utilization). The generic
 * `load-balancer` was already treated this way; the typed variants must match.
 */
const PASSTHROUGH_TYPES = new Set<string>([
  'load-balancer',
  'load-balancer-l7',
  'load-balancer-l4',
  'ingress-controller',
  'api-gateway',
  'reverse-proxy',
  'cdn',
  'client',
  'user',
  'users'
])

/** Default headroom target: keep every node at or below 80% utilization. */
export const DEFAULT_TARGET_UTILIZATION = 0.8

/** Per-node steady-state result under the fluid model. */
export interface FluidNodeResult {
  nodeId: string
  label: string
  /** Offered request rate arriving at this node (req/s). */
  offeredRps: number
  /** Maximum request rate this node can serve (req/s); `Infinity` for passthrough nodes. */
  capacityRps: number
  /** Request rate actually served = min(offered, capacity). */
  servedRps: number
  /** Request rate shed because offered exceeded capacity. */
  droppedRps: number
  /** offeredRps / capacityRps. `0` for a passthrough (infinite-capacity) node. */
  utilization: number
  /** True when the node is asked for more than it can serve (utilization > 1). */
  overloaded: boolean
  /**
   * Closed-form M/M/c latency for this node's offered load, or `null` for a
   * passthrough node (no service queue). Means are `Infinity` when ρ ≥ 1.
   */
  latency: {
    /** Erlang-C probability an arrival must queue. */
    waitProbability: number
    meanWaitMs: number
    meanResponseMs: number
    /** Approximate response-time percentiles (exponential-from-mean). */
    p50Ms: number
    p95Ms: number
    p99Ms: number
  } | null
}

export type HeadroomTier = 'pass' | 'no-headroom' | 'fail'

export interface FluidHeadroomVerdict {
  /** The headroom target every node should stay at or below (e.g. 0.8). */
  targetUtilization: number
  /** The highest utilization across all capacity-bound nodes. */
  maxUtilization: number
  /**
   * `pass`        — every node ≤ target (full headroom).
   * `no-headroom` — busiest node in (target, 1]: stable but no safety margin.
   * `fail`        — busiest node > 1: sustained dropping.
   */
  tier: HeadroomTier
  /** Partial-credit score in [0, 1]: 1 at/under target, linearly down to 0 at 100%. */
  score: number
  /** The node driving `maxUtilization`, or `null` when no capacity-bound node exists. */
  bottleneckNodeId: string | null
  detail: string
}

/** Per-edge steady-state flow under the fluid model. */
export interface FluidEdgeResult {
  edgeId: string
  sourceNodeId: string
  targetNodeId: string
  /** Request rate crossing this edge (req/s), after upstream capacity clamp and edge loss/amp. */
  flowRps: number
}

export interface FluidEvaluation {
  perNode: Record<string, FluidNodeResult>
  /** Per-edge request flow (req/s crossing each edge). */
  perEdge: Record<string, FluidEdgeResult>
  /** Total offered rate injected at the source (req/s). */
  offeredRps: number
  /** Total rate served by the terminal (sink) nodes (req/s). */
  servedRps: number
  /** Total rate dropped anywhere in the graph (req/s). */
  droppedRps: number
  /** droppedRps / offeredRps, or 0 when nothing was offered. */
  dropRate: number
  headroom: FluidHeadroomVerdict
  /** Always true — a fluid evaluation reports steady state by construction. */
  reachedSteadyState: true
}

export interface FluidModelOptions {
  /** Headroom target; defaults to {@link DEFAULT_TARGET_UTILIZATION}. */
  targetUtilization?: number
  /**
   * Offered rate override (req/s). When omitted, the peak of the workload
   * profile is used (see {@link peakOfferedRps}).
   */
  offeredRps?: number
}

/**
 * Mean of a distribution, in whatever unit its parameters are expressed
 * (here: milliseconds of service time). Returns `NaN` when the mean is not
 * defined by simple parameters, so callers can fall back.
 */
export function distributionMean(dist: DistributionConfig | undefined): number {
  if (!dist) return NaN
  switch (dist.type) {
    case 'constant':
    case 'deterministic':
      return dist.value
    case 'exponential':
      return dist.lambda > 0 ? 1 / dist.lambda : NaN
    case 'normal':
      return dist.mean
    case 'uniform':
      return (dist.min + dist.max) / 2
    case 'log-normal':
      return Math.exp(dist.mu + (dist.sigma * dist.sigma) / 2)
    case 'poisson':
      return dist.lambda
    case 'gamma':
      return dist.shape * dist.scale
    case 'weibull':
      // E[X] = scale · Γ(1 + 1/shape); Γ via Lanczos would be overkill here — the
      // engine's service times are rarely Weibull, so approximate with scale.
      return dist.scale
    case 'binomial':
      return dist.n * dist.p
    case 'beta':
      return dist.alpha / (dist.alpha + dist.beta)
    case 'pareto':
      return dist.shape > 1 ? (dist.shape * dist.scale) / (dist.shape - 1) : NaN
    case 'empirical':
      return dist.samples.length > 0
        ? dist.samples.reduce((a, b) => a + b, 0) / dist.samples.length
        : NaN
    case 'mixture':
      return dist.components.reduce(
        (sum, c) => sum + c.weight * distributionMean(c.distribution),
        0
      )
    default: {
      const never: never = dist
      return never
    }
  }
}

/**
 * Maximum request rate (req/s) a node can serve.
 *
 * Precedence:
 *   1. an authored capacity constant — `config.capacityRps` — but ONLY when the
 *      node also carries `config.capacityAuthored === true`. This is the gate: a
 *      capacity constant is a *given* an author declares (e.g. "each server handles
 *      100,000 rps"), never something a student can type in build mode. Without the
 *      flag the value is ignored, so a raw `capacityRps` a student somehow set
 *      cannot short-circuit the honest derivation.
 *   2. derived from the queueing model: effective concurrency `c` divided by the
 *      mean service time, i.e. `c / serviceTimeSeconds` — the real, un-gameable
 *      capacity a chosen instance produces.
 *   3. `Infinity` for passthrough components (load balancers, gateways, CDNs, the
 *      client/source), which forward without a service bottleneck.
 */
export function nodeCapacityRps(node: ComponentNode): number {
  const authored = node.config?.capacityRps
  if (
    node.config?.capacityAuthored === true &&
    typeof authored === 'number' &&
    Number.isFinite(authored) &&
    authored > 0
  ) {
    return authored
  }

  // Passthrough components (load balancers, gateways, CDNs, the client/source)
  // forward load rather than serving it, so they have no service bottleneck of
  // their own — even though they may carry a nominal service time. This must be
  // checked BEFORE the queueing derivation below, otherwise a balancer's service
  // time would give it a finite `c / serviceTime` capacity and make it a spurious
  // bottleneck. An explicit authored capacity (above) still wins.
  if (PASSTHROUGH_TYPES.has(node.type)) {
    return Number.POSITIVE_INFINITY
  }

  const serviceMs = distributionMean(node.processing?.distribution)
  if (Number.isFinite(serviceMs) && serviceMs > 0) {
    const { effectiveC } = deriveNodeConcurrency(node)
    const serviceSec = serviceMs / 1000
    return effectiveC / serviceSec
  }

  // No service model and not a known passthrough: treat as passthrough rather
  // than as a zero-capacity black hole, so unconfigured scaffolds do not report
  // spurious 100% drops.
  return Number.POSITIVE_INFINITY
}

/**
 * The (server count `c`, per-server service rate `μ` rps) an M/M/c latency model
 * needs for a node, or `null` for an infinite-capacity passthrough (no queue).
 *
 * `c` is the node's derived concurrency; `μ` is chosen so `c·μ` equals the node's
 * capacity, whether that capacity came from an authored `capacityRps` or from the
 * queueing derivation — keeping latency and throughput consistent.
 */
export function nodeServiceProfile(node: ComponentNode): { servers: number; muRps: number } | null {
  const capacity = nodeCapacityRps(node)
  if (!Number.isFinite(capacity)) return null
  const servers = Math.max(1, deriveNodeConcurrency(node).effectiveC)
  return { servers, muRps: capacity / servers }
}

/** Peak offered rate implied by a workload profile (the worst case a design must survive). */
export function peakOfferedRps(workload: WorkloadProfile | undefined): number {
  if (!workload) return 0
  const base = workload.baseRps
  switch (workload.pattern) {
    case 'bursty':
      return workload.bursty?.burstRps ?? base * 5
    case 'spike':
      return workload.spike?.spikeRps ?? base
    case 'sawtooth':
      return workload.sawtooth?.peakRps ?? base
    case 'diurnal': {
      const mults = workload.diurnal?.hourlyMultipliers
      return mults && mults.length > 0 ? base * Math.max(...mults) : base
    }
    default:
      return base
  }
}

interface FlowGraph {
  outgoing: Map<string, EdgeDefinition[]>
  incoming: Map<string, EdgeDefinition[]>
  nodesById: Map<string, ComponentNode>
}

function buildGraph(topology: TopologyJSON): FlowGraph {
  const outgoing = new Map<string, EdgeDefinition[]>()
  const incoming = new Map<string, EdgeDefinition[]>()
  const nodesById = new Map<string, ComponentNode>()
  for (const node of topology.nodes) {
    nodesById.set(node.id, node)
    outgoing.set(node.id, [])
    incoming.set(node.id, [])
  }
  for (const edge of topology.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue
    outgoing.get(edge.source)!.push(edge)
    incoming.get(edge.target)!.push(edge)
  }
  return { outgoing, incoming, nodesById }
}

/**
 * Propagates offered load from the source through the graph, clamping each node
 * at its capacity. Uses fixed-point relaxation so cycles (retries, feedback) do
 * not loop forever; a DAG converges in one pass, and the iteration cap bounds the
 * rest. Loss on an edge (`errorRate` / `packetLossRate`) and fan-out
 * amplification are applied to the flow crossing the edge.
 */
function propagate(
  graph: FlowGraph,
  sourceId: string,
  offeredRps: number
): Map<string, { offered: number; served: number }> {
  const nodeIds = [...graph.nodesById.keys()]
  const state = new Map<string, { offered: number; served: number }>()
  for (const id of nodeIds) state.set(id, { offered: 0, served: 0 })

  const capacityOf = (id: string): number => nodeCapacityRps(graph.nodesById.get(id)!)

  // Relaxation: recompute each node's offered load from its upstreams' served
  // load until the numbers stop moving. Capped so a pathological cycle can't hang.
  const MAX_ITERATIONS = nodeIds.length + 8
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false
    for (const id of nodeIds) {
      const incomingOffered =
        id === sourceId
          ? offeredRps
          : graph.incoming.get(id)!.reduce((sum, edge) => {
              const upstream = state.get(edge.source)!
              const share = edgeShare(graph, edge)
              const survive = (1 - edge.packetLossRate) * (1 - edge.errorRate)
              const amp = edge.fanoutFactor && edge.fanoutFactor > 1 ? edge.fanoutFactor : 1
              return sum + upstream.served * share * survive * amp
            }, 0)
      const cur = state.get(id)!
      const cap = capacityOf(id)
      const served = Math.min(incomingOffered, cap)
      if (Math.abs(incomingOffered - cur.offered) > 1e-6 || Math.abs(served - cur.served) > 1e-6) {
        changed = true
      }
      cur.offered = incomingOffered
      cur.served = served
    }
    if (!changed) break
  }
  return state
}

/** Fraction of a node's served flow that leaves over `edge` (weighted routing, default even). */
function edgeShare(graph: FlowGraph, edge: EdgeDefinition): number {
  const siblings = graph.outgoing.get(edge.source)!
  const total = siblings.reduce((sum, e) => sum + (e.weight ?? 1), 0)
  if (total <= 0) return 0
  return (edge.weight ?? 1) / total
}

function scoreHeadroom(
  maxUtilization: number,
  target: number,
  bottleneckNodeId: string | null
): FluidHeadroomVerdict {
  let tier: HeadroomTier
  let score: number
  if (maxUtilization <= target) {
    tier = 'pass'
    score = 1
  } else if (maxUtilization <= 1) {
    tier = 'no-headroom'
    // Linear partial credit from 1 (at target) down to 0 (at 100%).
    score = Math.max(0, (1 - maxUtilization) / (1 - target))
  } else {
    tier = 'fail'
    score = 0
  }

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const detail =
    tier === 'pass'
      ? `Busiest node at ${pct(maxUtilization)}, within the ${pct(target)} headroom budget.`
      : tier === 'no-headroom'
        ? `Busiest node at ${pct(maxUtilization)} — stable but over the ${pct(
            target
          )} budget, no burst headroom.`
        : `Busiest node at ${pct(maxUtilization)} — over capacity, dropping requests.`

  return { targetUtilization: target, maxUtilization, tier, score, bottleneckNodeId, detail }
}

/**
 * Evaluate a topology analytically. See the module header for what this does and
 * does not model.
 */
export function evaluateFluidModel(
  topology: TopologyJSON,
  options: FluidModelOptions = {}
): FluidEvaluation {
  const target = options.targetUtilization ?? DEFAULT_TARGET_UTILIZATION
  const offeredRps = options.offeredRps ?? peakOfferedRps(topology.workload)
  const sourceId = topology.workload?.sourceNodeId ?? topology.nodes[0]?.id ?? ''

  const graph = buildGraph(topology)
  const flow = propagate(graph, sourceId, offeredRps)

  const perNode: Record<string, FluidNodeResult> = {}
  let totalDropped = 0
  let maxUtilization = 0
  let bottleneckNodeId: string | null = null

  for (const node of topology.nodes) {
    const f = flow.get(node.id)!
    const cap = nodeCapacityRps(node)
    const served = f.served
    const dropped = Math.max(0, f.offered - served)
    const utilization = Number.isFinite(cap) && cap > 0 ? f.offered / cap : 0
    totalDropped += dropped

    if (Number.isFinite(cap) && utilization > maxUtilization) {
      maxUtilization = utilization
      bottleneckNodeId = node.id
    }

    const profile = nodeServiceProfile(node)
    let latency: FluidNodeResult['latency'] = null
    if (profile) {
      const l = mmcLatency(f.offered, profile.servers, profile.muRps)
      latency = {
        waitProbability: l.waitProbability,
        meanWaitMs: l.meanWaitMs,
        meanResponseMs: l.meanResponseMs,
        p50Ms: approxResponsePercentileMs(l.meanResponseMs, 0.5),
        p95Ms: approxResponsePercentileMs(l.meanResponseMs, 0.95),
        p99Ms: approxResponsePercentileMs(l.meanResponseMs, 0.99)
      }
    }

    perNode[node.id] = {
      nodeId: node.id,
      label: node.label,
      offeredRps: f.offered,
      capacityRps: cap,
      servedRps: served,
      droppedRps: dropped,
      utilization,
      overloaded: Number.isFinite(cap) && utilization > 1,
      latency
    }
  }

  // Rate that exits the system = served by sink nodes (no outgoing edges).
  const servedRps = topology.nodes
    .filter((n) => (graph.outgoing.get(n.id)?.length ?? 0) === 0)
    .reduce((sum, n) => sum + perNode[n.id]!.servedRps, 0)

  // Per-edge flow: the upstream's served rate, split by this edge's routing
  // share, after edge loss and fan-out amplification — the same terms the
  // propagation used, recorded here for the representative-traffic generator.
  const perEdge: Record<string, FluidEdgeResult> = {}
  for (const edge of topology.edges) {
    const upstream = perNode[edge.source]
    if (!upstream) continue
    const share = edgeShare(graph, edge)
    const survive = (1 - edge.packetLossRate) * (1 - edge.errorRate)
    const amp = edge.fanoutFactor && edge.fanoutFactor > 1 ? edge.fanoutFactor : 1
    perEdge[edge.id] = {
      edgeId: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      flowRps: upstream.servedRps * share * survive * amp
    }
  }

  return {
    perNode,
    perEdge,
    offeredRps,
    servedRps,
    droppedRps: totalDropped,
    dropRate: offeredRps > 0 ? totalDropped / offeredRps : 0,
    headroom: scoreHeadroom(maxUtilization, target, bottleneckNodeId),
    reachedSteadyState: true
  }
}

/**
 * Rough upper bound on how many discrete events a full simulation would process:
 * (arrival rate) × (simulated seconds) × (edges per request path ≈ node count).
 * Used to decide whether to simulate or compute.
 */
export function estimateDiscreteEventCount(topology: TopologyJSON): number {
  const rps = peakOfferedRps(topology.workload)
  const stop = resolveStopCondition(topology)
  const hops = Math.max(1, topology.nodes.length)
  // Request-budget mode bounds arrivals at exactly `maxRequests`; otherwise it is
  // rate × the (effective) run window.
  const arrivals =
    stop.maxRequests !== null ? stop.maxRequests : rps * (stop.effectiveDurationMs / 1000)
  return arrivals * hops
}

/** Default ceiling on simulated events before the fluid path takes over. */
export const DEFAULT_MAX_SIMULATED_EVENTS = 2_000_000

/**
 * Whether the analytic path should be used instead of the discrete-event engine.
 * `true` when the estimated event count exceeds `maxSimulatedEvents` (the load is
 * too big to simulate faithfully in reasonable time).
 */
export function shouldUseFluidModel(
  topology: TopologyJSON,
  maxSimulatedEvents: number = DEFAULT_MAX_SIMULATED_EVENTS
): boolean {
  return estimateDiscreteEventCount(topology) > maxSimulatedEvents
}
