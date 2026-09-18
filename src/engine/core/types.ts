import type { SimulationEvent } from './events'
import type { StructuralRole } from '../catalog/nodeSpecTypes'
import type { InstanceType, PricingModel } from '../catalog/instanceCatalog'

/**
 * Accuracy contract classification for simulator parameters.
 * - invariant: internal mechanics/safety constants, not scenario knobs
 * - default-override: has a default but can be overridden by scenario input
 * - user-parameter: visible input expected to influence simulation output
 * - not-simulated: accepted by schema but intentionally ignored by runtime
 */
export type ParameterAccuracyClass =
  | 'invariant'
  | 'default-override'
  | 'user-parameter'
  | 'not-simulated'

export type LocationProvider = 'aws' | 'gcp' | 'azure' | 'ibm' | 'custom'

export type TopologyLocationKind = 'region' | 'availability-zone' | 'subnet' | 'edge-pop'

/**
 * A physical or logical placement boundary authored on the canvas. Composite
 * location containers are not queueing nodes, but they are serialized so the
 * engine can resolve request-aware network latency deterministically.
 */
export interface TopologyLocation {
  id: string
  kind: TopologyLocationKind
  label: string
  parentId?: string
  provider?: LocationProvider
  providerCode?: string
  coordinates?: {
    latitude: number
    longitude: number
  }
  /** Canvas geometry retained so exported topologies reopen as editable locations. */
  position?: { x: number; y: number }
  size?: { width: number; height: number }
}

export interface ComponentPlacement {
  regionId?: string
  availabilityZoneId?: string
  subnetId?: string
}

export type TrafficOriginLocation =
  | { kind: 'region'; regionId: string }
  | { kind: 'coordinates'; latitude: number; longitude: number }

export interface TrafficOrigin {
  id: string
  label: string
  weight: number
  location: TrafficOriginLocation
}

export interface RegionPairLatency {
  fromRegionId: string
  toRegionId: string
  distribution: DistributionConfig
  source?: 'catalogue' | 'user'
}

export interface GeoNetworkModel {
  mode: 'path-type' | 'geo-aware'
  catalogueVersion?: string
  regionPairOverrides?: RegionPairLatency[]
}

export type ComponentCategory =
  | 'compute'
  | 'network-and-edge'
  | 'storage-and-data'
  | 'messaging-and-streaming'
  | 'orchestration-and-infra'
  | 'security-and-identity'
  | 'observability'
  | 'devops-and-delivery'
  | 'data-infra-and-analytics'
  | 'real-time-and-media'
  | 'external-and-integration'
  | 'dns-and-certs'
  | 'consensus-and-coordination'
  | 'auxiliary'

export type ComputeType =
  | 'api-endpoint'
  | 'microservice'
  | 'sidecar'
  | 'batch-worker'
  | 'serverless-function'
  | 'faas-background'
  | 'container'
  | 'vm-instance'
  | 'edge-compute'
  | 'gpu-node'
  | 'auth-service'
  | 'search-service'
export type NetworkType =
  | 'load-balancer'
  | 'load-balancer-l4'
  | 'load-balancer-l7'
  | 'global-traffic-manager'
  | 'edge-router'
  | 'nat-gateway'
  | 'transit-gateway'
  | 'vpn-gateway'
  | 'cdn'
  | 'api-gateway'
  | 'service-mesh'
  | 'ingress-controller'
  | 'reverse-proxy'
  | 'high-perf-nic'
  | 'network-policy'
  | 'routing-rule'
  | 'routing-policy'
export type StorageType =
  | 'relational-db'
  | 'nosql-db'
  | 'object-storage'
  | 'block-storage'
  | 'distributed-file-system'
  | 'in-memory-cache'
  | 'search-index'
  | 'time-series-db'
  | 'columnar-db'
  | 'graph-db'
  | 'vector-db'
  | 'data-warehouse'
  | 'data-lake'
  | 'kv-store'
  | 'archive-storage'
  | 'schema-registry'
  | 'cdc'
  | 'backup-service'
  | 'kms-storage'
export type MessagingType =
  | 'queue'
  | 'pub-sub'
  | 'stream'
  | 'event-bus'
  | 'event-sourcing-store'
  | 'message-broker'
  | 'task-queue'
