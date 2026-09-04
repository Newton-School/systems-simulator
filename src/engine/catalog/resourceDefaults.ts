/**
 * Per-component-type default resource allocation — so authors don't size every
 * node from scratch. Picks a starting `instanceType`, `workloadKind`, per-instance
 * worker count, and queue backlog for each component type, calibrated so a node
 * comfortably serves the question suites' 2–3k baseRps WITHOUT being the accidental
 * bottleneck. The intended bottleneck stays the author's to create by explicitly
 * under-provisioning a specific node.
 *
 * The `workloadKind` column is the load-bearing one: defaulting the stores to
 * `io-bound` is what keeps the Slice-1 vCPU→worker cap from throttling correct
 * IO-bound designs. See
 * ns-simulator-docs/specs/resource-allocation-and-derived-concurrency.md
 * ("Default instance + workloadKind per type").
 */
import type { ComponentType, ResourceConfig, WorkloadKind } from '../core/types'
import type { InstanceType } from './instanceCatalog'
import { INSTANCE_CATALOG } from './instanceCatalog'

/**
 * How a component type is billed — the cost-basis capability (see the spec's
 * "Cost sourcing" section). Different node types cost money in fundamentally
 * different shapes:
 *   - provisioned: instance-hours (pricePerHour × instanceCount) — compute/data.
 *     A pure function of the topology; computable live, pre-run.
 *   - volume:      per-GB of data transferred (egress) — CDN, object storage.
 *     Needs traffic, so pre-run it's an ESTIMATE from the configured workload;
 *     post-run it can be measured exactly.
 *   - consumption: per-request (Slice 4, serverless) — billed on measured throughput.
 *   - none:        not billable infrastructure (traffic sources / client apps).
 */
export type CostModel = 'provisioned' | 'volume' | 'consumption' | 'none'

export interface ResourceTypeDefault {
  instanceType: InstanceType
  workloadKind: WorkloadKind
  /** Per-instance parallel servers (before × instanceCount). */
  workersPerInstance: number
  /** Waiting-room depth beyond in-service workers. */
  queueSlots: number
  /** Per-in-flight-request memory footprint, MB. */
  perRequestMemMb: number
  /**
   * Fraction of a request's service time that is CPU-bound work contending for
   * physical cores (vs I/O wait that multiplexes freely). Drives the two-tier
   * compute-contention model — see
   * ns-simulator-docs/specs/compute-contention-two-tier-model.md. This is a
   * SOURCED, author-locked physical property of the component type, NOT a free
   * dial (a free value would just relocate the capacity-overstatement lie from
   * `c` to this number). Guidance:
   *   - cpu-bound types: 1.0 (all work is on the core; the queue's c = vCPU
   *     already caps them, so the two-tier model is a no-op for them).
   *   - io-bound "Group 1" (proxies, gateways, caches, queues, blob/egress):
   *     ~0.05–0.15 — negligible per-request CPU, so the model stays a near-no-op.
   *   - io-bound "Group 2" (analytical / index / vector / relational stores):
   *     substantially higher — these are compute-over-data workloads that are
   *     io-bound only by classification. `relational-db` is a locked BAND: the
   *     value is a defensible midpoint, cost genuinely varies by query.
   */
  cpuBoundFraction: number
  /** How this type is billed. Defaults to 'provisioned' when omitted. */
  costModel?: CostModel
  /** USD per GB transferred — only meaningful for costModel 'volume'. */
  pricePerGb?: number
  /** USD per million requests — only meaningful for costModel 'consumption'. */
  pricePerMillionRequests?: number
}

/**
 * Fallback for any component type not explicitly tabled below. Conservative
 * cpuBoundFraction (0.3): high enough that an untabled type does not silently
 * hide real CPU cost, low enough that a genuinely I/O-light one is not badly
 * over-penalized. New types should be tabled explicitly rather than relying on this.
 */
export const FALLBACK_RESOURCE_DEFAULT: ResourceTypeDefault = {
  instanceType: 'm5.large',
  workloadKind: 'io-bound',
  workersPerInstance: 32,
  queueSlots: 256,
  perRequestMemMb: 8,
  cpuBoundFraction: 0.3
}

