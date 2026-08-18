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
  /** How this type is billed. Defaults to 'provisioned' when omitted. */
  costModel?: CostModel
  /** USD per GB transferred — only meaningful for costModel 'volume'. */
  pricePerGb?: number
  /** USD per million requests — only meaningful for costModel 'consumption'. */
  pricePerMillionRequests?: number
}

/** Fallback for any component type not explicitly tabled below. */
export const FALLBACK_RESOURCE_DEFAULT: ResourceTypeDefault = {
  instanceType: 'm5.large',
  workloadKind: 'io-bound',
  workersPerInstance: 32,
  queueSlots: 256,
  perRequestMemMb: 8
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
    costModel: 'none'
  },
  'load-balancer': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  microservice: {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  'batch-worker': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 8,
    queueSlots: 512,
    perRequestMemMb: 32
  },

  // --- Fan-out / async (backpressure nodes) ---
  queue: {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8
  },
  'message-broker': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8
  },

  // --- IO-bound stores (migration-critical: kv-store, relational-db, time-series-db) ---
  'in-memory-cache': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 8
  },
  'kv-store': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  'nosql-db': {
    instanceType: 'm5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 384,
    perRequestMemMb: 16
  },
  'relational-db': {
    instanceType: 'm5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 32
  },
  'time-series-db': {
    instanceType: 'r5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 512,
    perRequestMemMb: 16
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
    costModel: 'volume',
    pricePerGb: 0.085 // CloudFront-class egress
  },
  'object-storage': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 1024,
    perRequestMemMb: 8,
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
    perRequestMemMb: 4
  },
  'load-balancer-l7': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  'api-gateway': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  'ingress-controller': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  'reverse-proxy': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  'service-mesh': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  'nat-gateway': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },
  'vpn-gateway': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 4
  },

  // Compute services — business logic, CPU-bound like microservice.
  'auth-service': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  'search-service': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  sidecar: {
    instanceType: 't3.medium',
    workloadKind: 'cpu-bound',
    workersPerInstance: 4,
    queueSlots: 128,
    perRequestMemMb: 16
  },
  container: {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  'vm-instance': {
    instanceType: 'm5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  'edge-compute': {
    instanceType: 'c5.large',
    workloadKind: 'cpu-bound',
    workersPerInstance: 16,
    queueSlots: 256,
    perRequestMemMb: 16
  },
  'gpu-node': {
    instanceType: 'c5.2xlarge',
    workloadKind: 'cpu-bound',
    workersPerInstance: 8,
    queueSlots: 128,
    perRequestMemMb: 64
  },

  // Data stores — io-bound; analytics/memory-heavy ones get memory-optimized boxes.
  'columnar-db': {
    instanceType: 'r5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 512,
    perRequestMemMb: 16
  },
  'data-warehouse': {
    instanceType: 'r5.2xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 512,
    perRequestMemMb: 32
  },
  'graph-db': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 32
  },
  'vector-db': {
    instanceType: 'r5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 256,
    perRequestMemMb: 32
  },
  'search-index': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 48,
    queueSlots: 384,
    perRequestMemMb: 16
  },
  'block-storage': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 8
  },
  'distributed-file-system': {
    instanceType: 'm5.xlarge',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 512,
    perRequestMemMb: 8
  },
  'data-lake': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 1024,
    perRequestMemMb: 8,
    costModel: 'volume',
    pricePerGb: 0.09
  },
  'archive-storage': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 64,
    queueSlots: 1024,
    perRequestMemMb: 8,
    costModel: 'volume',
    pricePerGb: 0.09
  },

  // Messaging / streaming — io-bound backpressure nodes like queue/broker.
  'pub-sub': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8
  },
  'event-bus': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8
  },
  stream: {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8
  },
  'task-queue': {
    instanceType: 'm5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 4096,
    perRequestMemMb: 8
  },
  'event-sourcing-store': {
    instanceType: 'r5.large',
    workloadKind: 'io-bound',
    workersPerInstance: 32,
    queueSlots: 2048,
    perRequestMemMb: 16
  }
}

/** Resolve the default allocation for a component type (never throws). */
export function getResourceDefaults(type: ComponentType): ResourceTypeDefault {
  return RESOURCE_DEFAULTS[type] ?? FALLBACK_RESOURCE_DEFAULT
}

/**
 * Build an instance-model `resources` block that reproduces a node's authored
 * (workers, capacity) exactly, so the simulation stays byte-identical while the
 * node becomes instance-backed and cost-computable (the Slice-0 "wrap"):
 *   - workloadKind 'io-bound' → no vCPU cap, so effectiveC = workersPerInstance = workers.
 *   - queueSlots = capacity − workers → effectiveK = min(capacity, memCeiling).
 *   - perRequestMemMb sized so memCeiling ≥ 2× capacity → RAM never binds.
 * Shared by the canvas serializer and the question-fixture generator.
 */
export function buildReproducingResources(
  type: ComponentType,
  workers: number,
  capacity: number
): ResourceConfig {
  const instanceType = getResourceDefaults(type).instanceType
  const totalRamMb = INSTANCE_CATALOG[instanceType].ramGb * 1024
  return {
    instanceType,
    instanceCount: 1,
    workloadKind: 'io-bound',
    workersPerInstance: workers,
    queueSlots: Math.max(0, capacity - workers),
    perRequestMemMb: totalRamMb / (Math.max(1, capacity) * 2)
  }
}