export type OrchestrationType =
  | 'kubernetes-cluster'
  | 'container-registry'
  | 'service-registry'
  | 'tool-registry'
  | 'config-store'
  | 'secrets-manager'
  | 'cluster-autoscaler'
  | 'agent-orchestrator'
  | 'orchestrator-scheduler'
  | 'ci-cd-runner'
  | 'iac-engine'
  | 'container-runtime'
  | 'provisioner'
export type SecurityType =
  | 'iam-rbac'
  | 'waf'
  | 'firewall'
  | 'bastion-host'
  | 'certificate-authority'
  | 'secrets-rotation'
  | 'kms-security'
  | 'dlp-inspection'
  | 'identity-provider'
  | 'siem'
  | 'privilege-escalation-control'
export type ObservabilityType =
  | 'centralized-logging'
  | 'distributed-tracing'
  | 'metrics-store'
  | 'alerting-hook'
  | 'dashboard'
  | 'rum-monitoring'
  | 'health-check-manager'
  | 'safety-observability-mesh'
  | 'profiling-service'
export type DevopsType =
  | 'artifact-repository'
  | 'build-system'
  | 'feature-flag-service'
  | 'deployment-controller'
  | 'chaos-engineering-framework'
  | 'policy-as-code'
  | 'pipeline-secrets'
export type DataInfraType =
  | 'etl-pipeline'
  | 'streaming-analytics'
  | 'feature-store'
  | 'memory-fabric'
  | 'model-serving'
export type RealTimeType =
  | 'websockets-gateway'
  | 'push-notification-service'
  | 'transcoder'
  | 'signaling-server'
  | 'sfu-mcu'
  | 'webrtc-mesh'
export type IntegrationType =
  | 'webhook-gateway'
  | 'llm-gateway'
  | 'third-party-api-connector'
  | 'payment-gateway'
  | 'third-party-auth'
export type DnsType = 'dns-authoritative-server' | 'internal-dns' | 'certificate-distro'
export type ConsensusType =
  | 'etcd-consul-kv'
  | 'leader-election'
  | 'distributed-lock'
  | 'coordination-service'
export type AuxiliaryType =
  | 'service-mesh-telemetry'
  | 'policy-engine'
  | 'sharding'
  | 'hashing'
  | 'shard-node'
  | 'partition-node'
  | 'rate-limiter'
  | 'circuit-breaker-controller'
  | 'idempotency-manager'
  | 'reservation-store'
  | 'request-tracking'
  | 'backpressure-controller'
  | 'throttler'

export type ComponentType =
  | ComputeType
  | NetworkType
  | StorageType
  | MessagingType
  | OrchestrationType
  | SecurityType
  | ObservabilityType
  | DevopsType
  | DataInfraType
  | RealTimeType
  | IntegrationType
  | DnsType
  | ConsensusType
  | AuxiliaryType

export type BaseDistributionConfig =
  | { type: 'constant'; value: number }
  | { type: 'deterministic'; value: number }
  | { type: 'log-normal'; mu: number; sigma: number }
  | { type: 'exponential'; lambda: number }
  | { type: 'normal'; mean: number; stdDev: number }
  | { type: 'uniform'; min: number; max: number }
  | { type: 'weibull'; shape: number; scale: number }
  | { type: 'poisson'; lambda: number }
  | { type: 'binomial'; n: number; p: number }
  | { type: 'gamma'; shape: number; scale: number }
  | { type: 'beta'; alpha: number; beta: number }
  | { type: 'pareto'; scale: number; shape: number }
  | { type: 'empirical'; samples: number[]; interpolation: 'linear' | 'step' }

export type DistributionConfig =
  | BaseDistributionConfig
  | {
      type: 'mixture'
      //All weights in the distribution are expected to be non-negative and sum to 1.0.
      components: Array<{ weight: number; distribution: BaseDistributionConfig }>
    }

/**
 * Whether a node's work is bound by CPU (compute) or by IO (waiting on a store /
 * network). Decides whether the vCPU ceiling caps concurrency: cpu-bound work runs
 * ~1 truly-parallel worker per vCPU, while io-bound work legitimately runs workers
 * ≫ vCPU because the workers are mostly waiting, not computing.
 */
export type WorkloadKind = 'cpu-bound' | 'io-bound'

