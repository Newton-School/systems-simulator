import {
  generateSimulationOutput,
  ReplicationProjection,
  SimulationOutput,
  StreamBrokerProjection,
  StatusWindow,
  TimeSeriesSnapshot
} from './analysis/output'
import { evaluateInvariantViolations } from './analysis/invariants'
import { detectSinglePointsOfFailure } from './analysis/singlePointOfFailure'
import { replayEventStream } from './analysis/replay'
import { CausalGraphRecorder } from './analysis/causalGraph'
import {
  AdmissionDecision,
  AdmissionDecisionStatus,
  AppendEventInput,
  CanonicalEventRecord,
  DebugEvent,
  EventCountsByType,
  EventStreamRecorder,
  NodeSnapshot,
  RequestLifecycle,
  RequestOutcomeRecord,
  TerminalRequestStatus,
  eventInputFromSimulationEvent,
  projectToDebugEvent
} from './core/event-stream'
import {
  EventPriority,
  cloneRequestPhaseRecord,
  createEvent,
  type EdgeFailureCause,
  type EdgeFlowEvent,
  type EdgeFlowStatus,
  type RequestEdgePhase,
  type RequestNodePhase,
  type RequestTerminalCause,
  type Request,
  type SimulationEvent
} from './core/events'
import {
  classifyRequestOutcome,
  createEmptyRequestOutcomeBreakdown
} from './core/requestOutcomeSemantics'
import { describeRequestOperation } from './core/requestSemantics'
import {
  buildRequestSemanticsSnapshot,
  cloneRequestStateTimeline,
  deriveTraitStateTransitions,
  recordRequestStateTransition
} from './core/simulationSemantics'
import { microToMs, msToMicro, secToMicro } from './core/time'
import {
  resolveStopCondition,
  type ResolvedStopCondition,
  type StopReason
} from './core/stopCondition'
import {
  ComponentNode,
  EdgeDefinition,
  EventScheduler,
  getInstanceCount,
  TopologyJSON
} from './core/types'
import { INSTANCE_CATALOG } from './catalog/instanceCatalog'
import { getResourceDefaults } from './catalog/resourceDefaults'
import { ClusterScheduler, type ClusterProjection, type PodStart } from './cluster/clusterScheduler'
import { CHANGE_STREAM_NODE_META, ORDERING_LANE_META, orderingLaneOf } from './traits/changeStream'
import {
  readClusterConfig,
  resolveScheduledCluster,
  scheduledReadyStateKey
} from './traits/scheduler'
import {
  getPathTypeLatencyProfile,
  getProtocolLatencyOverheadMs,
  isReliableProtocol,
  protocolSupportsConnectionLimits
} from './defaults/edgeDefaults'
import { MetricsCollector } from './metrics'
import { classifyRejectionCause } from './metrics/windowedLatencyAggregator'
import { GeoLatencyResolver } from './network/geoLatencyResolver'
import {
  faultDomainMemberIds,
  faultDomainRef,
  findFaultDomain,
  readFaultDomainRef,
  type FaultDomainRef
} from './core/faultDomains'
import { GGcKNode } from './nodes/GGcKNode'
import { deriveNodeConcurrency } from './nodes/resourceDerivation'
import {
  DEFAULT_CHAOS_FAILURE_SPEC,
  LEGACY_REJECT_FAILURE_SPEC,
  NodeFailureSpec,
  parseFailureSpec
} from './nodes/failure'
import {
  CACHE_FLUSH_FAULT_TYPE,
  DEFAULT_CACHE_FLUSH_REWARM_MS,
  scheduleCacheFlush
} from './traits/cache'
import { RoutingTable, type ResolveRoute } from './routing'
import { MinHeap } from './scheduler/min-heap'
import { Distributions } from './stochastic/distribution'
import { createRandom } from './stochastic/random'
import {
  RequestTracer,
  type RequestAdmissionOutcome,
  type RequestAdmissionStage,
  type TracedNodeState
} from './tracer'
import {
  attachCircuitBreakerTracking,
  clearCircuitBreakerTracking,
  readCircuitBreakerConfig,
  readCircuitBreakerTracking,
  recordCircuitBreakerOutcome
} from './traits/circuitBreaker'
import {
  readQueueDeliveryConfig,
  readQueueDeliveryOriginNodeId,
  writeQueueDeliveryOriginNodeId
} from './traits/ackAndRelease'
import {
  clearLockLeaseAttachments,
  readLockLeaseAttachments,
  releaseLockLeaseAttachment
} from './traits/lockLease'
import {
  createInitialProbeState,
  evaluateProbe,
  parseHealthCheckManagerConfig,
  type HealthCheckManagerConfig,
  type ProbeState
} from './traits/healthProber'
import { resolveTraits } from './traits/resolveTraits'
import { computeRetryDelayMs, readRetryBackoffConfig } from './traits/retryBackoff'
import { ReplicaCluster, ReplicatedLog } from './semantics/v2StateMachines'
import {
  SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY,
  SERVICE_TIME_LATENCY_PENALTY_MS_KEY
} from './traits/serviceTimeOverride'
import {
  createReplicationCluster,
  replicationClusterMembers,
  replicationClusterStateKey,
  replicationConsensusProtocol
} from './traits/replication'
import {
  readStreamPartitionCount,
  readStreamRetentionMs,
  streamBrokerAvailabilityStateKey,
  streamBrokerLogStateKey
} from './traits/streamBroker'
import type {
  BeforeArrivalDecision,
  BeforeRoutingDecision,
  NodeBehaviourTrait,
  TraitHookName,
  TraitResolver,
  TraitStateStore
} from './traits/types'
import { WorkloadGenerator } from './workload'
import {
  LinkSerializer,
  transmissionTimeMs,
  type EdgeLatencyBreakdownSample
} from './network/linkTransmission'
import {
  EdgeConnectionPools,
  resolveEdgeConnection,
  type ConnectionLease,
  type ResolvedConnectionConfig
} from './network/connectionPool'
import {
  EdgeBatchAccumulator,
  resolveEdgeBatching,
  type OpenEdgeBatch,
  type ResolvedEdgeBatching
} from './network/edgeBatching'

/** A request waiting at the source for a free connection stream. */
interface ConnectionWaiter {
  request: Request
  edge: EdgeDefinition
  targetNodeId: string
  edgePhase: RequestEdgePhase
  enqueuedAtUs: bigint
  poolId: string
  ephemeral: boolean
}

/** A connection stream a request holds (until delivery, or until its response). */
interface HeldConnectionLease {
  lease: ConnectionLease
  edgeId: string
  config: ResolvedConnectionConfig
  ephemeral: boolean
}

/** A record waiting in a Kafka edge's open producer batch. */
interface BatchedRecord {
  request: Request
  targetNodeId: string
  edgePhase: RequestEdgePhase
  enqueuedAtUs: bigint
}

/** A request parked behind an in-flight leader by request collapsing. */
interface ParkedFollower {
  request: Request
  nodeId: string
  parkedAt: bigint
}

interface SecurityPolicyConfig {
  blockRate: number
  droppedPackets: number
}

const DEFAULT_MAX_RETAINED_EVENT_STREAM_EVENTS = 25_000
const DEFAULT_MAX_RETAINED_REQUEST_OUTCOMES = 25_000
const TERMINAL_TOMBSTONE_RETENTION_US = msToMicro(60_000)
const MAX_TERMINAL_TOMBSTONES = 100_000
const LOAD_BALANCER_UNHEALTHY_COOLDOWN_US = msToMicro(5_000)

export interface SimulationEngineOptions {
  resolveTraits?: TraitResolver
  /**
   * When true, GGcKNode invariants (inSystem identity, K ceiling, heldBlackhole
   * disjointness) are asserted after every event. Off by default so production
   * runs pay nothing; scenario tests turn it on.
   */
  debugInvariants?: boolean
}

/** The request's affinity/partition key for edge-flow coloring, if any. */
function affinityKeyOf(request: Request): string | undefined {
  const metadata = request.metadata
  for (const field of ['__key', 'partitionKey', 'shardKey', 'sessionId', 'clientIp'] as const) {
    const value = metadata[field]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number') return String(value)
  }
  return undefined
}

/** Scalar fields of a trait payload, for the debugger (counters and nested data dropped). */
function scalarTraitDetail(
  payload: Record<string, unknown>
): Record<string, string | number | boolean> {
  const detail: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'decision' || key === 'reason' || key === 'metricCounters') continue
    if (typeof value === 'string' || typeof value === 'boolean') {
      detail[key] = value
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      detail[key] = value
    } else if (typeof value === 'bigint') {
      detail[key] = value.toString()
    }
  }
  return detail
}

export class SimulationEngine {
  onProgress?: (percent: number, eventsProcessed: number) => void
  onSnapshot?: (snapshot: TimeSeriesSnapshot) => void
  onDebugEvent?: (event: DebugEvent) => void
  onAdmissionDecision?: (decision: AdmissionDecision) => void
  onEdgeFlowEvent?: (event: EdgeFlowEvent) => void

  private readonly eventQueue = new MinHeap<SimulationEvent>()
  private readonly causalGraphRecorder = new CausalGraphRecorder()
  private readonly eventRecorder = new EventStreamRecorder({
    maxRetainedEvents: DEFAULT_MAX_RETAINED_EVENT_STREAM_EVENTS,
    onRecord: (record) => this.handleRecordedCanonicalEvent(record)
  })
  private readonly distributions: Distributions
  private readonly routing: RoutingTable
  private readonly geoLatency: GeoLatencyResolver
  private readonly metrics: MetricsCollector
  private readonly tracer: RequestTracer
  private readonly nodes = new Map<string, GGcKNode>()
  private readonly nodeDefinitionsById = new Map<string, ComponentNode>()
  private readonly traitsByNodeId = new Map<string, readonly NodeBehaviourTrait[]>()
  private readonly nodeErrorRateById = new Map<string, number>()
  private readonly nodeTimeoutUsById = new Map<string, bigint>()
  private readonly nodeFailureSpecById = new Map<string, NodeFailureSpec>()
  private readonly debugInvariants: boolean
  private readonly securityPolicyByNodeId = new Map<string, SecurityPolicyConfig>()
  private readonly nodeLimitsById = new Map<string, { workers: number; capacity: number }>()
  private readonly nodeUnhealthyUntilUs = new Map<string, bigint>()
  private readonly healthCheckManagerConfigById = new Map<string, HealthCheckManagerConfig>()
  private readonly probedNodeIds = new Set<string>()
  private readonly probeStateByNodeId = new Map<string, ProbeState>()
  private readonly traitStateByNodeId = new Map<string, Map<string, unknown>>()
  /** Run-scoped state shared across all nodes (see TraitContext.sharedState). */
  private readonly sharedTraitState = new Map<string, unknown>()
  private readonly activeTransfersByEdgeId = new Map<string, number>()
  private readonly linkSerializer = new LinkSerializer()
  /** Connection model (edge.connection): pools, held streams, resolved config. */
  private readonly connectionPools = new EdgeConnectionPools<ConnectionWaiter>()
  private readonly connectionLeasesByRequestId = new Map<string, HeldConnectionLease[]>()
  private readonly edgeConnectionById = new Map<string, ResolvedConnectionConfig | null>()
  /** Kafka producer batching (edge.batching): open batches and in-flight batch slots. */
  private readonly edgeBatches = new EdgeBatchAccumulator<BatchedRecord>()
  private readonly edgeBatchingById = new Map<string, ResolvedEdgeBatching | null>()
  /** Records of a sent batch still to leave the edge; the batch's slot frees at zero. */
  private readonly batchRecordsInFlight = new Map<string, number>()
  private readonly workload?: WorkloadGenerator

  private readonly requestById = new Map<string, Request>()
  /**
   * Request collapsing (single-flight): followers parked at a node behind an
   * in-flight leader request, keyed by the leader's request id. A parked
   * follower holds no worker or queue slot; it is resolved when the leader goes
   * terminal (see resolveParkedFollowers) or times out on its own deadline.
   */
  private readonly parkedFollowersByLeader = new Map<string, ParkedFollower[]>()
  /** Cluster bin-packing (scheduler trait): one scheduler per cluster node. */
  private readonly clusters = new Map<string, ClusterScheduler>()
  private readonly clusterIdByWorkload = new Map<string, string>()
  private readonly failedMachinesByCluster = new Map<string, number[]>()
  /** Ordered change consumption: the delivery holding each lane, and those waiting behind it. */
  private readonly orderingLaneHolder = new Map<string, string>()
  private readonly orderingLaneWaiting = new Map<
    string,
    Array<{ request: Request; nodeId: string; heldAt: bigint }>
  >()
  private readonly terminalStatusByRequestId = new Map<string, bigint>()
  private readonly terminalTombstoneOrder: Array<{ requestId: string; terminalAtUs: bigint }> = []
  private terminalTombstoneHead = 0
  /**
   * Bounded sample of per-request outcomes retained for UI inspection. Aggregate
   * metrics remain exact in MetricsCollector; this avoids keeping millions of
   * outcome objects alive during high-RPS runs.
   */
  private readonly retainedRequestOutcomes: RequestOutcomeRecord[] = []
  private requestOutcomeTotal = 0
  private readonly requestOutcomeBreakdown = createEmptyRequestOutcomeBreakdown()
  private readonly simulationDurationUs: bigint
  private readonly snapshotIntervalUs = secToMicro(1)
  private readonly resolvedStop: ResolvedStopCondition
  /** Why the run ended; upgraded to 'saturation' if the early-abort guard fires. */
  private stopReason: StopReason = 'duration'
  /** Sim time (µs) the run was aborted at, when saturation halted it. */
  private stoppedAtUs: bigint | null = null
  /** Sim time (µs) a driver stopped the run at before its configured end (user stop). */
  private endedEarlyAtUs: bigint | null = null

  private clock = 0n
  private lastSnapshotAt = -1n
  private eventsProcessed = 0
  private edgeFlowSequence = 0
  private forkCounter = 0
  /** Safety ceiling on how many deliveries one fan-out edge expands into per event. */
  private static readonly MAX_FANOUT_PER_EDGE = 5000
  private running = false
  private paused = false
  private pendingInFlightMetricsFlushed = false
  private readonly timeSeries: TimeSeriesSnapshot[] = []
  /** Open/closed failure intervals per component, for the status-timeline artifact. */
  private readonly statusWindows: Array<{
    componentId: string
    mode: string
    startUs: bigint
    endUs: bigint | null
    faultDomain?: FaultDomainRef
  }> = []
  /**
   * Fault domains (Region / AZ / Subnet faults) currently holding each node
   * down. A node stays failed until every domain holding it has recovered, and
   * a node-level recovery does not lift a domain outage.
   */
  private readonly domainHoldsByNodeId = new Map<string, Set<string>>()
  private debugTarget: 'all' | string | null = null
  private forcedTraceRequestId: string | null = null
  private readonly debugEvents: DebugEvent[] = []
  /** Name of the beforeArrival trait that returned the last non-continue decision. */
  private lastDecidingArrivalTrait: string | null = null