/**
 * The curated 13-type table. Compute tier is `cpu-bound`; stores and fan-out are
 * `io-bound`. Sizes/backlogs are generous relative to suite load by design.
 */
export const RESOURCE_DEFAULTS: Partial<Record<ComponentType, ResourceTypeDefault>> = {
  // --- Serverless: consumption-priced (per-request), not instance-hours. The
  // instance only sizes the queue; cost tracks measured/expected throughput. ---
  'serverless-function': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.4, // runs arbitrary user code — locked-band midpoint
    costModel: 'consumption',
    pricePerMillionRequests: 0.2 // Lambda-class per-request charge
  },

  // --- CPU / compute tier ---
  'api-endpoint': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.05, // just receives/serves; logic lives downstream
    costModel: 'none'
  },
  'load-balancer': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.05 // forward-heavy
  },
  microservice: {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  'batch-worker': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 8,
    queueSlots: 512,
    perRequestMemMb: 32,
    cpuBoundFraction: 1.0
  },

  // --- Fan-out / async (backpressure nodes) ---
  queue: {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  'message-broker': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },

  // --- IO-bound stores (migration-critical: kv-store, relational-db, time-series-db) ---
  'in-memory-cache': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.1 // hashing/serialization only
  },
  'kv-store': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 0.1
  },
  'nosql-db': {
    instanceType: 'm5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 384,
    perRequestMemMb: 16,
    cpuBoundFraction: 0.25 // index/filter work, lighter than relational; sits below its band
  },
  'relational-db': {
    instanceType: 'm5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 32,
    cpuBoundFraction: 0.35 // LOCKED BAND: OLTP is wait-dominated (~15% CPU in profiling); joins/sorts push it up
  },
  'time-series-db': {
    instanceType: 'r5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 512,
    perRequestMemMb: 16,
    cpuBoundFraction: 0.5 // rollups / downsampling / aggregation
  },

  // --- Edge / storage: volume-priced (per-GB egress), NOT instance-hours.
  // instanceType is retained only to size the queue (they still serve requests);
  // it does NOT drive their cost. pricePerGb is AWS-proportional egress.
  cdn: {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.05, // serves cached bytes
    costModel: 'volume',
    pricePerGb: 0.085 // CloudFront-class egress
  },
  'object-storage': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 1024,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05, // serves bytes
    costModel: 'volume',
    pricePerGb: 0.09 // S3-class egress (storage GB-month is not modeled yet)
  },

  // ── Long-tail palette (sensible defaults so these don't fall back to generic). ──
  // Routers / proxies / gateways — io-bound, forward-heavy, negligible per-req CPU.
  'load-balancer-l4': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.05
  },
  'load-balancer-l7': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.15 // TLS termination is real per-request CPU (amortized by session cache)
  },
  'api-gateway': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.15 // TLS termination + routing/auth per request
  },
  'ingress-controller': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.15 // TLS termination
  },
  'reverse-proxy': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.15 // TLS termination
  },
  'service-mesh': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.1 // sidecar mTLS crypto per hop
  },
  'nat-gateway': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.05
  },
  'vpn-gateway': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.15 // per-packet encryption is core work
  },

  // Compute services — business logic, CPU-bound like microservice.
  'auth-service': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  'search-service': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  sidecar: {
    instanceType: 't3.medium',
    workloadKind: 'cpu-bound',
    workersPerInstance: 4,
    queueSlots: 128,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  container: {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  'vm-instance': {
    instanceType: 'm5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  'edge-compute': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16,
    cpuBoundFraction: 1.0
  },
  'gpu-node': {
    instanceType: 'c5.2xlarge',
    workloadKind: 'cpu-bound',
    workersPerInstance: 8,
    queueSlots: 128,
    perRequestMemMb: 64,
    cpuBoundFraction: 1.0
  },

  // Data stores — io-bound; analytics/memory-heavy ones get memory-optimized boxes.
  'columnar-db': {
    instanceType: 'r5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 512,
    perRequestMemMb: 16,
    cpuBoundFraction: 0.75 // OLAP scans + (de)compression — Group 2, just under the warehouse
  },
  'data-warehouse': {
    instanceType: 'r5.2xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 512,
    perRequestMemMb: 32,
    cpuBoundFraction: 0.8 // heavy OLAP aggregation — Group 2
  },
  'graph-db': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 32,
    cpuBoundFraction: 0.55 // traversal computation — Group 2; locality/distribution-sensitive
  },
  'vector-db': {
    instanceType: 'r5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 32,
    cpuBoundFraction: 0.8 // ANN distance math (SIMD) — effectively compute-bound — Group 2
  },
  'search-index': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 384,
    perRequestMemMb: 16,
    cpuBoundFraction: 0.6 // scoring / ranking — Group 2
  },
  'block-storage': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  'distributed-file-system': {
    instanceType: 'm5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  'data-lake': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 1024,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05,
    costModel: 'volume',
    pricePerGb: 0.09
  },
  'archive-storage': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 1024,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05,
    costModel: 'volume',
    pricePerGb: 0.09
  },

  // Messaging / streaming — io-bound backpressure nodes like queue/broker.
  'pub-sub': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  'event-bus': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  stream: {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  'task-queue': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.05
  },
  'rate-limiter': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4,
    cpuBoundFraction: 0.05
  },
  'circuit-breaker-controller': {
    instanceType: 't3.medium',
    workloadKind: 'cpu-bound',
    workersPerInstance: 8,
    queueSlots: 128,
    perRequestMemMb: 8,
    cpuBoundFraction: 1.0
  },
  'distributed-lock': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 16,
    queueSlots: 512,
    perRequestMemMb: 8,
    cpuBoundFraction: 0.1 // coordination, small compute
  },
  'event-sourcing-store': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 2048,
    perRequestMemMb: 16,
    cpuBoundFraction: 0.15 // append is cheap; replay/snapshot adds some compute
  }
}