/**
 * Physical resource allocation for a node, in the AWS instance-family model. The
 * author picks a discrete `instanceType` (per-instance vCPU/RAM/price resolve from
 * INSTANCE_CATALOG — never free-typed) and scales by `instanceCount`. Workers and
 * queue depth get sensible defaults derived from the instance + `workloadKind`, but
 * remain editable so they can be tuned or intentionally misconfigured.
 *
 * See ns-simulator-docs/specs/resource-allocation-and-derived-concurrency.md.
 */
export interface ResourceConfig {
  /** Hardware SKU key into INSTANCE_CATALOG; resolves to { vcpu, ramGb, pricePerHour }. */
  instanceType?: InstanceType
  /** Number of instances of that type (horizontal scale). Supersedes `replicas`. */
  instanceCount?: number
  /** Per-node quota: `instanceCount` may not exceed this (build-time validation). */
  maxInstances?: number
  /** CPU-bound vs IO-bound — decides whether the vCPU ceiling caps workers. */
  workloadKind?: WorkloadKind
  /** App concurrency per instance (parallel servers). Derived default, editable, vCPU-capped. */
  workersPerInstance?: number
  /** Waiting-room depth beyond in-service workers. Derived default, editable, RAM-capped. */
  queueSlots?: number
  /** Memory footprint of one in-flight request, in MB. Divides RAM into the admission ceiling. */
  perRequestMemMb?: number
  /**
   * Purchasing model — the flexibility/commitment/risk tradeoff on price.
   * on-demand (full price, default) · reserved (~40% off, committed) · spot
   * (~70% off). In this simulator today it changes provisioned cost only;
   * commitment guarantees and spot interruption behavior are not simulated.
   * Absent = 'on-demand'.
   */
  pricingModel?: PricingModel

  /** @deprecated Legacy free-typed vCPU count. Superseded by `instanceType`. Read for back-compat. */
  cpu?: number
  /** @deprecated Legacy free-typed memory (MB). Superseded by `instanceType`. Read for back-compat. */
  memory?: number
  /** @deprecated Renamed to `instanceCount`. Read for back-compat via `getInstanceCount`. */
  replicas?: number
  /** @deprecated Renamed to `maxInstances`. */
  maxReplicas?: number
}

/**
 * Back-compat accessor for a node's instance count, reading the new `instanceCount`
 * and falling back to the legacy `replicas` (default 1). Use everywhere that used to
 * read `resources.replicas` directly.
 */
export function getInstanceCount(resources: ResourceConfig | undefined): number {
  return resources?.instanceCount ?? resources?.replicas ?? 1
}

export interface QueueConfig {
  workers: number
  capacity: number
  discipline: 'fifo' | 'lifo' | 'priority' | 'wfq'
}

export interface ProcessingConfig {
  distribution: DistributionConfig
  /** Timeout in milliseconds. */
  timeout: number
}

export interface DependenciesConfig {
  critical: string[]
  optional: string[]
}

export interface ResilienceConfig {
  circuitBreaker?: {
    failureThreshold: number // e.g., 0.5 — trip when 50% of requests fail
    failureCount: number // minimum requests before evaluating (e.g., 10)
    recoveryTimeout: number //ms
    halfOpenRequests: number
  }
  retry?: {
    maxAttempts: number
    baseDelay: number //ms
    maxDelay: number //ms
    multiplier: number
    jitter: boolean
  }
  rateLimiter?: {
    maxTokens: number
    refillRate: number
  }
  bulkhead?: {
    maxConcurrent: number
  }
}

export interface SLOConfig {
  latencyP99?: number // ms
  availabilityTarget?: number // fraction between 0 and 1
  errorBudget?: number // fraction between 0 and 1
}

export interface FailureMode {
  mode: string
  severity: 'critical' | 'degraded' | 'minor'
  mtbf?: number // ms — mean time between failures
  mttr?: number // ms — mean time to repair
  trigger?: {
    metric: string
    operator: '>' | '<' | '>=' | '<=' | '=='
    value: number
  }
}

export interface ScalingConfig {
  type: 'horizontal' | 'vertical'
  metric: string
  scaleUpThreshold: number
  scaleDownThreshold: number
  /** Cooldown period between scaling actions, in ms. */
  cooldown: number
  coldStartPenalty?: {
    distribution: DistributionConfig
  }
}