  constructor(
    private readonly topology: TopologyJSON,
    options: SimulationEngineOptions = {}
  ) {
    const rng = createRandom(topology.global.seed)
    const traitResolver = options.resolveTraits ?? resolveTraits
    this.debugInvariants = options.debugInvariants ?? false
    this.distributions = new Distributions(rng)
    this.geoLatency = new GeoLatencyResolver(topology)
    this.routing = new RoutingTable(topology.edges, rng, topology.nodes, traitResolver)
    this.metrics = new MetricsCollector({
      warmupDuration: topology.global.warmupDuration,
      nodes: topology.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        slo: node.slo
      })),
      edges: topology.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target
      }))
    })
    this.tracer = new RequestTracer({ sampleRate: topology.global.traceSampleRate ?? 0.01 })
    // The stop condition may extend/replace the time bound (request-budget mode)
    // and arm an early saturation abort.
    this.resolvedStop = resolveStopCondition(topology)
    this.simulationDurationUs = msToMicro(this.resolvedStop.effectiveDurationMs)
    this.stopReason = this.resolvedStop.mode === 'requestBudget' ? 'request-budget' : 'duration'

    const scheduler: EventScheduler = {
      schedule: (event) => this.eventQueue.insert(event)
    }

    for (const node of topology.nodes) {
      const normalized = this.withNodeDefaults(node)
      this.nodeDefinitionsById.set(node.id, normalized)
      this.traitsByNodeId.set(node.id, traitResolver(normalized))
      this.nodes.set(node.id, new GGcKNode(normalized, this.distributions, scheduler))
      // Report limits against the DERIVED effective c/K (what the node actually
      // ran with), not the vestigial authored queue — so utilization, saturation
      // "workers avg", and node metrics all divide by the real concurrency.
      const derived = deriveNodeConcurrency(normalized)
      this.nodeLimitsById.set(node.id, {
        workers: derived.effectiveC,
        capacity: derived.effectiveK
      })
      if (derived.heldConnections) {
        // Steady-state held connections: held for the whole run, the overflow
        // refused once (persistentConnFanout).
        this.metrics.recordNodeTraitCounters(node.id, {
          connectionsHeld: derived.heldConnections.held,
          ...(derived.heldConnections.refused > 0
            ? { connectionsRefused: derived.heldConnections.refused }
            : {})
        })
      }

      const nodeErrorRate = this.readNodeErrorRate(normalized)
      if (nodeErrorRate !== null && nodeErrorRate > 0) {
        this.nodeErrorRateById.set(node.id, nodeErrorRate)
      }

      if (normalized.processing?.timeout) {
        this.nodeTimeoutUsById.set(node.id, msToMicro(normalized.processing.timeout))
      }

      const configuredFailureSpec = parseFailureSpec(normalized.config?.['failureSpec'])
      if (configuredFailureSpec) {
        this.nodeFailureSpecById.set(node.id, configuredFailureSpec)
      }

      const securityPolicy = this.readSecurityPolicy(normalized)
      if (securityPolicy) {
        this.securityPolicyByNodeId.set(node.id, securityPolicy)
      }

      if (normalized.type === 'health-check-manager') {
        const proberConfig = parseHealthCheckManagerConfig(normalized.config)
        if (proberConfig) {
          this.healthCheckManagerConfigById.set(node.id, proberConfig)
          for (const monitoredNodeId of proberConfig.monitoredNodes) {
            this.probedNodeIds.add(monitoredNodeId)
            if (!this.probeStateByNodeId.has(monitoredNodeId)) {
              this.probeStateByNodeId.set(monitoredNodeId, createInitialProbeState())
            }
          }
          scheduler.schedule(
            createEvent('health-check', node.id, '', {}, msToMicro(proberConfig.checkIntervalMs))
          )
        }
      }

      // Recurring-timer traits (onTick): schedule the first tick; the handler
      // re-arms it each fire, and the event-loop time bound stops it past the
      // simulation end. Deterministic — fixed SYSTEM-priority events on the clock.
      for (const trait of this.traitsByNodeId.get(node.id) ?? []) {
        if (!trait.onTick || !trait.tickIntervalMs) {
          continue
        }
        const intervalMs = trait.tickIntervalMs(normalized)
        if (typeof intervalMs === 'number' && Number.isFinite(intervalMs) && intervalMs > 0) {
          scheduler.schedule(
            createEvent(
              'trait-tick',
              node.id,
              '',
              { traitName: trait.name, intervalMs },
              msToMicro(intervalMs)
            )
          )
        }
      }

      this.initializeReplicationRuntime(normalized)
      this.initializeStreamBrokerRuntime(normalized, scheduler)
    }

    this.scheduleInitialStreamConsumerRebalances(scheduler)
    this.initializeClusterScheduling(scheduler)

    if (topology.workload) {
      this.workload = new WorkloadGenerator(topology.workload, rng, scheduler, {
        defaultTimeoutMs: topology.global.defaultTimeout,
        simulationDurationMs: this.resolvedStop.effectiveDurationMs,
        maxRequests: this.resolvedStop.maxRequests ?? undefined
      })
      this.workload.initialize(0n)
    }

    this.scheduleConfiguredFaults(scheduler)
  }

  /**
   * Turn declared chaos faults into scheduled node-failure / node-recovery
   * events — the bridge that makes the failure suite reachable from a topology.
   * Each fault carries its timing and failure spec in `params`:
   *   { atMs, durationMs?, mode?, inFlightPolicy?, recoveryPolicy?, degradation? }
   * A `fixed`-duration fault recovers after `durationMs`; `permanent` never does.
   * An unspecified mode defaults to the realistic silent dead server (blackhole).
   * A `cache-flush` fault is not a failure: it empties a cache node at `atMs`
   * (see `scheduleCacheFlush` in traits/cache.ts for how each hit model reacts).
   */
  private scheduleConfiguredFaults(scheduler: EventScheduler): void {
    for (const fault of this.topology.faults ?? []) {
      if (!this.nodes.has(fault.targetId)) {
        this.scheduleFaultDomainFault(scheduler, fault)
        continue
      }
      const params = (fault.params ?? {}) as Record<string, unknown>
      const atMs = typeof params.atMs === 'number' && params.atMs >= 0 ? params.atMs : 0
      if (fault.faultType === CACHE_FLUSH_FAULT_TYPE) {
        // Not a node failure: the cache keeps serving but loses its contents.
        const durationMs =
          typeof params.durationMs === 'number' && params.durationMs > 0
            ? params.durationMs
            : DEFAULT_CACHE_FLUSH_REWARM_MS
        scheduleCacheFlush(this.getTraitStateStore(fault.targetId), {
          atUs: msToMicro(atMs),
          untilUs: msToMicro(atMs + durationMs)
        })
        continue
      }
      const spec = parseFailureSpec(params) ?? DEFAULT_CHAOS_FAILURE_SPEC

      scheduler.schedule(
        createEvent('node-failure', fault.targetId, '', { failureSpec: spec }, msToMicro(atMs))
      )

      const durationMs = typeof params.durationMs === 'number' ? params.durationMs : 0
      if (fault.duration !== 'permanent' && durationMs > 0) {
        scheduler.schedule(
          createEvent('node-recovery', fault.targetId, '', {}, msToMicro(atMs + durationMs))
        )
      }
    }
  }

  /**
   * A fault whose target is a Region / AZ / Subnet location fails every node
   * placed inside it (see core/faultDomains.ts) with the same spec and window,
   * through the ordinary node-failure / node-recovery events. The events carry
   * the domain so results can say which outage took each node down. A location
   * with no members schedules nothing (the validator warns about it); a cache
   * flush is per cache and does not apply to a location.
   */
  private scheduleFaultDomainFault(
    scheduler: EventScheduler,
    fault: NonNullable<TopologyJSON['faults']>[number]
  ): void {
    if (fault.faultType === CACHE_FLUSH_FAULT_TYPE) return
    const location = findFaultDomain(this.topology, fault.targetId)
    if (!location) return
    const domain = faultDomainRef(location)
    const params = (fault.params ?? {}) as Record<string, unknown>
    const atMs = typeof params.atMs === 'number' && params.atMs >= 0 ? params.atMs : 0
    const spec = parseFailureSpec(params) ?? DEFAULT_CHAOS_FAILURE_SPEC
    const durationMs = typeof params.durationMs === 'number' ? params.durationMs : 0
    const recovers = fault.duration !== 'permanent' && durationMs > 0
    for (const nodeId of faultDomainMemberIds(this.topology, location.id)) {
      if (!this.nodes.has(nodeId)) continue
      scheduler.schedule(
        createEvent(
          'node-failure',
          nodeId,
          '',
          { failureSpec: spec, faultDomain: domain },
          msToMicro(atMs)
        )
      )
      if (recovers) {
        scheduler.schedule(
          createEvent(
            'node-recovery',
            nodeId,
            '',
            { faultDomain: domain },
            msToMicro(atMs + durationMs)
          )
        )
      }
    }
  }

  private initializeStreamBrokerRuntime(node: ComponentNode, scheduler: EventScheduler): void {
    if (node.type !== 'stream' || node.config?.['streamBrokerEnabled'] !== true) {
      return
    }

    const state = this.getSharedTraitStateStore()
    state.set(
      streamBrokerLogStateKey(node.id),
      new ReplicatedLog(readStreamPartitionCount(node.config), readStreamRetentionMs(node.config))
    )
    state.set(streamBrokerAvailabilityStateKey(node.id), true)

    const failureAtMs = node.config?.['brokerFailureAtMs']
    if (typeof failureAtMs === 'number' && Number.isFinite(failureAtMs) && failureAtMs >= 0) {
      scheduler.schedule(createEvent('broker-failure', node.id, '', {}, msToMicro(failureAtMs)))
    }

    const recoveryAtMs = node.config?.['brokerRecoveryAtMs']
    if (typeof recoveryAtMs === 'number' && Number.isFinite(recoveryAtMs) && recoveryAtMs >= 0) {
      scheduler.schedule(createEvent('broker-recovery', node.id, '', {}, msToMicro(recoveryAtMs)))
    }

    const replayIntervalMs = this.readStreamReplayIntervalMs(node)
    if (replayIntervalMs > 0) {
      scheduler.schedule(createEvent('stream-replay', node.id, '', {}, msToMicro(replayIntervalMs)))
    }
  }

  private initializeReplicationRuntime(node: ComponentNode): void {
    if (node.config?.['replicationEnabled'] !== true) {
      return
    }

    const state = this.getSharedTraitStateStore()
    const key = replicationClusterStateKey(node.id, node.config)
    if (!state.get<ReplicaCluster>(key)) {
      state.set(key, createReplicationCluster(node.id, node.config))
    }
  }

  private scheduleInitialStreamConsumerRebalances(scheduler: EventScheduler): void {
    for (const node of this.nodeDefinitionsById.values()) {
      if (node.type !== 'stream' || node.config?.['streamBrokerEnabled'] !== true) {
        continue
      }
      if (node.config?.['consumerGroupMode'] !== true) {
        continue
      }
      for (const [group, members] of this.streamConsumerGroupsForBroker(node.id, false)) {
        scheduler.schedule(
          createEvent(
            'consumer-group-rebalance',
            node.id,
            '',
            { consumerGroup: group, members },
            0n
          )
        )
      }
    }
  }

  enableDebug(target: 'all' | string = 'all', options: { forceTrace?: boolean } = {}): void {
    if (this.forcedTraceRequestId) {
      this.tracer.unforceTrace(this.forcedTraceRequestId)
      this.forcedTraceRequestId = null
    }

    this.debugTarget = target
    this.debugEvents.length = 0
    this.eventRecorder.setMaxRetainedEvents(Number.POSITIVE_INFINITY)

    if (target !== 'all' && options.forceTrace) {
      this.tracer.forceTrace(target)
      this.forcedTraceRequestId = target
    }
  }

  disableDebug(): void {
    if (this.forcedTraceRequestId) {
      this.tracer.unforceTrace(this.forcedTraceRequestId)
      this.forcedTraceRequestId = null
    }

    this.debugTarget = null
    this.debugEvents.length = 0
    this.eventRecorder.setMaxRetainedEvents(DEFAULT_MAX_RETAINED_EVENT_STREAM_EVENTS)
  }

  run(): SimulationOutput {
    this.running = true
    this.paused = false
    this.pendingInFlightMetricsFlushed = false
    if (this.debugTarget) {
      this.debugEvents.length = 0
    }

    this.processEvents()
    return this.generateResults()
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  stop(): void {
    this.running = false
  }

  step(count: number): void {
    this.stepBounded(count)
  }

  /**
   * Process up to `maxEvents` events whose timestamp is at or before
   * `simTimeMs`. This is what paced (playback-speed) drivers use to advance the
   * run to a wall-clock-derived target without overshooting it. Like `step`, a
   * no-op once the run has halted.
   */
  stepUntil(simTimeMs: number, maxEvents: number): void {
    if (!Number.isFinite(simTimeMs)) {
      this.stepBounded(maxEvents)
      return
    }
    this.stepBounded(maxEvents, msToMicro(Math.max(0, simTimeMs)))
  }

  private stepBounded(count: number, untilUs?: bigint): void {
    if (count <= 0 || this.isHalted()) {
      return
    }
    const wasPaused = this.paused
    this.running = true
    this.paused = false
    this.processEvents(count, untilUs)
    this.paused = wasPaused
  }

  /**
   * True once the saturation guard has halted the run. The halt is sticky: a
   * chunked driver calling `step()` afterwards must not resume past it (that
   * would silently turn an early abort into a full-length run), so `step` and
   * `stepUntil` become no-ops and `hasPendingEvents` reports false.
   */
  isHalted(): boolean {
    return this.stopReason === 'saturation'
  }

  /** Current simulated time in ms (the timestamp of the last processed event). */
  getClockMs(): number {
    return microToMs(this.clock)
  }

  /** Timestamp (ms) of the next event inside the run window, or null when none. */
  peekNextEventTimeMs(): number | null {
    if (!this.hasPendingEvents()) {
      return null
    }
    const next = this.eventQueue.peek()
    return next ? microToMs(next.timestamp) : null
  }

  hasPendingEvents(): boolean {
    if (this.isHalted()) {
      return false
    }
    if (this.clock >= this.simulationDurationUs) {
      return false
    }
    const nextEvent = this.eventQueue.peek()
    return nextEvent !== undefined && nextEvent.timestamp <= this.simulationDurationUs
  }

  getResults(): SimulationOutput {
    return this.generateResults()
  }

  /**
   * Record that a driver stopped the run before its configured end (the user
   * pressed Stop). Results then measure rates and utilization over the time the
   * run actually covered instead of the full configured duration.
   */
  markStoppedEarly(): void {
    // A finished run can end with the clock short of the window (no events left),
    // so only a run that still had work pending counts as stopped early.
    if (this.stoppedAtUs === null && this.hasPendingEvents()) {
      this.endedEarlyAtUs = this.clock
    }
  }

  captureSnapshot(): TimeSeriesSnapshot {
    const snapshot = this.takeSnapshot()
    this.timeSeries.push(snapshot)
    return snapshot
  }

  getEventsProcessed(): number {
    return this.eventsProcessed
  }

  /**
   * Why the run ended (or will end). Chunked drivers (`step`) check this for
   * `'saturation'`: the early-abort guard halts inside `processEvents`, but a
   * later `step()` call would otherwise resume past the halt.
   */
  getStopReason(): StopReason {
    return this.stopReason
  }

  getEventStream(): CanonicalEventRecord[] {
    return this.eventRecorder.getEvents()
  }

  getEventCountsByType(): EventCountsByType {
    return this.eventRecorder.getCountsByType()
  }

  private recordCanonicalEvent(input: AppendEventInput): CanonicalEventRecord {
    this.causalGraphRecorder.observe(input)
    return this.eventRecorder.append(input)
  }

  private recordSimulationEvent(
    event: SimulationEvent,
    nodeSnapshot?: NodeSnapshot
  ): CanonicalEventRecord | null {
    const input = eventInputFromSimulationEvent(event)
    if (!input) {
      return null
    }

    return this.recordCanonicalEvent({
      ...input,
      nodeSnapshot
    })
  }

  private emitAdmissionDecision(
    requestId: string,
    nodeId: string,
    decision: AdmissionDecisionStatus,
    reasonCode?: string,
    nodeSnapshot?: NodeSnapshot,
    sequence?: number
  ): void {
    this.onAdmissionDecision?.({
      sequence,
      timestampUs: this.clock.toString(),
      requestId,
      nodeId,
      decision,
      reasonCode,
      nodeSnapshot
    })
  }

  /** Live G/G/c/K occupancy of a node, for a traced request's admission record. */
  private captureTracedNodeState(nodeId: string): TracedNodeState | null {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return null
    }

    const state = node.getState()
    return {
      status: state.status,
      activeWorkers: state.activeWorkers,
      queueLength: state.queueLength,
      heldCount: Math.max(0, state.totalInSystem - state.activeWorkers - state.queueLength),
      totalInSystem: state.totalInSystem,
      workers: node.getMaxWorkers(),
      capacity: node.getMaxCapacity()
    }
  }

  /**
   * Records one admission decision for a traced request (no-op otherwise). The
   * state defaults to the node's occupancy now; callers that change occupancy
   * before recording pass the pre-decision state explicitly.
   */
  private traceAdmission(
    request: Request,
    nodeId: string,
    stage: RequestAdmissionStage,
    outcome: RequestAdmissionOutcome,
    extra: {
      reasonCode?: string
      traitName?: string
      state?: TracedNodeState | null
      policy?: Record<string, number>
    } = {}
  ): void {
    if (!this.tracer.shouldTrace(request.id)) {
      return
    }

    const node = this.nodes.get(nodeId)
    this.tracer.recordAdmission(request.id, {
      nodeId,
      atUs: this.clock,
      stage,
      outcome,
      reasonCode: extra.reasonCode,
      traitName: extra.traitName,
      state: extra.state !== undefined ? extra.state : this.captureTracedNodeState(nodeId),
      admissionBoundBy: node?.getAdmissionBoundBy(),
      concurrencyProvenance: node?.concurrencyProvenance || undefined,
      failureMode: node?.getFailureMode() ?? undefined,
      policy: extra.policy
    })
  }

  private createNodeSnapshot(nodeId: string): NodeSnapshot | undefined {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return undefined
    }

    const state = node.getState()
    const limits = this.nodeLimitsById.get(nodeId)
    return {
      nodeId,
      timestampUs: this.clock.toString(),
      status: state.status,
      queueLength: state.queueLength,
      activeWorkers: state.activeWorkers,
      utilization: state.utilization,
      totalInSystem: state.totalInSystem,
      workers: limits?.workers,
      capacity: limits?.capacity
    }
  }

  private processEvents(maxEvents?: number, untilUs?: bigint): void {
    let processedInCall = 0

    while (this.running && !this.paused && !this.eventQueue.isEmpty) {
      if (maxEvents !== undefined && processedInCall >= maxEvents) {
        break
      }

      const nextEvent = this.eventQueue.peek()
      if (!nextEvent) {
        break
      }

      // Paced drivers: stop at the wall-clock-derived target without ending the run.
      if (untilUs !== undefined && nextEvent.timestamp > untilUs) {
        break
      }

      if (nextEvent.timestamp > this.simulationDurationUs) {
        this.running = false
        break
      }

      const event = this.eventQueue.extractMin()
      if (!event) {
        break
      }

      this.clock = event.timestamp

      if (this.shouldEmitSnapshot(this.clock)) {
        const snapshot = this.takeSnapshot()
        this.timeSeries.push(snapshot)
        this.onSnapshot?.(snapshot)
        if (this.checkSaturationHalt(snapshot)) {
          this.running = false
          break
        }
      }

      this.handleEvent(event)
      if (this.debugInvariants) {
        this.assertAllNodeInvariants()
      }
      this.eventsProcessed++
      processedInCall++

      if (this.eventsProcessed % 1000 === 0) {
        const percent = Math.min(
          100,
          (microToMs(this.clock) / this.topology.global.simulationDuration) * 100
        )
        this.onProgress?.(percent, this.eventsProcessed)
      }
    }

    if (this.eventQueue.isEmpty || this.clock >= this.simulationDurationUs) {
      this.running = false
    }
  }

  private handleEvent(event: SimulationEvent): void {
    switch (event.type) {
      case 'request-generated':
        this.handleRequestGenerated(event)
        break
      case 'request-arrival':
        this.handleRequestArrival(event)
        break
      case 'processing-complete':
        this.handleProcessingComplete(event)
        break
      case 'request-forwarded':
        this.handleRequestForwarded(event)
        break
      case 'request-complete':
        this.handleRequestComplete(event)
        break
      case 'request-timeout':
        this.handleRequestTimeout(event)
        break
      case 'request-rejected':
        this.handleRequestRejected(event)
        break
      case 'node-failure':
        this.handleNodeFailure(event)
        break
      case 'node-recovery':
        this.handleNodeRecovery(event)
        break
      case 'health-check':
        this.handleHealthProbe(event)
        break
      case 'trait-tick':
        this.handleTraitTick(event)
        break
      case 'stream-retention-expire':
        this.handleStreamRetentionExpire(event)
        break
      case 'stream-replay':
        this.handleStreamReplay(event)
        break
      case 'consumer-group-rebalance':
        this.handleConsumerGroupRebalance(event)
        break
      case 'broker-failure':
        this.handleBrokerFailure(event)
        break
      case 'broker-recovery':
        this.handleBrokerRecovery(event)
        break
      case 'edge-batch-flush':
        this.handleEdgeBatchFlush(event)
        break
      case 'cluster-schedule':
        this.handleClusterSchedule(event)
        break
      default:
        // Other event types are integrated in later tickets.
        break
    }
  }

  private handleRequestGenerated(event: SimulationEvent): void {
    if (!this.workload) {
      return
    }

    const request = this.workload.generateNext(this.clock)
    if (!request.origin) {
      const sourceRegionId = this.geoLatency.servingRegionId(event.nodeId)
      if (sourceRegionId) {
        request.origin = {
          originId: `source:${sourceRegionId}`,
          label: this.geoLatency.locationLabel(sourceRegionId) ?? sourceRegionId,
          location: { kind: 'region', regionId: sourceRegionId }
        }
      }
    }
    this.metrics.recordGeneratedRequest(request.createdAt)
    event.requestId = request.id
    event.data.request = request
    this.requestById.set(request.id, request)
    this.terminalStatusByRequestId.delete(request.id)
    this.tracer.setRequestCreatedAt(request.id, request.createdAt)
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'request-generated',
      priority: event.priority,
      requestId: request.id,
      nodeId: event.nodeId,
      payload: { request }
    })
    this.recordRequestState(request, 'generated', {
      nodeId: event.nodeId,
      timestampUs: this.clock
    })

    const sourceNodeId = event.nodeId
    const routeResult = this.resolveRoutes(sourceNodeId, request)
    if (routeResult.rejectionReason) {
      this.rejectRequestAtNode(sourceNodeId, request, routeResult.rejectionReason, this.clock)
      return
    }

    const routes = this.expandFanoutRoutes(routeResult.routes, sourceNodeId)
    if (routes.length === 0) {
      if (this.nodes.has(sourceNodeId)) {
        this.eventQueue.insert(
          createEvent('request-arrival', sourceNodeId, request.id, { request }, this.clock)
        )
      } else {
        this.eventQueue.insert(
          createEvent('request-complete', sourceNodeId, request.id, { request }, this.clock)
        )
      }
      return
    }

    const routedRequests = this.prepareRequestsForRoutes(request, routes.length)
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]
      const routedRequest = routedRequests[i]
      if (routedRequest.id !== request.id) {
        this.requestById.set(routedRequest.id, routedRequest)
        this.terminalStatusByRequestId.delete(routedRequest.id)
        this.tracer.setRequestCreatedAt(routedRequest.id, routedRequest.createdAt)
        this.recordCanonicalEvent({
          timestampUs: this.clock,
          type: 'request-generated',
          priority: event.priority,
          requestId: routedRequest.id,
          nodeId: sourceNodeId,
          payload: { request: routedRequest, branchOfRequestId: request.id }
        })
        this.recordRequestState(routedRequest, 'generated', {
          nodeId: sourceNodeId,
          timestampUs: this.clock
        })
      }
      this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'request-forwarded',
        priority: EventPriority.DEPARTURE,
        requestId: routedRequest.id,
        nodeId: sourceNodeId,
        edgeId: route.edge.id,
        sourceNodeId: route.edge.source,
        targetNodeId: route.targetNodeId,
        payload: { request: routedRequest, edge: route.edge, targetNodeId: route.targetNodeId }
      })
      this.enqueueEdgeTransfer(routedRequest, route.edge, route.targetNodeId)
    }
  }

  private handleRequestArrival(event: SimulationEvent): void {
    const node = this.nodes.get(event.nodeId)
    const request = this.getRequest(event)
    if (!node || !request) {
      return
    }

    const internalQueueConsumer = event.data.internalQueueConsumer === true
    const branchOfRequestId =
      typeof event.data.branchOfRequestId === 'string' ? event.data.branchOfRequestId : undefined
    if (internalQueueConsumer && branchOfRequestId) {
      this.tracer.setRequestCreatedAt(request.id, request.createdAt)
      this.recordCanonicalEvent({
        timestampUs: request.createdAt,
        type: 'request-generated',
        priority: EventPriority.ARRIVAL,
        requestId: request.id,
        nodeId: event.nodeId,
        payload: { request, branchOfRequestId, internalQueueConsumer: true }
      })
      this.recordRequestState(request, 'generated', {
        nodeId: event.nodeId,
        timestampUs: request.createdAt
      })
      this.recordRequestState(request, 'released-to-consumer', {
        scope: 'delivery',
        nodeId: event.nodeId,
        timestampUs: this.clock,
        source: 'engine',
        detail: 'Queue released the message to a consumer attempt.'
      })
    }

    this.releaseEdgeSlotForEvent(event)
    this.releaseConnectionLeases(request.id, event.data.edgeId, 'delivered')
    this.appendNodeToPath(request, event.nodeId)
    const arrivedRegionId = this.geoLatency.servingRegionId(event.nodeId)
    request.servingRegionId = arrivedRegionId ?? request.servingRegionId
    request.servingRegionLabel = arrivedRegionId
      ? this.geoLatency.locationDisplayName(arrivedRegionId)
      : request.servingRegionLabel
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.metrics.recordNodeArrival(event.nodeId, this.clock)
    this.recordNodePhaseArrival(request, event.nodeId, this.clock)
    this.recordRequestState(request, 'admitted', {
      nodeId: event.nodeId,
      timestampUs: this.clock
    })

    if (internalQueueConsumer) {
      this.admitToNodeQueue(node, event.nodeId, request)
      return
    }

    if (this.holdForOrderingLane(event.nodeId, request)) {
      return
    }

    this.continueArrival(node, event.nodeId, request)
  }

  /**
   * Arrival processing after a request is at the node and counted: security
   * policy, arrival traits, then the queue. Split out so a change delivery that
   * waited for its ordering lane resumes exactly here when released.
   */
  private continueArrival(node: GGcKNode, nodeId: string, request: Request): void {
    if (this.applySecurityPolicy(nodeId, request)) {
      return
    }

    const arrivalTraitDecision = this.runBeforeArrivalTraits(nodeId, request)
    if (arrivalTraitDecision.action !== 'continue') {
      this.traceAdmission(
        request,
        nodeId,
        'trait',
        arrivalTraitDecision.action === 'rejected'
          ? 'rejected'
          : arrivalTraitDecision.action === 'parked'
            ? 'parked'
            : 'handled',
        {
          reasonCode:
            arrivalTraitDecision.action === 'rejected' ? arrivalTraitDecision.reason : undefined,
          traitName: this.lastDecidingArrivalTrait ?? undefined
        }
      )
    }
    if (arrivalTraitDecision.action === 'rejected') {
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          nodeId,
          request.id,
          {
            request,
            reason: arrivalTraitDecision.reason,
            nodeArrivalTime: this.clock
          },
          this.clock
        )
      )
      return
    }

    if (arrivalTraitDecision.action === 'parked') {
      this.parkFollower(nodeId, request, arrivalTraitDecision.leaderRequestId)
      return
    }

    if (arrivalTraitDecision.action === 'handled') {
      this.completeRequestViaTrait(nodeId, request, arrivalTraitDecision)

      if (arrivalTraitDecision.payload?.forkConsumerRequest === true) {
        this.forkConsumerRequest(node, nodeId, request)
      }
      return
    }

    this.admitToNodeQueue(node, nodeId, request)
  }

  /**
   * Ordered change consumption (change-stream trait). A change delivery from a
   * stream with `consumerOrdering` per-partition / per-key waits at the consumer
   * while an earlier delivery in its lane (same partition, or same entity) is
   * still in flight, and is released when that one finishes. Returns true when
   * the request was held.
   */
  private holdForOrderingLane(nodeId: string, request: Request): boolean {
    const streamNodeId = request.metadata[CHANGE_STREAM_NODE_META]
    if (typeof streamNodeId !== 'string') return false
    if (request.path[request.path.length - 2] !== streamNodeId) return false
    const lane = orderingLaneOf(request, nodeId)
    if (!lane) return false
    const holder = this.orderingLaneHolder.get(lane)
    if (holder === undefined || holder === request.id) {
      this.orderingLaneHolder.set(lane, request.id)
      request.metadata[ORDERING_LANE_META] = lane
      return false
    }
    const waiting = this.orderingLaneWaiting.get(lane) ?? []
    waiting.push({ request, nodeId, heldAt: this.clock })
    this.orderingLaneWaiting.set(lane, waiting)
    this.metrics.recordNodeTraitCounters(streamNodeId, { changeEventsWaitedForOrder: 1 })
    this.recordRequestState(request, 'queued', {
      nodeId,
      timestampUs: this.clock,
      source: 'trait',
      detail: `Waiting for the earlier change in ordering lane ${lane} to finish.`
    })
    this.eventQueue.insert(
      createEvent(
        'request-timeout',
        nodeId,
        request.id,
        {
          request,
          nodeArrivalTime: this.clock,
          scope: 'ordering-lane',
          lane,
          timeoutSeq: request.timeoutSeq ?? 0
        },
        request.deadline > this.clock ? request.deadline : this.clock
      )
    )
    return true
  }

  /** The lane's in-flight change finished: hand the lane to the next waiting delivery. */
  private releaseOrderingLane(request: Request): void {
    const lane = request.metadata[ORDERING_LANE_META]
    if (typeof lane !== 'string' || this.orderingLaneHolder.get(lane) !== request.id) return
    this.orderingLaneHolder.delete(lane)
    const waiting = this.orderingLaneWaiting.get(lane)
    while (waiting && waiting.length > 0) {
      const next = waiting.shift()!
      if (next.request.metadata.__terminal || this.terminalStatusByRequestId.has(next.request.id)) {
        continue
      }
      const node = this.nodes.get(next.nodeId)
      if (!node) continue
      this.orderingLaneHolder.set(lane, next.request.id)
      next.request.metadata[ORDERING_LANE_META] = lane
      if (waiting.length === 0) this.orderingLaneWaiting.delete(lane)
      this.continueArrival(node, next.nodeId, next.request)
      return
    }
    this.orderingLaneWaiting.delete(lane)
  }

  /** A held delivery's deadline passed while it waited; returns false when it was already released. */
  private dropFromOrderingLane(lane: string, requestId: string): boolean {
    const waiting = this.orderingLaneWaiting.get(lane)
    if (!waiting) return false
    const index = waiting.findIndex((entry) => entry.request.id === requestId)
    if (index < 0) return false
    waiting.splice(index, 1)
    if (waiting.length === 0) this.orderingLaneWaiting.delete(lane)
    return true
  }

  private completeRequestViaTrait(
    nodeId: string,
    request: Request,
    decision: Extract<BeforeArrivalDecision, { action: 'handled' }>
  ): void {
    const completionTime = this.clock + decision.latencyUs
    this.markNodePhaseServiceStart(request, nodeId, this.clock)
    if (decision.payload?.forkConsumerRequest === true) {
      this.recordRequestState(request, 'producer-acked', {
        scope: 'delivery',
        nodeId,
        timestampUs: this.clock,
        source: 'trait',
        detail: 'Queue acknowledged the producer before consumer processing.'
      })
    }
    if (request.deadline <= completionTime) {
      this.eventQueue.insert(
        createEvent(
          'request-timeout',
          nodeId,
          request.id,
          {
            request,
            nodeArrivalTime: this.clock,
            scope: 'trait',
            timeoutSeq: request.timeoutSeq ?? 0
          },
          request.deadline
        )
      )
      return
    }

    const servedFromCache = decision.payload?.servedFromCache === true
    if (servedFromCache) {
      request.metadata.servedFromCache = true
    }
    // A trait that discards the request (a dropped telemetry event) ends it here
    // without serving it, so it must not count as work this node processed.
    if (decision.payload?.notServed !== true) {
      request.spans.push({
        nodeId,
        arrivalTime: this.clock,
        queueWait: 0n,
        serviceTime: decision.latencyUs,
        departureTime: completionTime
      })
    }
    this.markNodePhaseDeparture(request, nodeId, completionTime)
    this.eventQueue.insert(
      createEvent(
        'request-complete',
        nodeId,
        request.id,
        { request, ...(servedFromCache ? { servedFromCache: true } : {}) },
        completionTime
      )
    )
  }

  /**
   * Parks a follower behind an in-flight leader (request collapsing). The
   * follower is not admitted to the node's queue, so it consumes no worker or
   * queue slot and makes no downstream call. Its own deadline still applies:
   * if the leader has not returned by then, the follower times out here.
   */
  private parkFollower(nodeId: string, request: Request, leaderRequestId: string): void {
    const followers = this.parkedFollowersByLeader.get(leaderRequestId) ?? []
    followers.push({ request, nodeId, parkedAt: this.clock })
    this.parkedFollowersByLeader.set(leaderRequestId, followers)
    this.recordRequestState(request, 'queued', {
      nodeId,
      timestampUs: this.clock,
      source: 'trait',
      detail: `Collapsed: waiting for in-flight miss ${leaderRequestId} instead of calling downstream.`
    })
    this.eventQueue.insert(
      createEvent(
        'request-timeout',
        nodeId,
        request.id,
        {
          request,
          nodeArrivalTime: this.clock,
          scope: 'collapse',
          collapseLeaderId: leaderRequestId,
          timeoutSeq: request.timeoutSeq ?? 0
        },
        request.deadline
      )
    )
  }

  private unparkFollower(leaderRequestId: string, requestId: string): void {
    const followers = this.parkedFollowersByLeader.get(leaderRequestId)
    if (!followers) {
      return
    }
    const remaining = followers.filter((follower) => follower.request.id !== requestId)
    if (remaining.length === 0) {
      this.parkedFollowersByLeader.delete(leaderRequestId)
    } else {
      this.parkedFollowersByLeader.set(leaderRequestId, remaining)
    }
  }

  /**
   * Resolves every follower parked behind `leader` once the leader is terminal.
   * Success: each follower completes now, at the node it parked on, with its
   * wait recorded as queue time (so its end-to-end latency is the leader's
   * remaining time plus its own path). Failure: each follower fails with the
   * leader's cause (single-flight shares one result, error included). A leader
   * timeout surfaces as a follower timeout with reason `collapsed_leader_timeout`.
   */
  private resolveParkedFollowers(
    leader: Request,
    status: TerminalRequestStatus,
    reasonCode?: string | null
  ): void {
    const followers = this.parkedFollowersByLeader.get(leader.id)
    if (!followers) {
      return
    }
    this.parkedFollowersByLeader.delete(leader.id)
    const servedByNode = new Map<string, number>()
    const failedByNode = new Map<string, number>()
    for (const { request, nodeId, parkedAt } of followers) {
      if (request.metadata.__terminal || this.terminalStatusByRequestId.has(request.id)) {
        continue
      }
      // Supersede the follower's own deadline timeout scheduled at park time.
      request.timeoutSeq = (request.timeoutSeq ?? 0) + 1
      if (status === 'success') {
        request.spans.push({
          nodeId,
          arrivalTime: parkedAt,
          queueWait: this.clock - parkedAt,
          serviceTime: 0n,
          departureTime: this.clock
        })
        this.markNodePhaseServiceStart(request, nodeId, this.clock)
        this.markNodePhaseDeparture(request, nodeId, this.clock)
        this.eventQueue.insert(
          createEvent(
            'request-complete',
            nodeId,
            request.id,
            { request, collapsedFollower: true },
            this.clock
          )
        )
        servedByNode.set(nodeId, (servedByNode.get(nodeId) ?? 0) + 1)
        continue
      }

      failedByNode.set(nodeId, (failedByNode.get(nodeId) ?? 0) + 1)
      if (status === 'timeout') {
        this.eventQueue.insert(
          createEvent(
            'request-timeout',
            nodeId,
            request.id,
            {
              request,
              nodeArrivalTime: parkedAt,
              scope: 'collapse-leader',
              reason: 'collapsed_leader_timeout',
              timeoutSeq: request.timeoutSeq
            },
            this.clock
          )
        )
        continue
      }
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          nodeId,
          request.id,
          {
            request,
            reason: reasonCode ?? (status === 'connection_reset' ? 'connection_reset' : 'rejected'),
            nodeArrivalTime: parkedAt
          },
          this.clock
        )
      )
    }
    for (const [nodeId, count] of servedByNode) {
      this.metrics.recordNodeTraitCounters(nodeId, { collapsedFollowersServed: count })
    }
    for (const [nodeId, count] of failedByNode) {
      this.metrics.recordNodeTraitCounters(nodeId, { collapsedFollowersFailed: count })
    }
  }

  /**
   * Spawns an independent lifecycle for a request that a trait acknowledged
   * immediately (e.g. AckAndReleaseTrait) — the clone enters the node's real
   * queue directly, bypassing beforeArrival traits so the ack doesn't
   * re-trigger itself in an infinite fork loop.
   */
  private forkConsumerRequest(_node: GGcKNode, nodeId: string, producerRequest: Request): void {
    this.scheduleQueueDeliveryAttempt(producerRequest, nodeId, this.clock, {
      branchOfRequestId: producerRequest.id,
      retryCount: producerRequest.retryCount ?? 0
    })
  }

  private admitToNodeQueue(node: GGcKNode, nodeId: string, request: Request): void {
    // The debugger's intake lens needs the occupancy the rule compared, i.e.
    // BEFORE this arrival is counted. Read only for traced requests.
    const tracedState = this.tracer.shouldTrace(request.id)
      ? this.captureTracedNodeState(nodeId)
      : null
    const result = node.handleArrival(request, this.clock)
    const nodeSnapshot = this.createNodeSnapshot(nodeId)
    if (tracedState) {
      this.traceAdmission(
        request,
        nodeId,
        'node',
        result.status === 'processed' ? 'processing' : result.status,
        { reasonCode: result.status === 'rejected' ? result.reason : undefined, state: tracedState }
      )
    }
    if (result.status === 'rejected') {
      this.emitAdmissionDecision(request.id, nodeId, 'rejected', result.reason, nodeSnapshot)
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          nodeId,
          request.id,
          { request, reason: result.reason, nodeArrivalTime: this.clock },
          this.clock
        )
      )
      return
    }

    if (result.status === 'held') {
      // Admitted into a failed node's silent limbo (blackhole or hang). No
      // service and no queue/processing lifecycle event — only a timeout so the
      // client eventually gives up. This is what walls latency at the timeout.
      this.scheduleHeldTimeout(nodeId, request)
      return
    }

    if (result.status === 'processed') {
      this.markNodePhaseServiceStart(request, nodeId, this.clock)
    }

    if (result.status === 'queued') {
      const record = this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'request-queued',
        priority: EventPriority.ARRIVAL,
        requestId: request.id,
        nodeId,
        payload: { request },
        nodeSnapshot
      })
      this.emitAdmissionDecision(
        request.id,
        nodeId,
        'queued',
        undefined,
        nodeSnapshot,
        record.sequence
      )
      this.recordRequestState(request, 'queued', {
        nodeId,
        timestampUs: this.clock
      })
    } else {
      const record = this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'processing-started',
        priority: EventPriority.PROCESSING,
        requestId: request.id,
        nodeId,
        payload: { request },
        nodeSnapshot
      })
      this.emitAdmissionDecision(
        request.id,
        nodeId,
        'accepted',
        undefined,
        nodeSnapshot,
        record.sequence
      )
      this.recordRequestState(request, 'processing', {
        nodeId,
        timestampUs: this.clock
      })
    }

    this.scheduleNodeTimeout(nodeId, request)
  }

  private handleProcessingComplete(event: SimulationEvent): void {
    const node = this.nodes.get(event.nodeId)
    const request = this.getRequest(event)
    if (!node || !request) {
      return
    }

    if (this.isSupersededEvent(event, request, 'completionSeq')) {
      return
    }

    const completion = node.handleCompletion(request, this.clock)
    if (completion.completedSpan) {
      request.spans.push(completion.completedSpan)
      this.markNodePhaseDeparture(request, event.nodeId, completion.completedSpan.departureTime)
    }
    if (!completion.completedSpan) {
      return
    }
    const nodeSnapshot = this.createNodeSnapshot(event.nodeId)
    this.recordSimulationEvent(event, nodeSnapshot)

    if (completion.nextRequest) {
      this.markNodePhaseServiceStart(completion.nextRequest, event.nodeId, this.clock)
      this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'processing-started',
        priority: EventPriority.PROCESSING,
        requestId: completion.nextRequest.id,
        nodeId: event.nodeId,
        payload: { request: completion.nextRequest },
        nodeSnapshot
      })
      this.recordRequestState(completion.nextRequest, 'processing', {
        nodeId: event.nodeId,
        timestampUs: this.clock
      })
    }

    if (this.shouldFailAtNode(event.nodeId)) {
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          event.nodeId,
          request.id,
          {
            request,
            reason: 'node_error_rate',
            nodeArrivalTime: completion.completedSpan?.arrivalTime ?? this.clock
          },
          this.clock
        )
      )
      return
    }

    this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, true)

    const routingTraitDecision = this.runBeforeRoutingTraits(event.nodeId, request)
    if (routingTraitDecision.action === 'complete') {
      this.eventQueue.insert(
        createEvent('request-complete', event.nodeId, request.id, { request }, this.clock)
      )
      return
    }

    if (routingTraitDecision.action === 'rejected') {
      this.rejectRequestAtNode(
        event.nodeId,
        request,
        routingTraitDecision.reason,
        completion.completedSpan.arrivalTime
      )
      return
    }

    const routeResult =
      routingTraitDecision.action === 'reroute'
        ? this.resolveReroutedTarget(event.nodeId, routingTraitDecision.targetNodeId)
        : this.resolveRoutes(event.nodeId, request)
    if (routeResult.rejectionReason) {
      this.maybeRecordCircuitBreakerOutcomeAtNode(event.nodeId, request, false)
      this.rejectRequestAtNode(
        event.nodeId,
        request,
        routeResult.rejectionReason,
        completion.completedSpan.arrivalTime
      )
      return
    }

    const routes = this.expandFanoutRoutes(routeResult.routes, event.nodeId)
    if (routes.length === 0) {
      this.maybeRecordCircuitBreakerOutcomeAtNode(event.nodeId, request, true)
      this.eventQueue.insert(
        createEvent('request-complete', event.nodeId, request.id, { request }, this.clock)
      )
      return
    }

    const routedRequests = this.prepareRequestsForRoutes(request, routes.length)
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]
      const routedRequest = routedRequests[i]
      if (routedRequest.id !== request.id) {
        this.requestById.set(routedRequest.id, routedRequest)
        this.terminalStatusByRequestId.delete(routedRequest.id)
        this.tracer.setRequestCreatedAt(routedRequest.id, routedRequest.createdAt)
        this.recordCanonicalEvent({
          timestampUs: this.clock,
          type: 'request-generated',
          priority: EventPriority.ARRIVAL,
          requestId: routedRequest.id,
          nodeId: event.nodeId,
          payload: { request: routedRequest, branchOfRequestId: request.id }
        })
        this.recordRequestState(routedRequest, 'generated', {
          nodeId: event.nodeId,
          timestampUs: this.clock
        })
      }

      this.eventQueue.insert(
        createEvent(
          'request-forwarded',
          event.nodeId,
          routedRequest.id,
          { request: routedRequest, edge: route.edge, targetNodeId: route.targetNodeId },
          this.clock
        )
      )
    }
  }

  private handleRequestForwarded(event: SimulationEvent): void {
    const request = this.getRequest(event)
    if (!request) {
      return
    }

    const edge = event.data.edge as EdgeDefinition | undefined
    const targetNodeId = event.data.targetNodeId as string | undefined
    if (!edge || !targetNodeId) {
      return
    }

    this.recordSimulationEvent(event)
    this.recordRequestState(request, 'forwarded', {
      nodeId: event.nodeId,
      timestampUs: this.clock
    })
    this.maybeTrackCircuitBreakerRequest(request, edge.source, targetNodeId)
    this.enqueueEdgeTransfer(request, edge, targetNodeId)
  }

  private handleRequestComplete(event: SimulationEvent): void {
    const request = this.getRequest(event, false)
    if (!request) {
      return
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))

    const totalLatency = microToMs(this.clock - request.createdAt)
    this.recordRequestState(request, 'completed', {
      nodeId: event.nodeId,
      timestampUs: this.clock
    })
    this.markRequestPhaseTerminal(request, 'completed', event.nodeId, 'node', this.clock)
    this.metrics.recordRequest({
      id: request.id,
      status: 'success',
      totalLatency,
      path: request.path,
      spans: request.spans,
      hops: request.hops,
      phaseRecord: request.phaseRecord,
      createdAt: request.createdAt,
      completedAt: this.clock
    })

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.setPhaseRecord(request.id, request.phaseRecord)
    this.tracer.markStatus(request.id, 'success')
    this.releaseRequestLockLeases(request)
    this.markRequestTerminal(request, 'success')
  }

  private handleRequestTimeout(event: SimulationEvent): void {
    const request = this.getRequest(event, false)
    if (!request) {
      return
    }

    if (this.isSupersededEvent(event, request, 'timeoutSeq')) {
      return
    }

    const scope = typeof event.data.scope === 'string' ? event.data.scope : undefined
    const observationPoint = scope === 'in-flight' || scope === 'connection-wait' ? 'edge' : 'node'
    if (scope === 'connection-wait') {
      // The request's deadline fired while it waited for a connection stream; a
      // waiter already handed a connection has moved on, so this is stale.
      const poolId = typeof event.data.poolId === 'string' ? event.data.poolId : ''
      if (
        !this.connectionPools.removeWaiter(poolId, (waiter) => waiter.request.id === request.id)
      ) {
        return
      }
      this.emitConnectionWaitTimeoutFlow(request, event)
    }
    if (scope === 'ordering-lane' && typeof event.data.lane === 'string') {
      // Still waiting for its ordering lane when the deadline passed; a
      // delivery already released has moved on, so this event is stale.
      if (!this.dropFromOrderingLane(event.data.lane, request.id)) {
        return
      }
    }
    if (scope === 'collapse' && typeof event.data.collapseLeaderId === 'string') {
      // A parked follower's own deadline fired before its leader returned.
      this.unparkFollower(event.data.collapseLeaderId, request.id)
    }
    if (scope === 'in-flight') {
      this.releaseEdgeSlotForEvent(event)
    }
    if (scope === 'node') {
      const cancellation = this.nodes.get(event.nodeId)?.cancelRequest(request.id, this.clock)
      if (
        !cancellation ||
        cancellation.arrivalTime === null ||
        cancellation.arrivalTime === undefined
      ) {
        return
      }
      event.data.nodeArrivalTime = cancellation.arrivalTime
      this.markNodeTemporarilyUnhealthy(event.nodeId)
      if (cancellation.nextRequest) {
        this.markNodePhaseServiceStart(cancellation.nextRequest, event.nodeId, this.clock)
        this.recordCanonicalEvent({
          timestampUs: this.clock,
          type: 'processing-started',
          priority: EventPriority.PROCESSING,
          requestId: cancellation.nextRequest.id,
          nodeId: event.nodeId,
          payload: { request: cancellation.nextRequest },
          nodeSnapshot: this.createNodeSnapshot(event.nodeId)
        })
      }
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.recordRequestState(request, 'timed-out', {
      nodeId: event.nodeId,
      timestampUs: this.clock,
      reasonCode: typeof event.data.reason === 'string' ? event.data.reason : 'deadline_exceeded'
    })
    if (observationPoint === 'node') {
      this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, false)
    }
    this.maybeScheduleQueueDeliveryFollowUp(request)
    const timeoutReason =
      typeof event.data.reason === 'string' ? event.data.reason : 'deadline_exceeded'
    if (this.maybeScheduleRetryAttempt(request, event, timeoutReason, observationPoint)) {
      return
    }

    const timeoutLocus = this.resolveTerminalLocus(event, observationPoint === 'edge')
    this.markRequestPhaseTerminal(
      request,
      'timeout',
      timeoutLocus.locus,
      timeoutLocus.locusKind,
      this.clock
    )

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.setPhaseRecord(request.id, request.phaseRecord)
    this.tracer.markStatus(request.id, 'timeout')
    this.releaseRequestLockLeases(request)
    this.markRequestTerminal(request, 'timeout')

    const nodeArrivalTime =
      typeof event.data.nodeArrivalTime === 'bigint' ? event.data.nodeArrivalTime : undefined
    this.metrics.recordTimeout(event.requestId, event.nodeId, {
      requestCreatedAt: request.createdAt,
      nodeArrivalTime,
      edgeInTimeUs:
        typeof event.data.edgeInTimeUs === 'bigint' ? event.data.edgeInTimeUs : undefined,
      edgeSourceNodeId:
        typeof event.data.sourceNodeId === 'string' ? event.data.sourceNodeId : undefined,
      edgeTargetNodeId:
        typeof event.data.targetNodeId === 'string' ? event.data.targetNodeId : undefined,
      observationPoint,
      completedSpans: request.spans,
      terminationTimeUs: this.clock,
      locus: timeoutLocus.locus,
      locusKind: timeoutLocus.locusKind
    })
  }

  /**
   * The component that terminated a request: the edge for an in-flight/edge
   * observation (falling back to the node when no edge id is present), otherwise
   * the node itself. Powers the failure-by-locus Pareto.
   */
  private resolveTerminalLocus(
    event: SimulationEvent,
    isEdgeObservation: boolean
  ): { locus: string; locusKind: 'node' | 'edge' } {
    if (isEdgeObservation) {
      const edgeId = typeof event.data.edgeId === 'string' ? event.data.edgeId : undefined
      if (edgeId) {
        return { locus: edgeId, locusKind: 'edge' }
      }
    }
    return { locus: event.nodeId, locusKind: 'node' }
  }

  private handleRequestRejected(event: SimulationEvent): void {
    const reason = (event.data.reason as string | undefined) ?? 'rejected'
    const observationPoint = event.data.observationPoint === 'edge' ? 'edge' : ('node' as const)
    const request = this.getRequest(event, false)
    if (!request) {
      return
    }
    // Edge rejections (connection cap, edge error rate) happen before the
    // transfer takes an edge slot, so there is no slot to give back.
    if (event.data.edgeSlotHeld !== false) {
      this.releaseEdgeSlotForEvent(event)
    }
    if (observationPoint === 'node') {
      this.markNodeUnhealthyForReason(event.nodeId, reason)
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.recordRequestState(request, 'rejected', {
      nodeId: event.nodeId,
      timestampUs: this.clock,
      reasonCode: reason
    })
    if (observationPoint === 'node') {
      this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, false)
    }
    this.maybeScheduleQueueDeliveryFollowUp(request)
    if (this.maybeScheduleRetryAttempt(request, event, reason, observationPoint)) {
      return
    }

    const nodeArrivalTime =
      typeof event.data.nodeArrivalTime === 'bigint' ? event.data.nodeArrivalTime : undefined
    const rejectionLocus = this.resolveTerminalLocus(event, observationPoint === 'edge')
    this.markRequestPhaseTerminal(
      request,
      this.rejectionTerminalCause(reason),
      rejectionLocus.locus,
      rejectionLocus.locusKind,
      this.clock
    )
    this.metrics.recordRejection(event.nodeId, reason, {
      requestCreatedAt: request.createdAt,
      nodeArrivalTime,
      edgeInTimeUs:
        typeof event.data.edgeInTimeUs === 'bigint' ? event.data.edgeInTimeUs : undefined,
      edgeSourceNodeId:
        typeof event.data.sourceNodeId === 'string' ? event.data.sourceNodeId : undefined,
      edgeTargetNodeId:
        typeof event.data.targetNodeId === 'string' ? event.data.targetNodeId : undefined,
      observationPoint,
      completedSpans: request.spans,
      terminationTimeUs: this.clock,
      locus: rejectionLocus.locus,
      locusKind: rejectionLocus.locusKind
    })

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.setPhaseRecord(request.id, request.phaseRecord)
    this.tracer.markStatus(request.id, 'rejected')
    this.releaseRequestLockLeases(request)
    this.markRequestTerminal(request, 'rejected', reason)
  }

  private handleNodeFailure(event: SimulationEvent): void {
    const spec = this.resolveFailureSpec(event, event.nodeId)
    const faultDomain = readFaultDomainRef(event.data.faultDomain)
    if (faultDomain) {
      const holds = this.domainHoldsByNodeId.get(event.nodeId) ?? new Set<string>()
      holds.add(faultDomain.id)
      this.domainHoldsByNodeId.set(event.nodeId, holds)
    }
    const node = this.nodes.get(event.nodeId)
    if (node) {
      const onset = node.fail(spec, this.clock)
      for (const reset of onset.connectionResets) {
        this.recordConnectionResetTerminal(reset.request, event.nodeId, reset.arrivalTime)
      }
    }
    this.nodeUnhealthyUntilUs.set(event.nodeId, this.clock + LOAD_BALANCER_UNHEALTHY_COOLDOWN_US)
    // Open a failure window for the status timeline (idempotent: don't stack if
    // already open for this node).
    if (!this.statusWindows.some((w) => w.componentId === event.nodeId && w.endUs === null)) {
      this.statusWindows.push({
        componentId: event.nodeId,
        mode: spec.mode,
        startUs: this.clock,
        endUs: null,
        ...(faultDomain ? { faultDomain } : {})
      })
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.updateReplicationClustersForNodeStatus(event.nodeId, false)
    if (this.isStreamBrokerNode(event.nodeId)) {
      this.setStreamBrokerAvailability(event.nodeId, false, 'node-failure')
    }
    this.rebalanceStreamConsumersAffectedBy(event.nodeId)
  }

  private handleNodeRecovery(event: SimulationEvent): void {
    const holds = this.domainHoldsByNodeId.get(event.nodeId)
    if (holds && holds.size > 0) {
      const faultDomain = readFaultDomainRef(event.data.faultDomain)
      if (faultDomain) holds.delete(faultDomain.id)
      // Still inside a domain that is down (an overlapping region + zone
      // outage, or a node-level recovery during a zone outage): stay failed.
      if (holds.size > 0) return
    }
    const node = this.nodes.get(event.nodeId)
    if (node) {
      const recovery = node.recover(this.clock)
      for (const reset of recovery.connectionResets) {
        this.recordConnectionResetTerminal(reset.request, event.nodeId, reset.arrivalTime)
      }
      for (const resumed of recovery.started) {
        this.markNodePhaseServiceStart(resumed, event.nodeId, this.clock)
        this.recordCanonicalEvent({
          timestampUs: this.clock,
          type: 'processing-started',
          priority: EventPriority.PROCESSING,
          requestId: resumed.id,
          nodeId: event.nodeId,
          payload: { request: resumed },
          nodeSnapshot: this.createNodeSnapshot(event.nodeId)
        })
      }
      // Resumed requests were re-dispatched by the node (fresh processing-complete
      // scheduled); their original timeouts stay live and race those completions.
    }
    this.nodeUnhealthyUntilUs.delete(event.nodeId)
    // Close the open failure window for this node.
    const open = this.statusWindows.find((w) => w.componentId === event.nodeId && w.endUs === null)
    if (open) {
      open.endUs = this.clock
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.updateReplicationClustersForNodeStatus(event.nodeId, true)
    if (this.isStreamBrokerNode(event.nodeId)) {
      this.setStreamBrokerAvailability(event.nodeId, true, 'node-recovery')
    }
    this.rebalanceStreamConsumersAffectedBy(event.nodeId)
  }

  private handleStreamRetentionExpire(event: SimulationEvent): void {
    const broker = this.getStreamBrokerLog(event.nodeId)
    if (!broker) {
      return
    }

    const expiredRecords = broker.expire(microToMs(this.clock))
    const payload = {
      streamRetentionExpired: expiredRecords > 0,
      expiredRecords,
      metricCounters: expiredRecords > 0 ? { streamRetentionExpired: expiredRecords } : {}
    }
    this.recordTraitPayloadMetrics(event.nodeId, payload)
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'stream-retention-expired',
      priority: event.priority,
      nodeId: event.nodeId,
      payload
    })
  }

  private handleStreamReplay(event: SimulationEvent): void {
    const broker = this.getStreamBrokerLog(event.nodeId)
    const node = this.nodeDefinitionsById.get(event.nodeId)
    if (!broker || !node) {
      return
    }

    let replayCount = 0
    const replays: Array<{
      consumerGroup: string
      memberId: string
      partition: number
      offset: number
    }> = []
    const available = this.isStreamBrokerAvailable(event.nodeId)
    if (available) {
      for (const [group, members] of this.streamConsumerGroupsForBroker(event.nodeId, true)) {
        for (const partition of broker.partitionSnapshots()) {
          for (const memberId of members) {
            const record = broker.poll(group, memberId, partition.partition, microToMs(this.clock))
            if (!record) {
              continue
            }
            replayCount++
            replays.push({
              consumerGroup: group,
              memberId,
              partition: partition.partition,
              offset: record.offset
            })
            break
          }
        }
      }
    }

    const payload = {
      streamBrokerAvailable: available,
      replayCount,
      replays,
      metricCounters: {
        ...(replayCount > 0 ? { streamReplayReads: replayCount } : {}),
        ...(!available ? { streamBrokerUnavailable: 1 } : {})
      }
    }
    this.recordTraitPayloadMetrics(event.nodeId, payload)
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'stream-replayed',
      priority: event.priority,
      nodeId: event.nodeId,
      payload
    })

    const replayIntervalMs = this.readStreamReplayIntervalMs(node)
    if (replayIntervalMs > 0) {
      const nextAt = this.clock + msToMicro(replayIntervalMs)
      if (nextAt <= this.simulationDurationUs) {
        this.eventQueue.insert(createEvent('stream-replay', event.nodeId, '', {}, nextAt))
      }
    }
  }

  private handleConsumerGroupRebalance(event: SimulationEvent): void {
    const broker = this.getStreamBrokerLog(event.nodeId)
    if (!broker) {
      return
    }

    const group =
      typeof event.data.consumerGroup === 'string' ? event.data.consumerGroup : 'default'
    const members = Array.isArray(event.data.members)
      ? event.data.members.filter((member): member is string => typeof member === 'string')
      : []
    broker.rebalance(group, members)
    const payload = {
      consumerGroup: group,
      members,
      memberCount: members.length,
      metricCounters: { streamConsumerRebalances: 1 }
    }
    this.recordTraitPayloadMetrics(event.nodeId, payload)
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'consumer-group-rebalanced',
      priority: event.priority,
      nodeId: event.nodeId,
      payload
    })
  }

  private handleBrokerFailure(event: SimulationEvent): void {
    this.setStreamBrokerAvailability(event.nodeId, false, 'broker-failure')
  }

  private handleBrokerRecovery(event: SimulationEvent): void {
    this.setStreamBrokerAvailability(event.nodeId, true, 'broker-recovery')
  }

  /** Finalize failure intervals (ms): windows still open at cutoff close at the run horizon. */
  private buildStatusTimeline(): StatusWindow[] {
    return this.statusWindows.map((w) => ({
      componentId: w.componentId,
      mode: w.mode,
      startMs: microToMs(w.startUs),
      endMs: microToMs(w.endUs ?? this.simulationDurationUs),
      ...(w.faultDomain ? { faultDomain: { ...w.faultDomain } } : {})
    }))
  }

  private isStreamBrokerNode(nodeId: string): boolean {
    const node = this.nodeDefinitionsById.get(nodeId)
    return node?.type === 'stream' && node.config?.['streamBrokerEnabled'] === true
  }

  private updateReplicationClustersForNodeStatus(nodeId: string, recovered: boolean): void {
    const seenClusterKeys = new Set<string>()
    for (const node of this.nodeDefinitionsById.values()) {
      if (node.config?.['replicationEnabled'] !== true) {
        continue
      }
      const members = replicationClusterMembers(node.id, node.config)
      if (!members.some((member) => member.id === nodeId)) {
        continue
      }
      const key = replicationClusterStateKey(node.id, node.config)
      if (seenClusterKeys.has(key)) {
        continue
      }
      seenClusterKeys.add(key)
      const cluster =
        this.getSharedTraitStateStore().get<ReplicaCluster>(key) ??
        createReplicationCluster(node.id, node.config)
      this.getSharedTraitStateStore().set(key, cluster)
      if (recovered) {
        cluster.recover(nodeId)
        if (!cluster.leader()) {
          cluster.elect()
        }
      } else {
        cluster.fail(nodeId)
        cluster.elect()
      }
    }
  }

  private getStreamBrokerLog(nodeId: string): ReplicatedLog | undefined {
    return this.getSharedTraitStateStore().get<ReplicatedLog>(streamBrokerLogStateKey(nodeId))
  }

  private isStreamBrokerAvailable(nodeId: string): boolean {
    return (
      this.getSharedTraitStateStore().get<boolean>(streamBrokerAvailabilityStateKey(nodeId)) !==
      false
    )
  }

  private setStreamBrokerAvailability(nodeId: string, available: boolean, reason: string): void {
    if (!this.isStreamBrokerNode(nodeId)) {
      return
    }

    this.getSharedTraitStateStore().set(streamBrokerAvailabilityStateKey(nodeId), available)
    const payload = {
      streamBrokerAvailable: available,
      reason,
      metricCounters: available ? { streamBrokerRecoveries: 1 } : { streamBrokerFailures: 1 }
    }
    this.recordTraitPayloadMetrics(nodeId, payload)
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: available ? 'broker-recovered' : 'broker-failed',
      priority: EventPriority.SYSTEM,
      nodeId,
      reasonCode: reason,
      payload
    })
  }

  private readStreamReplayIntervalMs(node: ComponentNode): number {
    const raw = node.config?.['streamReplayIntervalMs']
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
  }

  private streamConsumerGroupsForBroker(
    brokerNodeId: string,
    onlyAvailable: boolean
  ): Map<string, string[]> {
    const groups = new Map<string, string[]>()
    for (const edge of this.routing.getOutgoingEdges(brokerNodeId)) {
      const consumer = this.nodeDefinitionsById.get(edge.target)
      if (!consumer) {
        continue
      }
      if (onlyAvailable && !this.isNodeHealthyInstant(consumer.id)) {
        continue
      }
      const configuredGroup = consumer.config?.['consumerGroup']
      const group =
        typeof configuredGroup === 'string' && configuredGroup.trim()
          ? configuredGroup.trim()
          : consumer.id
      groups.set(group, [...(groups.get(group) ?? []), consumer.id].sort())
    }
    return groups
  }

  private rebalanceStreamConsumersAffectedBy(changedNodeId: string): void {
    for (const node of this.nodeDefinitionsById.values()) {
      if (
        node.type !== 'stream' ||
        node.config?.['streamBrokerEnabled'] !== true ||
        node.config?.['consumerGroupMode'] !== true
      ) {
        continue
      }

      const outgoing = this.routing.getOutgoingEdges(node.id)
      if (!outgoing.some((edge) => edge.target === changedNodeId)) {
        continue
      }

      for (const [group, members] of this.streamConsumerGroupsForBroker(node.id, true)) {
        this.handleConsumerGroupRebalance(
          createEvent(
            'consumer-group-rebalance',
            node.id,
            '',
            { consumerGroup: group, members },
            this.clock
          )
        )
      }
    }
  }

  private buildStreamProjection(): StreamBrokerProjection[] {
    const projections: StreamBrokerProjection[] = []
    const perNode = Object.fromEntries(
      this.metrics.getPerNodeMetrics(this.topology.global.simulationDuration)
    )

    for (const node of this.nodeDefinitionsById.values()) {
      if (node.type !== 'stream' || node.config?.['streamBrokerEnabled'] !== true) {
        continue
      }
      const broker = this.getStreamBrokerLog(node.id)
      if (!broker) {
        continue
      }

      const partitions = broker.partitionSnapshots()
      const groups = [...this.streamConsumerGroupsForBroker(node.id, false)].map(
        ([group, members]) => {
          const committedOffsets: Record<string, number> = {}
          const lag: Record<string, number> = {}
          for (const partition of partitions) {
            const key = String(partition.partition)
            const committed = broker.committedOffset(group, partition.partition)
            committedOffsets[key] = committed
            lag[key] = Math.max(
              0,
              partition.nextOffset - Math.max(partition.startOffset, committed)
            )
          }
          return {
            group,
            members: broker.groupMembers(group).length > 0 ? broker.groupMembers(group) : members,
            committedOffsets,
            lag
          }
        }
      )
      const counters = perNode[node.id]?.traitCounters ?? {}
      projections.push({
        nodeId: node.id,
        brokerAvailable: this.isStreamBrokerAvailable(node.id),
        partitions,
        groups,
        replayCount: counters.streamReplayReads ?? 0,
        retentionRemovals: counters.streamRetentionExpired ?? 0
      })
    }

    return projections
  }

  private buildReplicationProjection(): ReplicationProjection[] {
    const projections: ReplicationProjection[] = []
    const seenClusterKeys = new Set<string>()

    for (const node of this.nodeDefinitionsById.values()) {
      if (node.config?.['replicationEnabled'] !== true) {
        continue
      }

      const clusterId = replicationClusterStateKey(node.id, node.config)
      if (seenClusterKeys.has(clusterId)) {
        continue
      }
      seenClusterKeys.add(clusterId)

      const cluster =
        this.getSharedTraitStateStore().get<ReplicaCluster>(clusterId) ??
        createReplicationCluster(node.id, node.config)
      projections.push({
        clusterId,
        protocol: replicationConsensusProtocol(node.config),
        conflictResolution: cluster.conflictPolicy(),
        leaderId: cluster.leader()?.id ?? null,
        quorumSize: cluster.quorumSize(),
        healthyReplicas: cluster.healthyCount(),
        hasQuorum: cluster.hasQuorum(),
        members: cluster.snapshot().map((member) => ({ ...member }))
      })
    }

    return projections
  }

  /**
   * Resolve the failure spec for a `node-failure` event: an explicit spec on the
   * event wins, then the node's configured spec, then the backward-compatible
   * legacy instant-reject fallback (so bare injected failures behave as before).
   */
  private resolveFailureSpec(event: SimulationEvent, nodeId: string): NodeFailureSpec {
    return (
      parseFailureSpec(event.data.failureSpec) ??
      this.nodeFailureSpecById.get(nodeId) ??
      LEGACY_REJECT_FAILURE_SPEC
    )
  }

  /**
   * Record a connection_reset terminal (kill -9 at failure onset, or a hung
   * node's held request dropped at recovery). Mirrors the rejection/timeout
   * terminal path but with its own cause so per-cause latency never blends.
   */
  private recordConnectionResetTerminal(
    request: Request,
    nodeId: string,
    nodeArrivalTime: bigint
  ): void {
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'request-rejected',
      priority: EventPriority.PROCESSING,
      requestId: request.id,
      nodeId,
      reasonCode: 'connection_reset',
      payload: { request, reason: 'connection_reset', nodeArrivalTime },
      nodeSnapshot: this.createNodeSnapshot(nodeId)
    })

    this.maybeScheduleQueueDeliveryFollowUp(request)
    if (
      this.maybeScheduleRetryAttempt(
        request,
        createEvent('request-rejected', nodeId, request.id, {}, this.clock),
        'connection_reset',
        'node'
      )
    ) {
      return
    }
    this.markRequestPhaseTerminal(request, 'connection_reset', nodeId, 'node', this.clock)
    this.metrics.recordConnectionReset(request.id, nodeId, {
      requestCreatedAt: request.createdAt,
      nodeArrivalTime,
      observationPoint: 'node',
      completedSpans: request.spans,
      terminationTimeUs: this.clock,
      locus: nodeId,
      locusKind: 'node'
    })

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.setPhaseRecord(request.id, request.phaseRecord)
    this.tracer.markStatus(request.id, 'connection_reset')
    this.releaseRequestLockLeases(request)
    this.markRequestTerminal(request, 'connection_reset', 'connection_reset')
  }

  private assertAllNodeInvariants(): void {
    for (const node of this.nodes.values()) {
      node.debugAssertInvariants()
    }
  }

  /**
   * Sample the per-transfer edge transit (everything except waiting for the
   * link, which depends on link occupancy and is added by the caller). Returns
   * the rounded transit in µs plus its component split for the breakdown.
   */
  private edgeLatencyDistribution(edge: EdgeDefinition, request: Request) {
    return (
      this.geoLatency.distributionFor(edge, request) ??
      (edge.latency.derivedFromPathType
        ? getPathTypeLatencyProfile(edge.latency.pathType)
        : edge.latency.distribution)
    )
  }

  private sampleEdgeTransit(
    edge: EdgeDefinition,
    request: Request,
    activeTransfers: number,
    sizeBytes = request.sizeBytes
  ): { transitUs: bigint; transmissionMs: number; components: EdgeLatencyBreakdownSample } {
    const latencyDistribution = this.edgeLatencyDistribution(edge, request)
    const propagationMs = Math.max(0, this.distributions.fromConfig(latencyDistribution))
    // Mbps -> bytes per ms is x125; see network/linkTransmission.ts.
    const transmissionMs = transmissionTimeMs(sizeBytes, edge.bandwidth)
    // Streaming links reuse an already-open channel, so only a small framing
    // cost remains on each message instead of the full per-request setup cost.
    const protocolOverheadMs =
      edge.protocolOverheadMs ??
      getProtocolLatencyOverheadMs(edge.protocol) * (edge.mode === 'streaming' ? 0.25 : 1)
    const utilization =
      edge.maxConcurrentRequests > 0
        ? Math.min(0.98, activeTransfers / edge.maxConcurrentRequests)
        : 0
    const delayMultiplier = Math.min(50, 1 / Math.max(0.02, 1 - utilization))
    const congestedPropagationMs = Math.max(0, propagationMs * delayMultiplier)
    const totalLatencyMs = congestedPropagationMs + transmissionMs + protocolOverheadMs
    return {
      transitUs: msToMicro(totalLatencyMs),
      transmissionMs,
      components: {
        propagationMs,
        congestionMs: congestedPropagationMs - propagationMs,
        transmissionMs,
        linkQueueMs: 0,
        protocolOverheadMs,
        retransmissionMs: 0,
        connectionWaitMs: 0,
        handshakeMs: 0,
        batchWaitMs: 0
      }
    }
  }

  /**
   * Hold the edge's serializing link for `transmissionMs` (x copies when the
   * payload is retransmitted). Returns the wait for earlier transfers, rounded
   * to whole µs, and records link busy time for utilization.
   */
  private reserveEdgeLink(edge: EdgeDefinition, transmissionMs: number, copies: number): bigint {
    const reservation = this.linkSerializer.reserve(
      edge.id,
      Number(this.clock),
      transmissionMs * 1000 * copies
    )
    this.metrics.recordEdgeLinkBusy(
      edge.id,
      reservation.startUs,
      reservation.busyUs,
      Number(this.simulationDurationUs)
    )
    return BigInt(Math.round(reservation.queueWaitUs))
  }

  private getRequest(event: SimulationEvent, hydrate = true): Request | undefined {
    if (this.terminalStatusByRequestId.has(event.requestId)) {
      return undefined
    }

    const tracked = this.requestById.get(event.requestId)
    if (tracked) {
      return tracked
    }

    if (!hydrate) {
      return undefined
    }

    const fromEvent = event.data.request as Request | undefined
    if (fromEvent?.metadata?.__terminal) {
      if (typeof fromEvent.metadata.__terminal === 'string') {
        this.markTerminalTombstone(fromEvent.id)
      }
      return undefined
    }
    if (fromEvent) {
      this.requestById.set(fromEvent.id, fromEvent)
      return fromEvent
    }
    return undefined
  }

  /**
   * Lazy-tombstone check for per-kind event cancellation. A `processing-complete`
   * (SERVICE_COMPLETE) or `request-timeout` (TIMEOUT_FIRE) event snapshots the
   * request's completion/timeout generation at schedule time. If a later
   * transition (e.g. a failure onset) has since advanced that generation, the
   * popped event is stale and must be discarded silently without mutating any
   * node state. The two generations are independent so a completion can be
   * cancelled without touching a live timeout, and vice versa.
   */
  private isSupersededEvent(
    event: SimulationEvent,
    request: Request,
    seqKey: 'completionSeq' | 'timeoutSeq'
  ): boolean {
    const snapshot = event.data[seqKey]
    if (typeof snapshot !== 'number') {
      return false
    }
    return snapshot !== (request[seqKey] ?? 0)
  }

  private handleRecordedCanonicalEvent(record: CanonicalEventRecord): void {
    const needsDebugEvent = this.debugTarget !== null || this.onDebugEvent !== undefined
    if (!needsDebugEvent) {
      return
    }

    const debugEvent = projectToDebugEvent(record)
    if (
      this.debugTarget &&
      (this.debugTarget === 'all' || debugEvent.requestId === this.debugTarget)
    ) {
      this.debugEvents.push(debugEvent)
    }

    this.onDebugEvent?.(debugEvent)
  }

  private shouldEmitSnapshot(timestamp: bigint): boolean {
    return this.lastSnapshotAt < 0n || timestamp - this.lastSnapshotAt >= this.snapshotIntervalUs
  }

  private recordRequestState(
    request: Request,
    state: Parameters<typeof recordRequestStateTransition>[1]['state'],
    options: {
      scope?: Parameters<typeof recordRequestStateTransition>[1]['scope']
      timestampUs?: bigint
      nodeId?: string | null
      detail?: string
      reasonCode?: string | null
      source?: Parameters<typeof recordRequestStateTransition>[1]['source']
    } = {}
  ): void {
    recordRequestStateTransition(request, {
      scope: options.scope ?? 'request',
      state,
      timestampUs: options.timestampUs ?? this.clock,
      nodeId: options.nodeId ?? undefined,
      detail: options.detail,
      reasonCode: options.reasonCode ?? undefined,
      source: options.source ?? 'event'
    })
  }

  private recordTraitStateTransitions(
    request: Request,
    nodeId: string,
    payload: Record<string, unknown>
  ): Array<{
    scope: Parameters<typeof recordRequestStateTransition>[1]['scope']
    state: Parameters<typeof recordRequestStateTransition>[1]['state']
    detail?: string | null
    reasonCode?: string | null
  }> {
    const transitions = deriveTraitStateTransitions(payload)
    for (const transition of transitions) {
      this.recordRequestState(request, transition.state, {
        scope: transition.scope,
        nodeId,
        detail: transition.detail ?? undefined,
        reasonCode: transition.reasonCode ?? undefined,
        source: 'trait'
      })
    }
    return transitions
  }

  private buildOutcomeStateTimeline(request: Request, status: TerminalRequestStatus | 'in-flight') {
    const timeline = cloneRequestStateTimeline(request.stateTimeline) ?? []

    if (status !== 'in-flight') {
      return timeline
    }

    recordRequestStateTransition(
      { stateTimeline: timeline },
      {
        scope: 'request',
        state: 'in-flight',
        timestampUs: this.clock,
        nodeId: request.path[request.path.length - 1] ?? undefined,
        source: 'engine',
        detail: 'The run ended before this request reached a terminal outcome.'
      }
    )
    return timeline
  }

  /**
   * Fan-out amplification (GAP 2): expand any route whose edge declares a
   * `fanoutFactor > 1` into that many copies of the route, so the existing
   * per-route fork machinery generates N branch deliveries to the target. This is
   * the honest write-storm model — the downstream node genuinely receives N× the
   * load and can saturate. The extra deliveries are recorded on the source node as
   * `fanoutAmplifiedWrites` so the amplification is measurable/gradable.
   */
  private expandFanoutRoutes(routes: ResolveRoute[], sourceNodeId: string): ResolveRoute[] {
    let amplified = 0
    let hasFanout = false
    for (const route of routes) {
      const factor = route.edge.fanoutFactor
      if (typeof factor === 'number' && Number.isFinite(factor) && factor > 1) {
        hasFanout = true
        break
      }
    }
    if (!hasFanout) {
      return routes
    }

    const expanded: ResolveRoute[] = []
    for (const route of routes) {
      const factor = route.edge.fanoutFactor
      const copies =
        typeof factor === 'number' && Number.isFinite(factor) && factor > 1
          ? Math.min(Math.round(factor), SimulationEngine.MAX_FANOUT_PER_EDGE)
          : 1
      for (let i = 0; i < copies; i++) {
        expanded.push(route)
      }
      if (copies > 1) {
        amplified += copies - 1
      }
    }
    if (amplified > 0) {
      this.metrics.recordNodeTraitCounters(sourceNodeId, { fanoutAmplifiedWrites: amplified })
    }
    return expanded
  }

  private prepareRequestsForRoutes(request: Request, routeCount: number): Request[] {
    if (routeCount <= 1) {
      return [request]
    }

    const routedRequests: Request[] = [request]
    for (let i = 1; i < routeCount; i++) {
      routedRequests.push(this.cloneRequestForBranch(request))
    }

    return routedRequests
  }

  private cloneRequestForBranch(request: Request): Request {
    const branchId = `${request.id}::branch-${++this.forkCounter}`
    return {
      ...request,
      id: branchId,
      path: [...request.path],
      spans: request.spans.map((span) => ({ ...span })),
      hops: request.hops?.map((hop) => ({ ...hop })),
      phaseRecord: cloneRequestPhaseRecord(request.phaseRecord),
      stateTimeline: cloneRequestStateTimeline(request.stateTimeline),
      metadata: { ...request.metadata }
    }
  }

  private queueAttemptWindowUs(request: Request): bigint {
    const window = request.deadline - request.createdAt
    return window > 0n ? window : 1n
  }

  private createQueueDeliveryAttempt(
    parentRequest: Request,
    queueNodeId: string,
    createdAtUs: bigint,
    retryCount: number
  ): Request {
    const attempt = this.cloneRequestForBranch(parentRequest)
    attempt.createdAt = createdAtUs
    attempt.deadline = createdAtUs + this.queueAttemptWindowUs(parentRequest)
    attempt.path = []
    attempt.spans = []
    attempt.hops = []
    attempt.phaseRecord = undefined
    attempt.stateTimeline = undefined
    attempt.retryCount = retryCount
    this.clearPerAttemptRequestMetadata(attempt)
    clearLockLeaseAttachments(attempt)
    delete attempt.metadata.__terminal
    writeQueueDeliveryOriginNodeId(attempt, queueNodeId)
    return attempt
  }

  private scheduleQueueDeliveryAttempt(
    parentRequest: Request,
    queueNodeId: string,
    scheduledAtUs: bigint,
    options: {
      branchOfRequestId: string
      retryCount: number
    }
  ): Request | null {
    if (!this.nodes.has(queueNodeId)) {
      return null
    }

    const attempt = this.createQueueDeliveryAttempt(
      parentRequest,
      queueNodeId,
      scheduledAtUs,
      options.retryCount
    )

    this.eventQueue.insert(
      createEvent(
        'request-arrival',
        queueNodeId,
        attempt.id,
        {
          request: attempt,
          internalQueueConsumer: true,
          branchOfRequestId: options.branchOfRequestId
        },
        scheduledAtUs
      )
    )

    return attempt
  }

  private maybeScheduleQueueDeliveryFollowUp(request: Request): void {
    const queueNodeId = readQueueDeliveryOriginNodeId(request)
    if (!queueNodeId) {
      return
    }

    const node = this.nodeDefinitionsById.get(queueNodeId)
    if (!node) {
      return
    }

    const delivery = readQueueDeliveryConfig(node)
    if (delivery.deliverySemantics === 'at-most-once') {
      return
    }

    const attemptsSoFar = (request.retryCount ?? 0) + 1
    if (attemptsSoFar >= delivery.maxReceiveCount) {
      if (
        delivery.dlqNodeId &&
        delivery.dlqNodeId !== queueNodeId &&
        this.scheduleQueueDeliveryAttempt(request, delivery.dlqNodeId, this.clock, {
          branchOfRequestId: request.id,
          retryCount: request.retryCount ?? 0
        })
      ) {
        this.recordRequestState(request, 'dlq-routed', {
          scope: 'delivery',
          nodeId: queueNodeId,
          source: 'engine',
          detail: `Moved to DLQ ${delivery.dlqNodeId}.`
        })
        this.metrics.recordNodeTraitCounters(queueNodeId, { queueDlqMoves: 1 })
      }
      return
    }

    if (
      this.scheduleQueueDeliveryAttempt(
        request,
        queueNodeId,
        this.clock + delivery.visibilityTimeoutUs,
        {
          branchOfRequestId: request.id,
          retryCount: (request.retryCount ?? 0) + 1
        }
      )
    ) {
      this.recordRequestState(request, 'redelivery-scheduled', {
        scope: 'delivery',
        nodeId: queueNodeId,
        source: 'engine',
        detail: 'Visibility timeout expired; another delivery attempt was scheduled.'
      })
      this.metrics.recordNodeTraitCounters(queueNodeId, { queueRedeliveries: 1 })
    }
  }

  private releaseRequestLockLeases(request: Request): void {
    const attachments = readLockLeaseAttachments(request)
    if (attachments.length === 0) {
      return
    }

    for (const attachment of attachments) {
      if (
        releaseLockLeaseAttachment(
          this.getTraitStateStore(attachment.nodeId),
          request.id,
          attachment
        )
      ) {
        this.recordRequestState(request, 'released', {
          scope: 'lock',
          nodeId: attachment.nodeId,
          source: 'engine',
          detail: `Released key ${attachment.resourceKey}.`
        })
      }
    }

    clearLockLeaseAttachments(request)
  }

  private clearPerAttemptRequestMetadata(request: Request): void {
    clearCircuitBreakerTracking(request)
    delete request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY]
    delete request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY]
  }

  private resolveRetryOwnerNodeId(
    request: Request,
    event: SimulationEvent,
    observationPoint: 'node' | 'edge'
  ): string | null {
    if (readQueueDeliveryOriginNodeId(request)) {
      return null
    }

    if (observationPoint === 'edge') {
      if (typeof event.data.sourceNodeId === 'string') {
        return event.data.sourceNodeId
      }
      return request.path.length > 0 ? request.path[request.path.length - 1] : null
    }

    const currentIndex = request.path.lastIndexOf(event.nodeId)
    if (currentIndex > 0) {
      return request.path[currentIndex - 1]
    }

    return request.path.length > 1 ? request.path[request.path.length - 2] : null
  }

  private isRetryableFailure(reason: string, observationPoint: 'node' | 'edge'): boolean {
    if (observationPoint === 'edge') {
      return true
    }

    switch (reason) {
      case 'node_failed':
      case 'node_error_rate':
      case 'circuit_breaker_open':
      case 'lock_contended':
      case 'connection_reset':
        return true
      default:
        return classifyRejectionCause(reason) === 'network_error'
    }
  }

  private maybeScheduleRetryAttempt(
    request: Request,
    event: SimulationEvent,
    reason: string,
    observationPoint: 'node' | 'edge'
  ): boolean {
    if (!this.isRetryableFailure(reason, observationPoint)) {
      return false
    }

    const retryOwnerNodeId = this.resolveRetryOwnerNodeId(request, event, observationPoint)
    if (!retryOwnerNodeId) {
      return false
    }

    const retryOwnerNode = this.nodeDefinitionsById.get(retryOwnerNodeId)
    const retryConfig = retryOwnerNode ? readRetryBackoffConfig(retryOwnerNode) : null
    if (!retryOwnerNode || !retryConfig) {
      return false
    }

    const attemptsSoFar = (request.retryCount ?? 0) + 1
    if (attemptsSoFar >= retryConfig.maxAttempts) {
      this.metrics.recordNodeTraitCounters(retryOwnerNodeId, { retryBudgetExhausted: 1 })
      return false
    }

    const retryDelayMs = computeRetryDelayMs(request.retryCount ?? 0, retryConfig, () =>
      this.distributions.random()
    )
    const retryAtUs = this.clock + msToMicro(retryDelayMs)
    if (retryAtUs >= request.deadline) {
      this.metrics.recordNodeTraitCounters(retryOwnerNodeId, { retryBudgetExhausted: 1 })
      return false
    }

    this.releaseRequestLockLeases(request)
    // The failed attempt's error came back over its connections; free them.
    this.releaseConnectionLeases(request.id)
    this.clearPerAttemptRequestMetadata(request)
    request.retryCount = (request.retryCount ?? 0) + 1
    this.recordRequestState(request, 'retry-scheduled', {
      nodeId: retryOwnerNodeId,
      source: 'engine',
      reasonCode: reason,
      detail: `Retry ${request.retryCount + 1} scheduled from ${retryOwnerNodeId}.`
    })

    this.metrics.recordNodeTraitCounters(retryOwnerNodeId, { retryAttempts: 1 })
    this.eventQueue.insert(
      createEvent(
        'request-arrival',
        retryOwnerNodeId,
        request.id,
        {
          request,
          retryReason: reason,
          retryOwnerNodeId,
          retriedFromNodeId: event.nodeId
        },
        retryAtUs
      )
    )
    return true
  }

  private ensurePhaseRecord(request: Request) {
    if (!request.phaseRecord) {
      request.phaseRecord = {
        bornAtUs: request.createdAt,
        nodes: [],
        edges: []
      }
    }
    return request.phaseRecord
  }

  private currentNodePhase(request: Request, nodeId: string): RequestNodePhase | undefined {
    const phases = this.ensurePhaseRecord(request).nodes
    for (let i = phases.length - 1; i >= 0; i--) {
      const phase = phases[i]
      if (phase.nodeId === nodeId && phase.departureUs === undefined) {
        return phase
      }
    }
    return undefined
  }

  private recordNodePhaseArrival(request: Request, nodeId: string, arrivalUs: bigint): void {
    this.ensurePhaseRecord(request).nodes.push({
      nodeId,
      nodeArrivalUs: arrivalUs
    })
  }

  private markNodePhaseServiceStart(
    request: Request,
    nodeId: string,
    serviceStartUs: bigint
  ): void {
    const phase = this.currentNodePhase(request, nodeId)
    if (phase) {
      phase.serviceStartUs = phase.serviceStartUs ?? serviceStartUs
      return
    }

    this.ensurePhaseRecord(request).nodes.push({
      nodeId,
      nodeArrivalUs: serviceStartUs,
      serviceStartUs
    })
  }

  private markNodePhaseDeparture(request: Request, nodeId: string, departureUs: bigint): void {
    const phase = this.currentNodePhase(request, nodeId)
    if (phase) {
      phase.departureUs = departureUs
      return
    }

    this.ensurePhaseRecord(request).nodes.push({
      nodeId,
      nodeArrivalUs: departureUs,
      serviceStartUs: departureUs,
      departureUs
    })
  }

  private beginEdgePhase(
    request: Request,
    edge: EdgeDefinition,
    targetNodeId: string,
    edgeInUs: bigint
  ): RequestEdgePhase {
    const phase: RequestEdgePhase = {
      edgeId: edge.id,
      source: edge.source,
      target: targetNodeId,
      edgeInUs
    }
    this.ensurePhaseRecord(request).edges.push(phase)
    return phase
  }

  private rejectionTerminalCause(reason: string): RequestTerminalCause {
    switch (classifyRejectionCause(reason)) {
      case 'queue_full':
        return 'queue_full'
      case 'oom':
        return 'oom'
      case 'node_failed':
        return 'node_failed'
      case 'network_error':
        return 'network_error'
      case 'rejected':
      default:
        return 'rejected'
    }
  }

  private markRequestPhaseTerminal(
    request: Request,
    cause: RequestTerminalCause,
    locus: string,
    locusKind: 'node' | 'edge',
    timeUs: bigint
  ): void {
    this.ensurePhaseRecord(request).terminal = {
      timeUs,
      cause,
      locus,
      locusKind
    }
  }

  private appendNodeToPath(request: Request, nodeId: string): void {
    request.path.push(nodeId)
  }

  private buildOutcomeSemantics(request: Request, status: TerminalRequestStatus | 'in-flight') {
    const queueNodeId = readQueueDeliveryOriginNodeId(request)
    if (!queueNodeId) {
      return buildRequestSemanticsSnapshot(status, {
        metadata: request.metadata,
        attempts: (request.retryCount ?? 0) + 1
      })
    }

    const queueNode = this.nodeDefinitionsById.get(queueNodeId)
    if (!queueNode) {
      return buildRequestSemanticsSnapshot(status, {
        metadata: request.metadata,
        attempts: (request.retryCount ?? 0) + 1
      })
    }

    const delivery = readQueueDeliveryConfig(queueNode)
    return buildRequestSemanticsSnapshot(status, {
      queueDelivery: {
        deliverySemantics: delivery.deliverySemantics,
        maxReceiveCount: delivery.maxReceiveCount,
        dlqNodeId: delivery.dlqNodeId
      },
      metadata: request.metadata,
      attempts: (request.retryCount ?? 0) + 1
    })
  }

  private markRequestTerminal(
    request: Request,
    status: TerminalRequestStatus,
    reasonCode?: string | null
  ): void {
    this.resolveTerminalTraitOutcomes(request, status, reasonCode)
    // The response (or failure) has returned, so held connection streams free.
    this.releaseConnectionLeases(request.id)
    this.tracer.setTerminalReason(request.id, reasonCode)
    request.metadata.__terminal = status
    this.resolveParkedFollowers(request, status, reasonCode)
    this.markTerminalTombstone(request.id)
    this.releaseOrderingLane(request)
    const createdAtMs = microToMs(request.createdAt)
    const terminalAtMs = microToMs(this.clock)
    const operation = describeRequestOperation(request)
    const classification = classifyRequestOutcome(status, reasonCode)
    const semantics = this.buildOutcomeSemantics(request, status)
    this.requestOutcomeBreakdown[classification.family]++
    this.retainRequestOutcome({
      requestId: request.id,
      status,
      reasonCode: reasonCode ?? null,
      createdAtMs,
      terminalAtMs,
      nodeId: request.path.length > 0 ? request.path[request.path.length - 1] : null,
      attempts: (request.retryCount ?? 0) + 1,
      latencyMs: Math.max(0, terminalAtMs - createdAtMs),
      requestType: operation.requestType,
      originId: request.origin?.originId,
      originLabel: request.origin?.label,
      originLocation: request.origin?.location,
      servingRegionId: request.servingRegionId,
      servingRegionLabel: request.servingRegionLabel,
      cacheOutcome:
        request.metadata.__cacheOutcome === 'hit' || request.metadata.__cacheOutcome === 'miss'
          ? request.metadata.__cacheOutcome
          : undefined,
      method: operation.method,
      host: operation.host,
      path: operation.path,
      operationLabel: operation.operationLabel,
      outcomeFamily: classification.family,
      statusClass: classification.statusClass,
      statusCodeHint: classification.statusCodeHint,
      semantics,
      stateTimeline: this.buildOutcomeStateTimeline(request, status)
    })
    this.requestById.delete(request.id)
  }

  private resolveTerminalTraitOutcomes(
    request: Request,
    status: TerminalRequestStatus,
    reasonCode?: string | null
  ): void {
    const visitedNodeIds = new Set(request.path)
    for (const nodeId of visitedNodeIds) {
      const node = this.nodeDefinitionsById.get(nodeId)
      if (!node) {
        continue
      }
      for (const trait of this.traitsByNodeId.get(nodeId) ?? []) {
        if (!trait.afterTerminal) {
          continue
        }
        const payload = trait.afterTerminal({
          node,
          request,
          clock: this.clock,
          state: this.getTraitStateStore(nodeId),
          sharedState: this.getSharedTraitStateStore(),
          nodeState: this.nodes.get(nodeId)?.getState(),
          status,
          reasonCode,
          getNode: (id) => this.nodeDefinitionsById.get(id)
        })
        if (!payload) {
          continue
        }
        this.recordTraitPayloadMetrics(nodeId, payload)
        this.recordTraitDecision(nodeId, request, trait.name, 'afterTerminal', payload)
      }
    }
  }

  private markTerminalTombstone(requestId: string, terminalAtUs = this.clock): void {
    this.terminalStatusByRequestId.set(requestId, terminalAtUs)
    this.terminalTombstoneOrder.push({ requestId, terminalAtUs })
    this.pruneTerminalTombstones()
  }

  private pruneTerminalTombstones(): void {
    const minTerminalAtUs = this.clock - TERMINAL_TOMBSTONE_RETENTION_US
    while (this.terminalTombstoneHead < this.terminalTombstoneOrder.length) {
      const oldest = this.terminalTombstoneOrder[this.terminalTombstoneHead]
      const overCountLimit =
        this.terminalTombstoneOrder.length - this.terminalTombstoneHead > MAX_TERMINAL_TOMBSTONES
      const pastRetentionWindow = oldest.terminalAtUs < minTerminalAtUs
      if (!overCountLimit && !pastRetentionWindow) {
        break
      }

      this.terminalTombstoneHead++
      const currentTerminalAtUs = this.terminalStatusByRequestId.get(oldest.requestId)
      if (currentTerminalAtUs === oldest.terminalAtUs) {
        this.terminalStatusByRequestId.delete(oldest.requestId)
      }
    }

    if (
      this.terminalTombstoneHead > 10_000 &&
      this.terminalTombstoneHead > this.terminalTombstoneOrder.length / 2
    ) {
      this.terminalTombstoneOrder.splice(0, this.terminalTombstoneHead)
      this.terminalTombstoneHead = 0
    }
  }

  private retainRequestOutcome(outcome: RequestOutcomeRecord): void {
    this.requestOutcomeTotal++

    if (this.retainedRequestOutcomes.length < DEFAULT_MAX_RETAINED_REQUEST_OUTCOMES) {
      this.retainedRequestOutcomes.push(outcome)
      return
    }

    // Deterministic reservoir sampling: each later row has a stable chance to
    // replace an earlier retained row, keeping memory bounded without retaining
    // only the beginning of large runs.
    const slot =
      this.hash32(`${this.topology.global.seed}:${outcome.requestId}`) % this.requestOutcomeTotal
    if (slot < DEFAULT_MAX_RETAINED_REQUEST_OUTCOMES) {
      this.retainedRequestOutcomes[slot] = outcome
    }
  }

  /**
   * Snapshot in-flight survivors at cutoff as explicit `in-flight` outcome rows,
   * then return the full ledger sorted by terminal time (in-flight last, ordered
   * by creation). Requests still in {@link requestById} never reached
   * `markRequestTerminal`, so they are neither completed nor failed — surfacing
   * them keeps the log honest instead of letting arrival/completion counts differ
   * with no visible explanation.
   */
  private buildRequestOutcomes(): RequestOutcomeRecord[] {
    for (const request of this.requestById.values()) {
      const operation = describeRequestOperation(request)
      const classification = classifyRequestOutcome('in-flight')
      const semantics = this.buildOutcomeSemantics(request, 'in-flight')
      this.retainRequestOutcome({
        requestId: request.id,
        status: 'in-flight',
        reasonCode: null,
        createdAtMs: microToMs(request.createdAt),
        terminalAtMs: null,
        nodeId: request.path.length > 0 ? request.path[request.path.length - 1] : null,
        attempts: (request.retryCount ?? 0) + 1,
        latencyMs: null,
        requestType: operation.requestType,
        originId: request.origin?.originId,
        originLabel: request.origin?.label,
        originLocation: request.origin?.location,
        servingRegionId: request.servingRegionId,
        servingRegionLabel: request.servingRegionLabel,
        cacheOutcome:
          request.metadata.__cacheOutcome === 'hit' || request.metadata.__cacheOutcome === 'miss'
            ? request.metadata.__cacheOutcome
            : undefined,
        method: operation.method,
        host: operation.host,
        path: operation.path,
        operationLabel: operation.operationLabel,
        outcomeFamily: classification.family,
        statusClass: classification.statusClass,
        statusCodeHint: classification.statusCodeHint,
        semantics,
        stateTimeline: this.buildOutcomeStateTimeline(request, 'in-flight')
      })
    }

    return [...this.retainedRequestOutcomes].sort((a, b) => {
      const aKey = a.terminalAtMs ?? Number.POSITIVE_INFINITY
      const bKey = b.terminalAtMs ?? Number.POSITIVE_INFINITY
      if (aKey !== bKey) return aKey - bKey
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs
      return a.requestId.localeCompare(b.requestId)
    })
  }

  private buildRequestOutcomeBreakdown() {
    return {
      ...this.requestOutcomeBreakdown,
      in_flight: this.requestById.size
    }
  }

  private hash32(value: string): number {
    let hash = 2166136261
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  /**
   * Early-abort guard: returns true when the run should stop because the design
   * is saturated. A node counts as saturated when its instantaneous utilization
   * is at/above the threshold AND it has a standing backlog (queue > 0) — the
   * latter distinguishes a genuinely overwhelmed node from one that is merely busy
   * for an instant. Only armed after warmup so startup transients don't trip it.
   */
  private checkSaturationHalt(snapshot: TimeSeriesSnapshot): boolean {
    const threshold = this.resolvedStop.haltUtilization
    if (threshold === null) return false
    if (microToMs(this.clock) < this.topology.global.warmupDuration) return false

    for (const state of Object.values(snapshot.node)) {
      if (state.utilization >= threshold && state.queueLength > 0) {
        this.stopReason = 'saturation'
        this.stoppedAtUs = this.clock
        return true
      }
    }
    return false
  }

  private takeSnapshot(): TimeSeriesSnapshot {
    this.lastSnapshotAt = this.clock
    const nodes: TimeSeriesSnapshot['node'] = {}

    for (const [nodeId, node] of this.nodes) {
      const state = node.getState()
      this.metrics.recordNodeSnapshot(nodeId, state, this.clock)
      const areas = node.utilizationAreasAt(this.clock)
      const limits = this.nodeLimitsById.get(nodeId)
      nodes[nodeId] = {
        queueLength: state.queueLength,
        activeWorkers: state.activeWorkers,
        totalInSystem: state.totalInSystem,
        utilization: state.utilization,
        status: state.status,
        busyAreaUs: areas.busyAreaUs,
        capacityAreaUs: areas.capacityAreaUs,
        completedTotal: node.getTotalCompleted(),
        workers: limits?.workers ?? state.workerCapacity,
        capacity:
          limits?.capacity !== undefined && Number.isFinite(limits.capacity)
            ? limits.capacity
            : undefined
      }
    }

    return {
      timestamp: microToMs(this.clock),
      node: nodes
    }
  }

  private generateResults(): SimulationOutput {
    if (!this.running && !this.pendingInFlightMetricsFlushed) {
      for (const request of this.requestById.values()) {
        this.metrics.recordInFlightCompletedSpans(request.spans)
      }
      this.pendingInFlightMetricsFlushed = true
    }

    // Close each node's busy-area integral at the run horizon and report it as
    // the single source of truth for utilization (never snapshot-averaged).
    // A run that ended early (saturation halt or user stop) is measured up to
    // where it ended, so throughput and utilization aren't diluted by time that
    // was never simulated.
    const earlyEndUs = this.stoppedAtUs ?? this.endedEarlyAtUs
    const horizonUs =
      earlyEndUs ??
      (this.clock < this.simulationDurationUs ? this.simulationDurationUs : this.clock)
    for (const [nodeId, node] of this.nodes) {
      node.finalizeUtilization(horizonUs)
      const workers = this.nodeLimitsById.get(nodeId)?.workers ?? 1
      this.metrics.recordNodeBusyTime(
        nodeId,
        node.getBusyAreaUs(),
        workers,
        node.getCapacityAreaUs(),
        node.getCpuBusyAreaUs(),
        node.getCoreAreaUs()
      )
    }

    const eventStream = this.getEventStream()
    const eventCountsByType = this.getEventCountsByType()
    const eventLog = this.debugTarget ? [...this.debugEvents] : null
    const debuggedLifecycle =
      this.debugTarget && this.debugTarget !== 'all'
        ? this.buildDebuggedLifecycle(this.debugTarget, eventStream)
        : null

    const output = generateSimulationOutput(
      this.metrics,
      this.tracer,
      this.timeSeries,
      this.causalGraphRecorder.build(this.topology.edges),
      [],
      earlyEndUs === null
        ? this.topology.global
        : {
            ...this.topology.global,
            simulationDuration: Math.max(microToMs(earlyEndUs), this.topology.global.warmupDuration)
          },
      this.eventsProcessed,
      eventStream,
      eventCountsByType,
      {
        eventLog,
        debuggedLifecycle,
        statusTimeline: this.buildStatusTimeline(),
        requestOutcomes: this.buildRequestOutcomes(),
        requestOutcomeTotal: this.requestOutcomeTotal,
        requestOutcomeBreakdown: this.buildRequestOutcomeBreakdown(),
        requestOutcomesSampled: this.requestOutcomeTotal > DEFAULT_MAX_RETAINED_REQUEST_OUTCOMES,
        streamProjection: this.buildStreamProjection(),
        replicationProjection: this.buildReplicationProjection()
      }
    )

    return {
      ...output,
      ...(this.clusters.size > 0
        ? { clusterProjection: this.buildClusterProjection(horizonUs) }
        : {}),
      invariantViolations: evaluateInvariantViolations(this.topology.invariants, output),
      singlePointsOfFailure: detectSinglePointsOfFailure(this.topology),
      stopReason: this.stopReason,
      stoppedAtMs: this.stoppedAtUs !== null ? microToMs(this.stoppedAtUs) : microToMs(this.clock)
    }
  }

  private buildDebuggedLifecycle(
    requestId: string,
    eventStream: CanonicalEventRecord[]
  ): RequestLifecycle | null {
    return (
      replayEventStream(eventStream.filter((event) => event.requestId === requestId))
        .lifecycleByRequestId[requestId] ?? null
    )
  }

  private withNodeDefaults(node: ComponentNode): ComponentNode {
    return {
      ...node,
      queue: node.queue ?? { workers: 1, capacity: 100, discipline: 'fifo' },
      processing: node.processing ?? {
        distribution: { type: 'constant', value: 1 },
        timeout: 30_000
      }
    }
  }

  private readNodeErrorRate(node: ComponentNode): number | null {
    const raw = node.config?.['nodeErrorRate']
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    return Math.max(0, Math.min(1, raw))
  }

  private readSecurityPolicy(node: ComponentNode): SecurityPolicyConfig | null {
    const raw = node.config?.['securityPolicy']
    if (!raw || typeof raw !== 'object') return null
    const blockRate = (raw as Record<string, unknown>)['blockRate']
    const droppedPackets = (raw as Record<string, unknown>)['droppedPackets']
    const normalizedBlockRate =
      typeof blockRate === 'number' && Number.isFinite(blockRate)
        ? Math.max(0, Math.min(1, blockRate))
        : 0
    const normalizedDroppedPackets =
      typeof droppedPackets === 'number' && Number.isFinite(droppedPackets)
        ? Math.max(0, Math.min(1, droppedPackets))
        : 0

    if (normalizedBlockRate <= 0 && normalizedDroppedPackets <= 0) {
      return null
    }

    return {
      blockRate: normalizedBlockRate,
      droppedPackets: normalizedDroppedPackets
    }
  }

  private applySecurityPolicy(nodeId: string, request: Request): boolean {
    const policy = this.securityPolicyByNodeId.get(nodeId)
    if (!policy) return false

    if (policy.droppedPackets > 0 && this.distributions.random() < policy.droppedPackets) {
      this.traceAdmission(request, nodeId, 'security', 'dropped', {
        reasonCode: 'security_dropped',
        policy: { blockRate: policy.blockRate, droppedPackets: policy.droppedPackets }
      })
      const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
      this.eventQueue.insert(
        createEvent(
          'request-timeout',
          nodeId,
          request.id,
          { request, nodeArrivalTime: this.clock, timeoutSeq: request.timeoutSeq ?? 0 },
          timeoutAt
        )
      )
      return true
    }

    if (policy.blockRate > 0 && this.distributions.random() < policy.blockRate) {
      this.traceAdmission(request, nodeId, 'security', 'rejected', {
        reasonCode: 'security_blocked',
        policy: { blockRate: policy.blockRate, droppedPackets: policy.droppedPackets }
      })
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          nodeId,
          request.id,
          { request, reason: 'security_blocked', nodeArrivalTime: this.clock },
          this.clock
        )
      )
      return true
    }

    return false
  }

  private shouldFailAtNode(nodeId: string): boolean {
    const nodeErrorRate = this.nodeErrorRateById.get(nodeId)
    if (!nodeErrorRate || nodeErrorRate <= 0) return false
    return this.distributions.random() < nodeErrorRate
  }

  private getTraitStateStore(nodeId: string): TraitStateStore {
    let store = this.traitStateByNodeId.get(nodeId)
    if (!store) {
      store = new Map<string, unknown>()
      this.traitStateByNodeId.set(nodeId, store)
    }
    return {
      get: <T>(key: string) => store!.get(key) as T | undefined,
      set: <T>(key: string, value: T) => {
        store!.set(key, value)
      }
    }
  }

  private getSharedTraitStateStore(): TraitStateStore {
    const store = this.sharedTraitState
    return {
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: <T>(key: string, value: T) => {
        store.set(key, value)
      }
    }
  }

  private isNodeHealthy(nodeId: string): boolean {
    // Nodes watched by a Health Check Manager only become (un)healthy once the
    // prober detects it — this is the detection-latency lesson. Unmonitored
    // nodes fall back to instantaneous knowledge, a declared simplification.
    if (this.probedNodeIds.has(nodeId)) {
      return this.probeStateByNodeId.get(nodeId)?.healthy ?? true
    }

    return this.isNodeHealthyInstant(nodeId)
  }

  private isNodeHealthyInstant(nodeId: string): boolean {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return true
    }

    if (node.getState().status === 'failed') {
      return false
    }

    const nodeErrorRate = this.nodeErrorRateById.get(nodeId) ?? 0
    if (nodeErrorRate >= 1) {
      return false
    }

    const unhealthyUntil = this.nodeUnhealthyUntilUs.get(nodeId)
    if (unhealthyUntil === undefined) {
      return true
    }

    if (unhealthyUntil > this.clock) {
      return false
    }

    this.nodeUnhealthyUntilUs.delete(nodeId)
    return true
  }

  private handleTraitTick(event: SimulationEvent): void {
    const traitName = typeof event.data['traitName'] === 'string' ? event.data['traitName'] : null
    const intervalMs =
      typeof event.data['intervalMs'] === 'number' ? event.data['intervalMs'] : null
    if (!traitName || intervalMs === null || intervalMs <= 0) {
      return
    }

    const node = this.nodeDefinitionsById.get(event.nodeId)
    const trait = (this.traitsByNodeId.get(event.nodeId) ?? []).find((t) => t.name === traitName)
    if (node && trait?.onTick) {
      const payload = trait.onTick({
        node,
        clock: this.clock,
        random: () => this.distributions.random(),
        state: this.getTraitStateStore(event.nodeId),
        sharedState: this.getSharedTraitStateStore(),
        nodeState: this.nodes.get(event.nodeId)?.getState()
      })
      if (payload) {
        // Surface any metricCounters the tick emitted (the generic counter path);
        // ticks are request-less, so we don't record a request-scoped decision.
        this.recordTraitPayloadMetrics(event.nodeId, payload)
        // A control-loop tick may request an autoscale: resize the node's
        // effective concurrency to the requested instance count.
        if (typeof payload['scaleInstancesTo'] === 'number') {
          if (this.clusterIdByWorkload.has(event.nodeId)) {
            // Replicas on a cluster: the autoscaler only changes the desired
            // count; capacity follows the pods the cluster can place and start.
            this.setScheduledReplicas(event.nodeId, payload['scaleInstancesTo'])
          } else {
            this.applyNodeScale(event.nodeId, payload['scaleInstancesTo'])
          }
        }
      }
    }

    // Re-arm. The event-loop time bound (peek > simulationDurationUs) halts this
    // once the next tick lands past the run's end, so it can't loop forever.
    this.eventQueue.insert(
      createEvent(
        'trait-tick',
        event.nodeId,
        '',
        { traitName, intervalMs },
        this.clock + msToMicro(intervalMs)
      )
    )
  }

  /**
   * Autoscale a node to a new instance count mid-run: recompute its derived
   * effective c/K for that many instances and resize the queue node. Graceful —
   * the node never drops below in-flight usage — and utilization stays honest
   * because the node integrates a capacity-time area, not a fixed worker count.
   */
  private applyNodeScale(nodeId: string, instanceCount: number): void {
    const def = this.nodeDefinitionsById.get(nodeId)
    const node = this.nodes.get(nodeId)
    if (!def || !node) {
      return
    }
    const instances = Math.max(1, Math.round(instanceCount))
    const rescaled: ComponentNode = {
      ...def,
      resources: { ...(def.resources ?? {}), instanceCount: instances }
    }
    const { effectiveC, effectiveK, physicalCores } = deriveNodeConcurrency(rescaled)
    const { started } = node.resizeConcurrency(effectiveC, effectiveK, this.clock, physicalCores)
    this.nodeLimitsById.set(nodeId, { workers: effectiveC, capacity: effectiveK })

    for (const resumed of started) {
      this.markNodePhaseServiceStart(resumed, nodeId, this.clock)
      this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'processing-started',
        priority: EventPriority.PROCESSING,
        requestId: resumed.id,
        nodeId,
        payload: { request: resumed },
        nodeSnapshot: this.createNodeSnapshot(nodeId)
      })
    }
  }

  /**
   * Cluster bin-packing (scheduler trait). Every workload whose `scheduledOn`
   * names a Kubernetes Cluster node becomes pods on that cluster's machines; at
   * t=0 the replicas that fit are placed and ready (the run starts in steady
   * state), the rest stay pending, and each workload's serving capacity is
   * resized to its ready pods. Configured machine failures and recoveries are
   * scheduled here.
   */
  private initializeClusterScheduling(scheduler: EventScheduler): void {
    const workloadsByCluster = new Map<string, ComponentNode[]>()
    for (const node of this.nodeDefinitionsById.values()) {
      const cluster = resolveScheduledCluster(this.topology, node)
      if (!cluster || cluster.id === node.id || !this.nodes.has(cluster.id)) continue
      const list = workloadsByCluster.get(cluster.id) ?? []
      list.push(node)
      workloadsByCluster.set(cluster.id, list)
    }

    for (const [clusterId, workloads] of workloadsByCluster) {
      const def = this.nodeDefinitionsById.get(clusterId)
      if (!def) continue
      const machineType = def.resources?.instanceType ?? getResourceDefaults(def.type).instanceType
      const machine = INSTANCE_CATALOG[machineType]
      const machineCount = Math.max(0, Math.round(getInstanceCount(def.resources)))
      const config = readClusterConfig(def.config)
      const cluster = new ClusterScheduler({
        clusterId,
        machineVcpu: machine.vcpu,
        machineRamGb: machine.ramGb,
        machineCount,
        strategy: config.strategy,
        podStartupUs: msToMicro(config.podStartupMs),
        rescheduleDelayUs: msToMicro(config.rescheduleDelayMs),
        maxMachines: Math.max(machineCount, Math.round(config.maxMachines ?? machineCount)),
        machineProvisionUs: msToMicro(config.machineProvisionMs)
      })
      for (const workload of workloads) {
        const podType =
          workload.resources?.instanceType ?? getResourceDefaults(workload.type).instanceType
        const pod = INSTANCE_CATALOG[podType]
        cluster.register({
          nodeId: workload.id,
          podVcpu: pod.vcpu,
          podRamGb: pod.ramGb,
          desired: getInstanceCount(workload.resources)
        })
        this.clusterIdByWorkload.set(workload.id, clusterId)
      }
      this.clusters.set(clusterId, cluster)

      const started = cluster.initialPlacement(0n)
      this.recordPodStarts(clusterId, started)
      for (const workload of workloads) {
        const unplaced = cluster.pendingCount(workload.id)
        if (unplaced > 0) {
          this.metrics.recordNodeTraitCounters(workload.id, { podsUnplaced: unplaced })
          this.metrics.recordNodeTraitCounters(clusterId, { clusterPodsUnplaced: unplaced })
        }
        this.applyClusterCapacity(workload.id)
      }
      this.maybeProvisionMachines(clusterId)

      if (config.machineFailureAtMs !== null) {
        scheduler.schedule(
          createEvent(
            'cluster-schedule',
            clusterId,
            '',
            { action: 'machine-failure', count: config.machineFailureCount },
            msToMicro(config.machineFailureAtMs)
          )
        )
        if (
          config.machineRecoveryAtMs !== null &&
          config.machineRecoveryAtMs > config.machineFailureAtMs
        ) {
          scheduler.schedule(
            createEvent(
              'cluster-schedule',
              clusterId,
              '',
              { action: 'machine-recovery' },
              msToMicro(config.machineRecoveryAtMs)
            )
          )
        }
      }
    }
  }

  /** Count placements and schedule each starting pod's ready event. */
  private recordPodStarts(clusterId: string, started: readonly PodStart[]): void {
    if (started.length === 0) return
    this.metrics.recordNodeTraitCounters(clusterId, { clusterPodsScheduled: started.length })
    for (const { pod, readyAtUs } of started) {
      this.metrics.recordNodeTraitCounters(pod.workloadId, { podsScheduled: 1 })
      if (pod.state === 'starting') {
        this.eventQueue.insert(
          createEvent(
            'cluster-schedule',
            clusterId,
            '',
            { action: 'pod-ready', podId: pod.id },
            readyAtUs
          )
        )
      }
    }
  }

  /**
   * Resize a scheduled workload to the pods that are ready right now. Each pod
   * contributes one instance's derived c / K / cores, so a fully placed
   * workload runs exactly as it would on dedicated instances.
   */
  private applyClusterCapacity(workloadId: string): void {
    const clusterId = this.clusterIdByWorkload.get(workloadId)
    const cluster = clusterId ? this.clusters.get(clusterId) : undefined
    const def = this.nodeDefinitionsById.get(workloadId)
    const node = this.nodes.get(workloadId)
    if (!cluster || !def || !node) return
    const ready = cluster.readyCount(workloadId)
    this.getSharedTraitStateStore().set(scheduledReadyStateKey(workloadId), ready)
    const perPod = deriveNodeConcurrency({
      ...def,
      resources: { ...(def.resources ?? {}), instanceCount: 1 }
    })
    const workers = perPod.effectiveC * ready
    const capacity = Math.max(1, perPod.effectiveK * ready)
    const { started } = node.resizeConcurrency(
      workers,
      capacity,
      this.clock,
      perPod.physicalCores * ready
    )
    this.nodeLimitsById.set(workloadId, { workers: Math.max(1, workers), capacity })
    for (const resumed of started) {
      this.markNodePhaseServiceStart(resumed, workloadId, this.clock)
      this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'processing-started',
        priority: EventPriority.PROCESSING,
        requestId: resumed.id,
        nodeId: workloadId,
        payload: { request: resumed },
        nodeSnapshot: this.createNodeSnapshot(workloadId)
      })
    }
  }

  /** Place whatever pending pods now fit, then let the cluster autoscaler react. */
  private runClusterScheduling(clusterId: string): void {
    const cluster = this.clusters.get(clusterId)
    if (!cluster) return
    this.recordPodStarts(clusterId, cluster.schedulePending(this.clock))
    this.maybeProvisionMachines(clusterId)
  }

  /** Cluster autoscaler: boot machines for pods that fit nowhere, up to the max. */
  private maybeProvisionMachines(clusterId: string): void {
    const cluster = this.clusters.get(clusterId)
    if (!cluster) return
    const needed = cluster.machinesNeededForPending()
    if (needed <= 0) return
    const indexes = cluster.provisionMachines(needed, this.clock)
    this.metrics.recordNodeTraitCounters(clusterId, { clusterMachinesProvisioned: indexes.length })
    for (const machineIndex of indexes) {
      this.eventQueue.insert(
        createEvent(
          'cluster-schedule',
          clusterId,
          '',
          { action: 'machine-joined', machineIndex },
          this.clock + cluster.options.machineProvisionUs
        )
      )
    }
  }

  /** The autoscaler asked a scheduled workload for `replicas` pods. */
  private setScheduledReplicas(workloadId: string, replicas: number): void {
    const clusterId = this.clusterIdByWorkload.get(workloadId)
    const cluster = clusterId ? this.clusters.get(clusterId) : undefined
    if (!clusterId || !cluster) return
    const before = cluster.desiredCount(workloadId)
    const { removedReady } = cluster.setDesired(workloadId, replicas, this.clock)
    if (removedReady > 0) this.applyClusterCapacity(workloadId)
    this.runClusterScheduling(clusterId)
    const added = cluster.desiredCount(workloadId) - before
    if (added > 0) {
      const unplaced = Math.min(added, cluster.pendingCount(workloadId))
      if (unplaced > 0) {
        this.metrics.recordNodeTraitCounters(workloadId, { podsUnplaced: unplaced })
        this.metrics.recordNodeTraitCounters(clusterId, { clusterPodsUnplaced: unplaced })
      }
    }
  }

  private handleClusterSchedule(event: SimulationEvent): void {
    const clusterId = event.nodeId
    const cluster = this.clusters.get(clusterId)
    if (!cluster) return
    const action = event.data.action
    if (action === 'pod-ready') {
      const workloadId =
        typeof event.data.podId === 'string'
          ? cluster.markReady(event.data.podId, this.clock)
          : null
      if (workloadId) this.applyClusterCapacity(workloadId)
      return
    }
    if (action === 'machine-failure') {
      const count = typeof event.data.count === 'number' ? event.data.count : 1
      const failure = cluster.failMachines(count, this.clock)
      if (failure.machineIndexes.length === 0) return
      this.metrics.recordNodeTraitCounters(clusterId, {
        clusterMachineFailures: failure.machineIndexes.length,
        clusterPodsLost: failure.podsLost
      })
      for (const workloadId of failure.affectedWorkloads) {
        this.applyClusterCapacity(workloadId)
      }
      for (const lost of failure.lostPods) {
        this.metrics.recordNodeTraitCounters(lost.workloadId, { podsLost: lost.count })
      }
      for (const machineIndex of failure.machineIndexes) {
        this.eventQueue.insert(
          createEvent(
            'cluster-schedule',
            clusterId,
            '',
            { action: 'evict', machineIndex },
            this.clock + cluster.options.rescheduleDelayUs
          )
        )
      }
      this.failedMachinesByCluster.set(clusterId, failure.machineIndexes)
      return
    }
    if (action === 'evict') {
      const machineIndex =
        typeof event.data.machineIndex === 'number' ? event.data.machineIndex : -1
      const evicted = cluster.evictLost(machineIndex, this.clock)
      if (evicted.total > 0) {
        this.metrics.recordNodeTraitCounters(clusterId, { clusterPodsEvicted: evicted.total })
        for (const [workloadId, count] of evicted.byWorkload) {
          this.metrics.recordNodeTraitCounters(workloadId, { podsEvicted: count })
        }
      }
      this.runClusterScheduling(clusterId)
      return
    }
    if (action === 'machine-recovery') {
      for (const machineIndex of this.failedMachinesByCluster.get(clusterId) ?? []) {
        this.recordPodStarts(clusterId, cluster.recoverMachine(machineIndex, this.clock))
      }
      this.failedMachinesByCluster.delete(clusterId)
      this.runClusterScheduling(clusterId)
      return
    }
    if (action === 'machine-joined') {
      const machineIndex =
        typeof event.data.machineIndex === 'number' ? event.data.machineIndex : -1
      if (cluster.machineJoined(machineIndex, this.clock)) this.runClusterScheduling(clusterId)
    }
  }

  private buildClusterProjection(horizonUs: bigint): ClusterProjection[] {
    return [...this.clusters.values()].map((cluster) => cluster.projection(horizonUs))
  }

  private handleHealthProbe(event: SimulationEvent): void {
    const config = this.healthCheckManagerConfigById.get(event.nodeId)
    if (!config) {
      return
    }

    for (const monitoredNodeId of config.monitoredNodes) {
      const actualHealthy = this.isNodeHealthyInstant(monitoredNodeId)
      const previous = this.probeStateByNodeId.get(monitoredNodeId) ?? createInitialProbeState()
      const next = evaluateProbe(previous, actualHealthy, config)
      this.probeStateByNodeId.set(monitoredNodeId, next)

      this.recordCanonicalEvent({
        timestampUs: this.clock,
        type: 'health-probed',
        priority: EventPriority.SYSTEM,
        nodeId: monitoredNodeId,
        sourceNodeId: event.nodeId,
        payload: {
          healthCheckManagerId: event.nodeId,
          actualHealthy,
          probedHealthy: next.healthy,
          consecutiveFailures: next.consecutiveFailures,
          consecutiveSuccesses: next.consecutiveSuccesses
        }
      })
    }

    this.eventQueue.insert(
      createEvent(
        'health-check',
        event.nodeId,
        '',
        {},
        this.clock + msToMicro(config.checkIntervalMs)
      )
    )
  }

  private isEdgeHealthy(edge: EdgeDefinition): boolean {
    return edge.packetLossRate < 1 && edge.errorRate < 1
  }

  private resolveRoutes(sourceNodeId: string, request: Request) {
    return this.routing.resolveTargetResult(sourceNodeId, request, {
      clock: this.clock,
      isTargetHealthy: (nodeId) => this.isNodeHealthy(nodeId),
      isEdgeHealthy: (edge) => this.isEdgeHealthy(edge),
      getInFlight: (nodeId) => this.nodes.get(nodeId)?.getState().totalInSystem ?? 0,
      getResponseTimeMs: (nodeId) => this.nodes.get(nodeId)?.getState().meanServiceTimeMs ?? 0,
      estimateRouteLatencyMs: (edge, routedRequest) =>
        this.geoLatency.estimateEdgeLatencyMs(edge, routedRequest),
      sharedState: this.getSharedTraitStateStore(),
      onTraitDecision: (decision) => {
        this.recordTraitPayloadMetrics(decision.nodeId, decision.payload)
        this.recordTraitDecision(decision.nodeId, request, decision.traitName, decision.hook, {
          decision: decision.decision,
          ...(decision.payload ?? {})
        })
      }
    })
  }

  private resolveReroutedTarget(sourceNodeId: string, targetNodeId: string) {
    const edge = this.routing.getOutgoingEdges(sourceNodeId).find((candidate) => {
      return candidate.target === targetNodeId
    })

    if (!edge) {
      return { routes: [], rejectionReason: 'trait_invalid_reroute' as const }
    }

    return {
      routes: [{ targetNodeId, edge }]
    }
  }

  private markNodeUnhealthyForReason(nodeId: string, reason: string): void {
    if (reason === 'node_failed' || reason === 'capacity_exceeded' || reason === 'oom') {
      this.markNodeTemporarilyUnhealthy(nodeId)
    }
  }

  private markNodeTemporarilyUnhealthy(nodeId: string): void {
    this.nodeUnhealthyUntilUs.set(nodeId, this.clock + LOAD_BALANCER_UNHEALTHY_COOLDOWN_US)
  }

  private releaseEdgeTransfer(edgeId: unknown): void {
    if (typeof edgeId !== 'string') {
      return
    }

    const activeTransfers = this.activeTransfersByEdgeId.get(edgeId)
    if (!activeTransfers) {
      return
    }

    if (activeTransfers <= 1) {
      this.activeTransfersByEdgeId.delete(edgeId)
      return
    }

    this.activeTransfersByEdgeId.set(edgeId, activeTransfers - 1)
  }

  private maybeTrackCircuitBreakerRequest(
    request: Request,
    sourceNodeId: string,
    targetNodeId: string
  ): void {
    const sourceNode = this.nodeDefinitionsById.get(sourceNodeId)
    if (!sourceNode || !readCircuitBreakerConfig(sourceNode)) {
      return
    }

    attachCircuitBreakerTracking(request, sourceNodeId, targetNodeId)
  }

  private maybeRecordCircuitBreakerOutcome(
    request: Request,
    observedNodeId: string,
    success: boolean
  ): void {
    const tracking = readCircuitBreakerTracking(request)
    if (!tracking || tracking.targetNodeId !== observedNodeId) {
      return
    }

    clearCircuitBreakerTracking(request)

    const trackerNode = this.nodeDefinitionsById.get(tracking.trackerNodeId)
    if (!trackerNode) {
      return
    }

    const outcome = recordCircuitBreakerOutcome(
      this.getTraitStateStore(tracking.trackerNodeId),
      trackerNode,
      success,
      this.clock
    )

    if (!outcome.transition) {
      return
    }

    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: outcome.transition === 'open' ? 'circuit-breaker-open' : 'circuit-breaker-close',
      priority: EventPriority.SYSTEM,
      requestId: request.id,
      nodeId: tracking.trackerNodeId,
      payload: {
        targetNodeId: observedNodeId,
        outcome: success ? 'success' : 'failure'
      },
      nodeSnapshot: this.createNodeSnapshot(tracking.trackerNodeId)
    })
  }

  private maybeRecordCircuitBreakerOutcomeAtNode(
    nodeId: string,
    request: Request,
    success: boolean
  ): void {
    const node = this.nodeDefinitionsById.get(nodeId)
    if (!node || !readCircuitBreakerConfig(node)) {
      return
    }

    const outcome = recordCircuitBreakerOutcome(
      this.getTraitStateStore(nodeId),
      node,
      success,
      this.clock
    )
    if (!outcome.transition) {
      return
    }

    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: outcome.transition === 'open' ? 'circuit-breaker-open' : 'circuit-breaker-close',
      priority: EventPriority.SYSTEM,
      requestId: request.id,
      nodeId,
      payload: {
        outcome: success ? 'success' : 'failure'
      },
      nodeSnapshot: this.createNodeSnapshot(nodeId)
    })
  }

  private rejectRequestAtNode(
    nodeId: string,
    request: Request,
    reason: string,
    nodeArrivalTime: bigint
  ): void {
    this.eventQueue.insert(
      createEvent(
        'request-rejected',
        nodeId,
        request.id,
        { request, reason, nodeArrivalTime },
        this.clock
      )
    )
  }

  private scheduleNodeTimeout(nodeId: string, request: Request): void {
    const nodeTimeoutUs = this.nodeTimeoutUsById.get(nodeId)
    if (!nodeTimeoutUs) {
      return
    }

    const timeoutAt = this.clock + nodeTimeoutUs
    const effectiveTimeoutAt = request.deadline < timeoutAt ? request.deadline : timeoutAt

    this.eventQueue.insert(
      createEvent(
        'request-timeout',
        nodeId,
        request.id,
        {
          request,
          nodeArrivalTime: this.clock,
          scope: 'node',
          timeoutSeq: request.timeoutSeq ?? 0
        },
        effectiveTimeoutAt
      )
    )
  }

  /**
   * Schedule the TIMEOUT_FIRE for a held request at t + min(nodeTimeout,
   * globalRemaining). Unlike a normal admission, a held request has no service
   * event, so this timeout is its only route to a terminal — it must always be
   * scheduled, falling back to the request deadline when the node has no timeout.
   */
  private scheduleHeldTimeout(nodeId: string, request: Request): void {
    const nodeTimeoutUs = this.nodeTimeoutUsById.get(nodeId)
    const timeoutAt = nodeTimeoutUs !== undefined ? this.clock + nodeTimeoutUs : request.deadline
    const effectiveTimeoutAt = request.deadline < timeoutAt ? request.deadline : timeoutAt

    this.eventQueue.insert(
      createEvent(
        'request-timeout',
        nodeId,
        request.id,
        {
          request,
          nodeArrivalTime: this.clock,
          scope: 'node',
          timeoutSeq: request.timeoutSeq ?? 0
        },
        effectiveTimeoutAt
      )
    )
  }

  private enqueueEdgeTransfer(request: Request, edge: EdgeDefinition, targetNodeId: string): void {
    const edgePhase = this.beginEdgePhase(request, edge, targetNodeId, this.clock)

    const batching = this.edgeBatchingFor(edge)
    if (batching) {
      this.addToEdgeBatch(request, edge, targetNodeId, edgePhase, batching)
      return
    }

    const connection = this.edgeConnectionFor(edge)
    if (!connection) {
      this.dispatchEdgeTransfer(request, edge, targetNodeId, edgePhase, this.clock, 0n)
      return
    }

    const pool = this.connectionPoolFor(edge, request)
    this.acquireConnectionAndDispatch(
      {
        request,
        edge,
        targetNodeId,
        edgePhase,
        enqueuedAtUs: this.clock,
        poolId: pool.poolId,
        ephemeral: pool.ephemeral
      },
      false
    )
  }

  private edgeConnectionFor(edge: EdgeDefinition): ResolvedConnectionConfig | null {
    let resolved = this.edgeConnectionById.get(edge.id)
    if (resolved === undefined) {
      // Batching owns a Kafka edge's transfers; the connection model does not stack on it.
      resolved = this.edgeBatchingFor(edge) ? null : resolveEdgeConnection(edge)
      this.edgeConnectionById.set(edge.id, resolved)
    }
    return resolved
  }

  private edgeBatchingFor(edge: EdgeDefinition): ResolvedEdgeBatching | null {
    let resolved = this.edgeBatchingById.get(edge.id)
    if (resolved === undefined) {
      resolved = resolveEdgeBatching(edge)
      this.edgeBatchingById.set(edge.id, resolved)
    }
    return resolved
  }

  /**
   * Which pool serves this request. A service's outbound edge has one pool. An
   * edge leaving the workload source carries many independent clients, so each
   * client identity gets its own pool; a request without one is a new client
   * whose pool is never reused.
   */
  private connectionPoolFor(
    edge: EdgeDefinition,
    request: Request
  ): { poolId: string; ephemeral: boolean } {
    if (edge.source !== this.topology.workload?.sourceNodeId) {
      return { poolId: edge.id, ephemeral: false }
    }
    const metadata = request.metadata
    for (const field of ['sessionId', 'clientIp', '__key'] as const) {
      const value = metadata[field]
      if ((typeof value === 'string' && value.length > 0) || typeof value === 'number') {
        return { poolId: `${edge.id}::client:${String(value)}`, ephemeral: false }
      }
    }
    return { poolId: `${edge.id}::anon:${request.id}`, ephemeral: true }
  }

  /** Get a connection stream for the waiter and send, or park it until one frees. */
  private acquireConnectionAndDispatch(waiter: ConnectionWaiter, requeued: boolean): void {
    const { request, edge } = waiter
    const config = this.edgeConnectionFor(edge)
    if (!config) {
      return
    }
    const effective: ResolvedConnectionConfig = waiter.ephemeral
      ? { ...config, reuse: 'per-request', tlsSessionResumption: false }
      : config
    const grant = this.connectionPools.acquire(waiter.poolId, Number(this.clock), effective)
    if (grant.closedIdle > 0) {
      this.metrics.recordEdgeConnectionEvent(edge.id, 'closedIdle', this.clock, grant.closedIdle)
    }

    if (grant.kind === 'wait') {
      // Every connection is busy and the pool is at maxConnections: wait FIFO
      // (HTTP/1.1 head-of-line blocking at the pool).
      this.connectionPools.enqueueWaiter(waiter.poolId, waiter, requeued)
      if (!requeued) {
        this.metrics.recordEdgeConnectionEvent(edge.id, 'waited', this.clock)
        const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
        this.eventQueue.insert(
          createEvent(
            'request-timeout',
            waiter.targetNodeId,
            request.id,
            {
              request,
              edge,
              edgeId: edge.id,
              sourceNodeId: edge.source,
              targetNodeId: waiter.targetNodeId,
              edgeInTimeUs: waiter.enqueuedAtUs,
              reason: 'deadline_exceeded',
              scope: 'connection-wait',
              poolId: waiter.poolId,
              timeoutSeq: request.timeoutSeq ?? 0
            },
            timeoutAt
          )
        )
      }
      return
    }

    const held = this.connectionLeasesByRequestId.get(request.id) ?? []
    held.push({
      lease: grant.lease,
      edgeId: edge.id,
      config: effective,
      ephemeral: waiter.ephemeral
    })
    this.connectionLeasesByRequestId.set(request.id, held)

    let handshakeUs = BigInt(Math.round(grant.readyWaitUs))
    if (grant.opened) {
      // One handshake round trip is one sample of the edge's propagation
      // latency (the path-type defaults are round-trip figures).
      const rttMs = Math.max(
        0,
        this.distributions.fromConfig(this.edgeLatencyDistribution(edge, request))
      )
      handshakeUs = msToMicro(grant.handshakeRtts * rttMs)
      this.connectionPools.markReady(grant.lease, Number(this.clock + handshakeUs), effective)
      this.metrics.recordEdgeConnectionEvent(edge.id, 'opened', this.clock)
      if (grant.resumed) {
        this.metrics.recordEdgeConnectionEvent(edge.id, 'resumed', this.clock)
      }
    } else {
      this.metrics.recordEdgeConnectionEvent(edge.id, 'reused', this.clock)
    }

    this.dispatchEdgeTransfer(
      request,
      edge,
      waiter.targetNodeId,
      waiter.edgePhase,
      waiter.enqueuedAtUs,
      handshakeUs
    )
  }

  /**
   * Free connection streams the request holds: all of them (its response came
   * back), or only an unpaired stream on `edgeId` once the transfer delivered.
   * Requests waiting for those connections are then sent, oldest first.
   */
  private releaseConnectionLeases(
    requestId: string,
    edgeId?: unknown,
    when: 'delivered' | 'response' = 'response'
  ): void {
    const held = this.connectionLeasesByRequestId.get(requestId)
    if (!held) {
      return
    }
    const keep: HeldConnectionLease[] = []
    const released: HeldConnectionLease[] = []
    for (const entry of held) {
      if (when === 'delivered' && (entry.edgeId !== edgeId || entry.config.paired)) {
        keep.push(entry)
      } else {
        released.push(entry)
      }
    }
    if (keep.length > 0) {
      this.connectionLeasesByRequestId.set(requestId, keep)
    } else {
      this.connectionLeasesByRequestId.delete(requestId)
    }
    for (const entry of released) {
      const waiters = this.connectionPools.release(
        entry.lease,
        Number(this.clock),
        entry.config,
        entry.ephemeral
      )
      for (const waiter of waiters) {
        if (this.terminalStatusByRequestId.has(waiter.request.id)) {
          continue
        }
        this.acquireConnectionAndDispatch(waiter, true)
      }
    }
  }

  private emitConnectionWaitTimeoutFlow(request: Request, event: SimulationEvent): void {
    const edgeId = typeof event.data.edgeId === 'string' ? event.data.edgeId : ''
    const startedAt =
      typeof event.data.edgeInTimeUs === 'bigint' ? event.data.edgeInTimeUs : this.clock
    this.onEdgeFlowEvent?.({
      sequence: ++this.edgeFlowSequence,
      requestId: request.id,
      edgeId,
      sourceNodeId: typeof event.data.sourceNodeId === 'string' ? event.data.sourceNodeId : '',
      targetNodeId: event.nodeId,
      startedAtMs: microToMs(startedAt),
      completedAtMs: microToMs(this.clock),
      latencyMs: microToMs(this.clock - startedAt),
      status: 'timeout',
      failureCause: 'deadline_exceeded',
      key: affinityKeyOf(request)
    })
  }

  /** Give back the edge slot a transfer held (a batch's slot frees with its last record). */
  private releaseEdgeSlotForEvent(event: SimulationEvent): void {
    const batchId = event.data.edgeBatchId
    if (typeof batchId === 'string') {
      const remaining = (this.batchRecordsInFlight.get(batchId) ?? 0) - 1
      if (remaining > 0) {
        this.batchRecordsInFlight.set(batchId, remaining)
        return
      }
      this.batchRecordsInFlight.delete(batchId)
    }
    this.releaseEdgeTransfer(event.data.edgeId)
  }

  /**
   * Send one transfer over the edge. `startedAtUs` is when the request reached
   * the edge (earlier than now if it waited for a connection); `handshakeUs` is
   * the connection setup it pays before its bytes go on the link.
   */
  private dispatchEdgeTransfer(
    request: Request,
    edge: EdgeDefinition,
    targetNodeId: string,
    edgePhase: RequestEdgePhase,
    startedAtUs: bigint,
    handshakeUs: bigint
  ): void {
    const emitEdgeFlowEvent = (
      status: EdgeFlowStatus,
      completedAt: bigint,
      latencyUs: bigint,
      failureCause?: EdgeFailureCause
    ): void => {
      this.onEdgeFlowEvent?.({
        sequence: ++this.edgeFlowSequence,
        requestId: request.id,
        edgeId: edge.id,
        sourceNodeId: edge.source,
        targetNodeId,
        startedAtMs: microToMs(startedAtUs),
        completedAtMs: microToMs(completedAt),
        latencyMs: microToMs(latencyUs),
        status,
        failureCause,
        key: affinityKeyOf(request)
      })
    }
    const waitedUs = this.clock - startedAtUs

    const currentLoad = this.activeTransfersByEdgeId.get(edge.id) ?? 0
    if (
      protocolSupportsConnectionLimits(edge.protocol) &&
      currentLoad >= edge.maxConcurrentRequests
    ) {
      emitEdgeFlowEvent('edge-error', this.clock, waitedUs, 'connection_refused')
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          targetNodeId,
          request.id,
          {
            request,
            edge,
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId,
            edgeInTimeUs: startedAtUs,
            reason: 'connection_refused',
            observationPoint: 'edge',
            edgeSlotHeld: false
          },
          this.clock
        )
      )
      return
    }

    const transit = this.sampleEdgeTransit(edge, request, currentLoad + 1)
    let retransmitted = false
    if (this.distributions.random() < edge.packetLossRate) {
      if (isReliableProtocol(edge.protocol)) {
        // TCP-style retransmission: the payload crosses the link a second time.
        retransmitted = true
      } else {
        // The bytes were still sent before being dropped, so they occupy the link.
        this.reserveEdgeLink(edge, transit.transmissionMs, 1)
        const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
        emitEdgeFlowEvent('packet-loss', timeoutAt, timeoutAt - startedAtUs, 'packet_loss')
        this.eventQueue.insert(
          createEvent(
            'request-timeout',
            targetNodeId,
            request.id,
            {
              request,
              edge,
              edgeId: edge.id,
              sourceNodeId: edge.source,
              targetNodeId,
              edgeInTimeUs: startedAtUs,
              reason: 'packet_loss',
              scope: 'in-flight',
              timeoutSeq: request.timeoutSeq ?? 0
            },
            timeoutAt
          )
        )
        return
      }
    }

    if (this.distributions.random() < edge.errorRate) {
      emitEdgeFlowEvent('edge-error', this.clock, waitedUs, 'edge_error_rate')
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          targetNodeId,
          request.id,
          {
            request,
            edge,
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId,
            edgeInTimeUs: startedAtUs,
            reason: 'edge_error_rate',
            observationPoint: 'edge',
            edgeSlotHeld: false
          },
          this.clock
        )
      )
      return
    }

    const transitUs = retransmitted ? transit.transitUs * 2n : transit.transitUs
    // The link is reserved now: the FIFO serializer cannot backfill, so a slot
    // reserved after a handshake would block warm-connection transfers behind
    // it. The payload leaves once both the handshake and the link wait are done,
    // so only the part of the link wait the handshake does not cover is added.
    const rawLinkQueueUs = this.reserveEdgeLink(edge, transit.transmissionMs, retransmitted ? 2 : 1)
    const linkQueueUs = rawLinkQueueUs > handshakeUs ? rawLinkQueueUs - handshakeUs : 0n
    const edgeLatencyUs = waitedUs + handshakeUs + linkQueueUs + transitUs
    const latencyBreakdown: EdgeLatencyBreakdownSample = {
      ...transit.components,
      linkQueueMs: microToMs(linkQueueUs),
      retransmissionMs: retransmitted ? microToMs(transit.transitUs) : 0,
      connectionWaitMs: microToMs(waitedUs),
      handshakeMs: microToMs(handshakeUs)
    }

    this.activeTransfersByEdgeId.set(edge.id, currentLoad + 1)
    const arrivalTime = startedAtUs + edgeLatencyUs
    if (request.deadline <= arrivalTime) {
      const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
      emitEdgeFlowEvent('timeout', timeoutAt, timeoutAt - startedAtUs, 'deadline_exceeded')
      this.eventQueue.insert(
        createEvent(
          'request-timeout',
          targetNodeId,
          request.id,
          {
            request,
            edge,
            edgeId: edge.id,
            sourceNodeId: edge.source,
            targetNodeId,
            edgeInTimeUs: startedAtUs,
            reason: 'deadline_exceeded',
            scope: 'in-flight',
            timeoutSeq: request.timeoutSeq ?? 0
          },
          timeoutAt
        )
      )
      return
    }

    this.completeEdgeTransit(
      request,
      edge,
      targetNodeId,
      edgePhase,
      startedAtUs,
      arrivalTime,
      latencyBreakdown,
      undefined,
      emitEdgeFlowEvent
    )
  }

  /** Record a successful transit and schedule the arrival at the target. */
  private completeEdgeTransit(
    request: Request,
    edge: EdgeDefinition,
    targetNodeId: string,
    edgePhase: RequestEdgePhase,
    startedAtUs: bigint,
    arrivalTime: bigint,
    latencyBreakdown: EdgeLatencyBreakdownSample,
    edgeBatchId: string | undefined,
    emitEdgeFlowEvent: (status: EdgeFlowStatus, completedAt: bigint, latencyUs: bigint) => void
  ): void {
    const edgeLatencyUs = arrivalTime - startedAtUs
    // The flow event is a dispatch record; consumers treat a completion after
    // the run end as in flight at cutoff (see mergeEdgeFlowState).
    emitEdgeFlowEvent('success', arrivalTime, edgeLatencyUs)
    // A transfer still queued or on the wire when the run ends never arrives,
    // so it is not a completed transit (matters once bandwidth queueing can push
    // arrival past the end of the run).
    const arrivesBeforeRunEnd = arrivalTime <= this.simulationDurationUs
    // Record the completed hop so the phase timeline can attribute this transit
    // latency to the edge (rather than blaming the downstream node).
    edgePhase.edgeOutUs = arrivalTime
    ;(request.hops ??= []).push({
      edgeId: edge.id,
      source: edge.source,
      target: targetNodeId,
      edgeInUs: startedAtUs,
      edgeOutUs: arrivalTime
    })
    if (arrivesBeforeRunEnd) {
      this.metrics.recordEdgeTransit(
        edge.id,
        edge.source,
        targetNodeId,
        edgeLatencyUs,
        arrivalTime,
        request.sizeBytes,
        latencyBreakdown
      )
    }
    this.eventQueue.insert(
      createEvent(
        'request-arrival',
        targetNodeId,
        request.id,
        {
          request,
          edge,
          edgeId: edge.id,
          sourceNodeId: edge.source,
          ...(edgeBatchId ? { edgeBatchId } : {})
        },
        arrivalTime
      )
    )
  }

  /** Put a record in the edge's open producer batch; send it when full or at linger expiry. */
  private addToEdgeBatch(
    request: Request,
    edge: EdgeDefinition,
    targetNodeId: string,
    edgePhase: RequestEdgePhase,
    batching: ResolvedEdgeBatching
  ): void {
    const { batch, opened, full } = this.edgeBatches.add(
      edge.id,
      { request, targetNodeId, edgePhase, enqueuedAtUs: this.clock },
      request.sizeBytes,
      this.clock,
      batching.maxBatchBytes
    )
    if (full) {
      const ready = this.edgeBatches.take(edge.id, batch.id)
      if (ready) this.sendEdgeBatch(edge, ready)
      return
    }
    if (opened) {
      this.eventQueue.insert(
        createEvent(
          'edge-batch-flush',
          edge.source,
          '',
          { edge, edgeId: edge.id, batchId: batch.id },
          this.clock + batching.lingerUs
        )
      )
    }
  }

  private handleEdgeBatchFlush(event: SimulationEvent): void {
    const edge = event.data.edge as EdgeDefinition | undefined
    const batchId = event.data.batchId
    if (!edge || typeof batchId !== 'string') {
      return
    }
    const batch = this.edgeBatches.take(edge.id, batchId)
    if (!batch) {
      // Already sent because it filled up before linger expired.
      return
    }
    this.sendEdgeBatch(edge, batch)
  }

  /**
   * Send a closed batch as one produce request: one edge slot, one propagation
   * sample, one protocol overhead and the batch's total bytes on the link. Each
   * record's edge latency adds the time it waited in the batch.
   */
  private sendEdgeBatch(edge: EdgeDefinition, batch: OpenEdgeBatch<BatchedRecord>): void {
    const live = batch.records.filter(
      (record) => !this.terminalStatusByRequestId.has(record.request.id)
    )
    if (live.length === 0) {
      return
    }
    this.metrics.recordEdgeBatchSent(edge.id, this.clock, live.length, batch.bytes)
    const flowEmitter = (record: BatchedRecord) => {
      return (
        status: EdgeFlowStatus,
        completedAt: bigint,
        latencyUs: bigint,
        failureCause?: EdgeFailureCause
      ): void => {
        this.onEdgeFlowEvent?.({
          sequence: ++this.edgeFlowSequence,
          requestId: record.request.id,
          edgeId: edge.id,
          sourceNodeId: edge.source,
          targetNodeId: record.targetNodeId,
          startedAtMs: microToMs(record.enqueuedAtUs),
          completedAtMs: microToMs(completedAt),
          latencyMs: microToMs(latencyUs),
          status,
          failureCause,
          key: affinityKeyOf(record.request)
        })
      }
    }
    const rejectAll = (reason: 'connection_refused' | 'edge_error_rate'): void => {
      for (const record of live) {
        flowEmitter(record)('edge-error', this.clock, this.clock - record.enqueuedAtUs, reason)
        this.eventQueue.insert(
          createEvent(
            'request-rejected',
            record.targetNodeId,
            record.request.id,
            {
              request: record.request,
              edge,
              edgeId: edge.id,
              sourceNodeId: edge.source,
              targetNodeId: record.targetNodeId,
              edgeInTimeUs: record.enqueuedAtUs,
              reason,
              observationPoint: 'edge',
              edgeSlotHeld: false
            },
            this.clock
          )
        )
      }
    }

    // A batch is one in-flight produce request against the edge's cap
    // (Kafka max.in.flight.requests.per.connection).
    const currentLoad = this.activeTransfersByEdgeId.get(edge.id) ?? 0
    if (currentLoad >= edge.maxConcurrentRequests) {
      rejectAll('connection_refused')
      return
    }
    const lead = live[0].request
    const transit = this.sampleEdgeTransit(edge, lead, currentLoad + 1, batch.bytes)
    // Kafka runs over TCP, so a lost packet is retransmitted, never dropped.
    const retransmitted = this.distributions.random() < edge.packetLossRate
    if (this.distributions.random() < edge.errorRate) {
      rejectAll('edge_error_rate')
      return
    }
    const transitUs = retransmitted ? transit.transitUs * 2n : transit.transitUs
    const linkQueueUs = this.reserveEdgeLink(edge, transit.transmissionMs, retransmitted ? 2 : 1)
    const arrivalTime = this.clock + linkQueueUs + transitUs

    this.activeTransfersByEdgeId.set(edge.id, currentLoad + 1)
    this.batchRecordsInFlight.set(batch.id, live.length)
    for (const record of live) {
      const emit = flowEmitter(record)
      const batchWaitUs = this.clock - record.enqueuedAtUs
      if (record.request.deadline <= arrivalTime) {
        const timeoutAt =
          record.request.deadline > this.clock ? record.request.deadline : this.clock
        emit('timeout', timeoutAt, timeoutAt - record.enqueuedAtUs, 'deadline_exceeded')
        this.eventQueue.insert(
          createEvent(
            'request-timeout',
            record.targetNodeId,
            record.request.id,
            {
              request: record.request,
              edge,
              edgeId: edge.id,
              edgeBatchId: batch.id,
              sourceNodeId: edge.source,
              targetNodeId: record.targetNodeId,
              edgeInTimeUs: record.enqueuedAtUs,
              reason: 'deadline_exceeded',
              scope: 'in-flight',
              timeoutSeq: record.request.timeoutSeq ?? 0
            },
            timeoutAt
          )
        )
        continue
      }
      this.completeEdgeTransit(
        record.request,
        edge,
        record.targetNodeId,
        record.edgePhase,
        record.enqueuedAtUs,
        arrivalTime,
        {
          ...transit.components,
          linkQueueMs: microToMs(linkQueueUs),
          retransmissionMs: retransmitted ? microToMs(transit.transitUs) : 0,
          batchWaitMs: microToMs(batchWaitUs)
        },
        batch.id,
        emit
      )
    }
  }

  private runBeforeArrivalTraits(nodeId: string, request: Request): BeforeArrivalDecision {
    const node = this.nodeDefinitionsById.get(nodeId)
    if (!node) {
      return { action: 'continue' }
    }

    for (const trait of this.traitsByNodeId.get(nodeId) ?? []) {
      if (!trait.beforeArrival) {
        continue
      }

      const decision = trait.beforeArrival({
        node,
        request,
        clock: this.clock,
        random: () => this.distributions.random(),
        state: this.getTraitStateStore(nodeId),
        sharedState: this.getSharedTraitStateStore(),
        nodeState: this.nodes.get(nodeId)?.getState(),
        countInSystem: (predicate) => this.nodes.get(nodeId)?.countInSystem(predicate) ?? 0
      })
      this.recordTraitPayloadMetrics(nodeId, decision.payload)
      this.recordTraitDecision(nodeId, request, trait.name, 'beforeArrival', {
        decision: decision.action,
        ...(decision.action === 'handled' ? { latencyUs: decision.latencyUs.toString() } : {}),
        ...(decision.action === 'rejected' ? { reason: decision.reason } : {}),
        ...(decision.payload ?? {})
      })
      this.maybeScheduleStreamRetentionEvent(nodeId, decision.payload)

      if (decision.action !== 'continue') {
        this.lastDecidingArrivalTrait = trait.name
        return decision
      }
    }

    this.lastDecidingArrivalTrait = null
    return { action: 'continue' }
  }

  private maybeScheduleStreamRetentionEvent(
    nodeId: string,
    payload: Record<string, unknown> | undefined
  ): void {
    if (!payload || typeof payload.streamRetentionDeadlineMs !== 'number') {
      return
    }
    const deadlineUs = msToMicro(payload.streamRetentionDeadlineMs)
    if (deadlineUs <= this.simulationDurationUs) {
      this.eventQueue.insert(createEvent('stream-retention-expire', nodeId, '', {}, deadlineUs))
    }
  }

  private runBeforeRoutingTraits(nodeId: string, request: Request): BeforeRoutingDecision {
    const node = this.nodeDefinitionsById.get(nodeId)
    if (!node) {
      return { action: 'route' }
    }

    for (const trait of this.traitsByNodeId.get(nodeId) ?? []) {
      if (!trait.beforeRouting) {
        continue
      }

      const decision = trait.beforeRouting({
        node,
        request,
        clock: this.clock,
        random: () => this.distributions.random(),
        state: this.getTraitStateStore(nodeId),
        sharedState: this.getSharedTraitStateStore(),
        nodeState: this.nodes.get(nodeId)?.getState()
      })
      this.recordTraitPayloadMetrics(nodeId, decision.payload)
      this.recordTraitDecision(nodeId, request, trait.name, 'beforeRouting', {
        decision: decision.action,
        ...(decision.action === 'reroute' ? { targetNodeId: decision.targetNodeId } : {}),
        ...(decision.action === 'rejected' ? { reason: decision.reason } : {}),
        ...(decision.payload ?? {})
      })

      if (decision.action !== 'route') {
        return decision
      }
    }

    return { action: 'route' }
  }

  private recordTraitDecision(
    nodeId: string,
    request: Request,
    traitName: string,
    hook: TraitHookName,
    payload: Record<string, unknown>
  ): void {
    const priority =
      hook === 'beforeArrival'
        ? EventPriority.ARRIVAL
        : hook === 'filterRoutes'
          ? EventPriority.DEPARTURE
          : EventPriority.PROCESSING
    const semanticTransitions = this.recordTraitStateTransitions(request, nodeId, payload)
    if (this.tracer.shouldTrace(request.id)) {
      this.tracer.recordTraitDecision(request.id, {
        nodeId,
        atUs: this.clock,
        traitName,
        hook,
        decision: typeof payload.decision === 'string' ? payload.decision : 'unknown',
        reasonCode: typeof payload.reason === 'string' ? payload.reason : undefined,
        detail: scalarTraitDetail(payload)
      })
    }

    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'trait-evaluated',
      priority,
      requestId: request.id,
      nodeId,
      payload: {
        traitName,
        hook,
        ...payload,
        ...(semanticTransitions.length > 0 ? { semanticTransitions } : {})
      },
      nodeSnapshot: this.createNodeSnapshot(nodeId)
    })
  }

  /**
   * Any trait can report count-style metrics via payload.metricCounters —
   * this passes every numeric entry through generically so a new trait never
   * needs an engine-side change to show up in PerNodeMetrics.traitCounters.
   */
  private recordTraitPayloadMetrics(
    nodeId: string,
    payload: Record<string, unknown> | undefined
  ): void {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const metricCounters = payload['metricCounters']
    if (!metricCounters || typeof metricCounters !== 'object') {
      return
    }

    const counters: Record<string, number> = {}
    for (const [key, value] of Object.entries(metricCounters as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        counters[key] = Math.max(0, value)
      }
    }

    if (Object.keys(counters).length > 0) {
      this.metrics.recordNodeTraitCounters(nodeId, counters)
    }
  }
}