/** Resolve the default allocation for a component type (never throws). */
export function getResourceDefaults(type: ComponentType): ResourceTypeDefault {
  return RESOURCE_DEFAULTS[type] ?? FALLBACK_RESOURCE_DEFAULT
}

/**
 * Build the default instance-backed resource profile for a freshly created node.
 * This follows the curated per-type allocation table rather than trying to
 * preserve any legacy queue heuristic. Legacy migrations still use
 * `buildReproducingResources(...)` below to remain byte-identical.
 */
export function buildDefaultResources(type: ComponentType): ResourceConfig {
  const defaults = getResourceDefaults(type)
  return {
    instanceType: defaults.instanceType,
    instanceCount: 1,
    workloadKind: defaults.workloadKind,
    perRequestMemMb: defaults.perRequestMemMb
  }
}

/**
 * Build an instance-model `resources` block for a node migrated from a raw
 * authored `(workers, capacity)` queue. Under derive-and-lock, concurrency is a
 * CONSEQUENCE of the hardware, not an authored number: `effectiveC` is derived as
 * `vcpu × workersPerVcpu(kind) × instanceCount` and `effectiveK` from RAM — the
 * authored `workers`/`capacity` do NOT survive as such. So this wrap only:
 *   - picks the type's default `instanceType` (which, with io-bound, fixes c), and
 *   - sizes `perRequestMemMb` so the RAM-derived K ≥ 2× the old capacity → RAM
 *     never becomes the binding limit for a node that used to admit `capacity`.
 * It intentionally does NOT emit `workersPerInstance`/`queueSlots`: those are
 * derived-and-shown-read-only (see resourceDerivation.ts), so authoring them here
 * would be dead, misleading data that contradicts the actual derived concurrency.
 * Shared by the canvas serializer and the question-fixture generator.
 */
export function buildReproducingResources(
  type: ComponentType,
  _workers: number,
  capacity: number
): ResourceConfig {
  const instanceType = getResourceDefaults(type).instanceType
  const totalRamMb = INSTANCE_CATALOG[instanceType].ramGb * 1024
  return {
    instanceType,
    instanceCount: 1,
    workloadKind: 'io-bound',
    perRequestMemMb: totalRamMb / (Math.max(1, capacity) * 2)
  }
}