export interface ComponentNode {
  id: string
  type: ComponentType
  category: ComponentCategory
  role?: Exclude<StructuralRole, 'composite'>
  label: string
  position: { x: number; y: number }
  /** Optional vendor/product label; behavior continues to come from `type`. */
  provider?: string
  placement?: ComponentPlacement
  resources?: ResourceConfig
  queue?: QueueConfig
  processing?: ProcessingConfig
  dependencies?: DependenciesConfig
  resilience?: ResilienceConfig
  slo?: SLOConfig
  failureModes?: FailureMode[]
  scaling?: ScalingConfig
  config?: Record<string, unknown>
}

/** Visual route geometry for an authored canvas edge. It never changes simulation semantics. */
export type EdgePresentationRoutingStyle =
  | 'straight'
  | 'orthogonal'
  | 'rounded'
  | 'bezier'
  | 'octilinear'

export interface EdgePresentation {
  routingStyle?: EdgePresentationRoutingStyle
}

export interface EdgeDefinition {
  id: string
  source: string
  target: string
  label?: string
  mode: 'synchronous' | 'asynchronous' | 'streaming' | 'conditional'
  protocol: 'https' | 'grpc' | 'tcp' | 'udp' | 'websocket' | 'amqp' | 'kafka'
  latency: {
    distribution: DistributionConfig
    pathType: 'same-rack' | 'same-dc' | 'cross-zone' | 'cross-region' | 'internet'
    derivedFromPathType?: boolean
  }
  bandwidth: number //Mbps
  maxConcurrentRequests: number
  /**
   * Probability of packet loss on this edge.
   * Expected range: 0.0 (no loss) to 1.0 (all packets lost).
   */
  packetLossRate: number
  /**
   * Probability that a request on this edge results in an error.
   * Expected range: 0.0 (no errors) to 1.0 (all requests fail).
   */
  errorRate: number
  weight?: number // relative weight for weighted routing
  condition?: string // JS expression string for conditional edges
  /**
   * Fan-out amplification: each request delivered over this edge is amplified into
   * this many recipient deliveries (e.g. a fan-out-on-write post → N follower feed
   * writes). Undefined or ≤1 means no amplification. Models the write storm — the
   * downstream target genuinely receives N× the load and can saturate.
   */
  fanoutFactor?: number

  // React Flow metadata
  sourceHandle?: string
  targetHandle?: string
  animated?: boolean
  /** Optional authoring metadata; ignored by the simulation engine. */
  presentation?: EdgePresentation
}

// 24 entries: one multiplier per hour of the day (0–23).
export type DiurnalHourlyMultipliers = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
]

/**
 * When a run ends. The author chooses the primary `mode`; `haltOnSaturation` is an
 * optional early-abort guard that applies on top of either mode.
 *
 * - `duration` (default): run for `global.simulationDuration` ms.
 * - `requestBudget`: run until exactly `maxRequests` source requests have been
 *   generated, then drain in-flight work. The time bound is ignored (a duration is
 *   derived only to size the run window). This is how "the sale is N requests" is
 *   expressed, as opposed to a rate over a fixed time.
 *
 * `haltOnSaturation` stops the run early the moment the design is clearly doomed —
 * a node at/over `utilization` (default 1.0 = 100%) or the system error rate at/over
 * `errorRate` — so a saturated design reports its verdict at the instant it breaks
 * instead of grinding out the rest of the window.
 */
export interface WorkloadStopCondition {
  mode: 'duration' | 'requestBudget'
  /** Required when `mode === 'requestBudget'`: total source requests to generate. */
  maxRequests?: number
  haltOnSaturation?: {
    /** Utilization at/above which to abort. Default 1.0 (100%). */
    utilization?: number
    /** System error rate [0,1] at/above which to abort. Optional. */
    errorRate?: number
  }
}

export interface WorkloadProfile {
  sourceNodeId: string
  pattern: 'constant' | 'poisson' | 'bursty' | 'diurnal' | 'spike' | 'sawtooth' | 'replay'
  /** When the run stops (time, request count, or early on saturation). Default: duration. */
  stopCondition?: WorkloadStopCondition
  /**
   * Base requests per second for this workload pattern.
   * Must be a positive number (> 0).
   */
  baseRps: number
  /** Weighted client populations. Omitted means use the source node placement. */
  origins?: TrafficOrigin[]
  diurnal?: {
    peakMultiplier: number
    /**
     * 24 values, one per hour in the day (0–23).
     */
    hourlyMultipliers: DiurnalHourlyMultipliers
  }
  spike?: {
    /**
     * Time from the start of the simulation until the spike begins, in milliseconds.
     */
    spikeTime: number
    spikeRps: number
    /**
     * Duration of the spike, in milliseconds.
     */
    spikeDuration: number
  }
  bursty?: {
    burstRps: number
    burstDuration: number // ms
    normalDuration: number // ms
  }
  sawtooth?: {
    peakRps: number
    rampDuration: number // ms
  }
  requestDistribution: Array<{
    type: string
    /**
     * Weight represents the fraction of traffic assigned to this request type.
     * All weights in the distribution are expected to be non-negative and sum to 1.0.
     */
    weight: number
    sizeBytes: number
    metadata?: Record<string, unknown>
    /**
     * Optional contended keyspace. When set, each generated request of this type
     * is stamped with `metadata[field]` = a key drawn from `size` distinct keys.
     * A small `size` under high RPS forces many requests onto the same key — the
     * contention needed to exercise reservation / no-double-book designs.
     * Omitted → requests share the static `metadata` (no contention).
     *
     * `skew` controls the access distribution across the keyspace:
     *   - `0` (or omitted) → uniform: every key equally likely.
     *   - `> 0` → Zipf with exponent `s`: key rank `r` is drawn with probability
     *     ∝ `r^(-s)`, so a small set of "hot" keys carries most traffic
     *     (`s ≈ 1` ≈ the classic 80/20 web access pattern). This is what makes a
     *     small cache earn a high hit rate and what produces hot-partition skew.
     * Keys are ranked by index: `field-0` is the most popular, `field-1` next, …
     */
    keyspace?: {
      /** Metadata field to populate, e.g. "seatId". */
      field: string
      /** Number of distinct keys (e.g. seats) to spread traffic across. */
      size: number
      /**
       * Zipf skew exponent. `0`/omitted = uniform (back-compat); higher = more
       * concentrated on hot keys. Typical web ≈ 0.8–1.0.
       */
      skew?: number
    }
  }>
}

export interface FaultSpec {
  targetId: string
  faultType: string
  timing: 'deterministic' | 'probabilistic' | 'conditional'
  duration: 'fixed' | 'until' | 'permanent'
  params: Record<string, unknown>
}

export interface InvariantCheck {
  id: string
  description: string
  condition: string
}

export interface ScenarioRef {
  id: string
  name: string
  overrides: Record<string, unknown>
}

export interface GlobalConfig {
  simulationDuration: number //ms
  seed: string
  warmupDuration: number // ms — metrics collected only after warmup
  timeResolution: 'microsecond' | 'millisecond'
  defaultTimeout: number // ms — fallback if a node doesn't specify one
  traceSampleRate?: number // fraction [0, 1] — defaults to 0.01
}

export interface TopologyJSON {
  id: string
  name: string
  version: string
  global: GlobalConfig
  nodes: ComponentNode[]
  edges: EdgeDefinition[]
  locations?: TopologyLocation[]
  networkModel?: GeoNetworkModel
  workload?: WorkloadProfile
  faults?: FaultSpec[]
  invariants?: InvariantCheck[]
  scenarios?: ScenarioRef[]
}

export interface RandomGenerator {
  next(): number // [0, 1)
  between(min: number, max: number): number // [min, max)
  integer(min: number, max: number): number // integer in [min, max]
  boolean(probability?: number): boolean // true with given probability (default 0.5)
}

export interface NodeMetrics {
  totalArrivals: number
  totalCompleted: number
  totalRejections: number
  totalQueueTime: bigint
  totalServiceTime: bigint
  maxQueueLength: number
}

export interface NodeState {
  id: string
  status: 'idle' | 'busy' | 'saturated' | 'failed'
  activeWorkers: number
  queueLength: number
  utilization: number
  totalInSystem: number
  /**
   * Cumulative mean service time (ms) over completed requests, or 0 before any
   * completion. Used by the `least-response-time` routing strategy.
   */
  meanServiceTimeMs: number
}

export interface EventScheduler {
  schedule: (event: SimulationEvent) => void
}
