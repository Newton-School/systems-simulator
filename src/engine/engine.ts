import {
  generateSimulationOutput,
  SimulationOutput,
  StatusWindow,
  TimeSeriesSnapshot
} from './analysis/output'
import { replayEventStream } from './analysis/replay'
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
import { microToMs, msToMicro, secToMicro } from './core/time'
import { ComponentNode, EdgeDefinition, EventScheduler, TopologyJSON } from './core/types'
import {
  getPathTypeLatencyProfile,
  getProtocolLatencyOverheadMs,
  isReliableProtocol,
  protocolSupportsConnectionLimits
} from './defaults/edgeDefaults'
import { MetricsCollector } from './metrics'
import { classifyRejectionCause } from './metrics/windowedLatencyAggregator'
import { GGcKNode } from './nodes/GGcKNode'
import {
  DEFAULT_CHAOS_FAILURE_SPEC,
  LEGACY_REJECT_FAILURE_SPEC,
  NodeFailureSpec,
  parseFailureSpec
} from './nodes/failure'
import { RoutingTable } from './routing'
import { MinHeap } from './scheduler/min-heap'
import { Distributions } from './stochastic/distribution'
import { createRandom } from './stochastic/random'
import { RequestTracer } from './tracer'
import {
  attachCircuitBreakerTracking,
  clearCircuitBreakerTracking,
  readCircuitBreakerConfig,
  readCircuitBreakerTracking,
  recordCircuitBreakerOutcome
} from './traits/circuitBreaker'
import {
  createInitialProbeState,
  evaluateProbe,
  parseHealthCheckManagerConfig,
  type HealthCheckManagerConfig,
  type ProbeState
} from './traits/healthProber'
import { resolveTraits } from './traits/resolveTraits'
import type {
  BeforeArrivalDecision,
  BeforeRoutingDecision,
  NodeBehaviourTrait,
  TraitHookName,
  TraitResolver,
  TraitStateStore
} from './traits/types'
import { WorkloadGenerator } from './workload'

interface SecurityPolicyConfig {
  blockRate: number
  droppedPackets: number
}

const DEFAULT_MAX_RETAINED_EVENT_STREAM_EVENTS = 25_000
const LOAD_BALANCER_UNHEALTHY_COOLDOWN_US = msToMicro(5_000)

interface SimulationEngineOptions {
  resolveTraits?: TraitResolver
  /**
   * When true, GGcKNode invariants (inSystem identity, K ceiling, heldBlackhole
   * disjointness) are asserted after every event. Off by default so production
   * runs pay nothing; scenario tests turn it on.
   */
  debugInvariants?: boolean
}

export class SimulationEngine {
  onProgress?: (percent: number, eventsProcessed: number) => void
  onSnapshot?: (snapshot: TimeSeriesSnapshot) => void
  onDebugEvent?: (event: DebugEvent) => void
  onAdmissionDecision?: (decision: AdmissionDecision) => void
  onEdgeFlowEvent?: (event: EdgeFlowEvent) => void

  private readonly eventQueue = new MinHeap<SimulationEvent>()
  private readonly eventRecorder = new EventStreamRecorder({
    maxRetainedEvents: DEFAULT_MAX_RETAINED_EVENT_STREAM_EVENTS,
    onRecord: (record) => this.handleRecordedCanonicalEvent(record)
  })
  private readonly distributions: Distributions
  private readonly routing: RoutingTable
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
  private readonly activeTransfersByEdgeId = new Map<string, number>()
  private readonly workload?: WorkloadGenerator

  private readonly requestById = new Map<string, Request>()
  private readonly terminalStatusByRequestId = new Map<string, TerminalRequestStatus>()
  /**
   * Complete, unsampled per-request outcome ledger, filled at the single
   * `markRequestTerminal` funnel. In-flight survivors are appended at cutoff in
   * {@link generateResults}, so every generated request is accounted for exactly once.
   */
  private readonly requestOutcomeById = new Map<string, RequestOutcomeRecord>()
  private readonly simulationDurationUs: bigint
  private readonly snapshotIntervalUs = secToMicro(1)

  private clock = 0n
  private lastSnapshotAt = -1n
  private eventsProcessed = 0
  private edgeFlowSequence = 0
  private forkCounter = 0
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
  }> = []
  private debugTarget: 'all' | string | null = null
  private forcedTraceRequestId: string | null = null
  private readonly debugEvents: DebugEvent[] = []

  constructor(
    private readonly topology: TopologyJSON,
    options: SimulationEngineOptions = {}
  ) {
    const rng = createRandom(topology.global.seed)
    const traitResolver = options.resolveTraits ?? resolveTraits
    this.debugInvariants = options.debugInvariants ?? false
    this.distributions = new Distributions(rng)
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
    this.simulationDurationUs = msToMicro(topology.global.simulationDuration)

    const scheduler: EventScheduler = {
      schedule: (event) => this.eventQueue.insert(event)
    }

    for (const node of topology.nodes) {
      const normalized = this.withNodeDefaults(node)
      this.nodeDefinitionsById.set(node.id, normalized)
      this.traitsByNodeId.set(node.id, traitResolver(normalized))
      this.nodes.set(node.id, new GGcKNode(normalized, this.distributions, scheduler))
      this.nodeLimitsById.set(node.id, {
        workers: normalized.queue?.workers ?? 1,
        capacity: normalized.queue?.capacity ?? 100
      })

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
    }

    if (topology.workload) {
      this.workload = new WorkloadGenerator(topology.workload, rng, scheduler, {
        defaultTimeoutMs: topology.global.defaultTimeout,
        simulationDurationMs: topology.global.simulationDuration
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
   */
  private scheduleConfiguredFaults(scheduler: EventScheduler): void {
    for (const fault of this.topology.faults ?? []) {
      if (!this.nodes.has(fault.targetId)) {
        continue
      }
      const params = (fault.params ?? {}) as Record<string, unknown>
      const atMs = typeof params.atMs === 'number' && params.atMs >= 0 ? params.atMs : 0
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
    if (count <= 0) {
      return
    }
    const wasPaused = this.paused
    this.running = true
    this.paused = false
    this.processEvents(count)
    this.paused = wasPaused
  }

  hasPendingEvents(): boolean {
    if (this.clock >= this.simulationDurationUs) {
      return false
    }
    const nextEvent = this.eventQueue.peek()
    return nextEvent !== undefined && nextEvent.timestamp <= this.simulationDurationUs
  }

  getResults(): SimulationOutput {
    return this.generateResults()
  }

  captureSnapshot(): TimeSeriesSnapshot {
    const snapshot = this.takeSnapshot()
    this.timeSeries.push(snapshot)
    return snapshot
  }

  getEventsProcessed(): number {
    return this.eventsProcessed
  }

  getEventStream(): CanonicalEventRecord[] {
    return this.eventRecorder.getEvents()
  }

  getEventCountsByType(): EventCountsByType {
    return this.eventRecorder.getCountsByType()
  }

  private recordCanonicalEvent(input: AppendEventInput): CanonicalEventRecord {
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

  private processEvents(maxEvents?: number): void {
    let processedInCall = 0

    while (this.running && !this.paused && !this.eventQueue.isEmpty) {
      if (maxEvents !== undefined && processedInCall >= maxEvents) {
        break
      }

      const nextEvent = this.eventQueue.peek()
      if (!nextEvent) {
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

    const sourceNodeId = event.nodeId
    const routeResult = this.resolveRoutes(sourceNodeId, request)
    if (routeResult.rejectionReason) {
      this.rejectRequestAtNode(sourceNodeId, request, routeResult.rejectionReason, this.clock)
      return
    }

    const routes = routeResult.routes
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
    this.releaseEdgeTransfer(event.data.edgeId)
    this.appendNodeToPath(request, event.nodeId)
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.metrics.recordNodeArrival(event.nodeId, this.clock)
    this.recordNodePhaseArrival(request, event.nodeId, this.clock)

    if (this.applySecurityPolicy(event.nodeId, request)) {
      return
    }

    const arrivalTraitDecision = this.runBeforeArrivalTraits(event.nodeId, request)
    if (arrivalTraitDecision.action === 'rejected') {
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          event.nodeId,
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

    if (arrivalTraitDecision.action === 'handled') {
      this.completeRequestViaTrait(event.nodeId, request, arrivalTraitDecision)

      if (arrivalTraitDecision.payload?.forkConsumerRequest === true) {
        this.forkConsumerRequest(node, event.nodeId, request)
      }
      return
    }

    this.admitToNodeQueue(node, event.nodeId, request)
  }

  private completeRequestViaTrait(
    nodeId: string,
    request: Request,
    decision: Extract<BeforeArrivalDecision, { action: 'handled' }>
  ): void {
    const completionTime = this.clock + decision.latencyUs
    this.markNodePhaseServiceStart(request, nodeId, this.clock)
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
    request.spans.push({
      nodeId,
      arrivalTime: this.clock,
      queueWait: 0n,
      serviceTime: decision.latencyUs,
      departureTime: completionTime
    })
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
   * Spawns an independent lifecycle for a request that a trait acknowledged
   * immediately (e.g. AckAndReleaseTrait) — the clone enters the node's real
   * queue directly, bypassing beforeArrival traits so the ack doesn't
   * re-trigger itself in an infinite fork loop.
   */
  private forkConsumerRequest(node: GGcKNode, nodeId: string, producerRequest: Request): void {
    const consumerRequest = this.cloneRequestForBranch(producerRequest)
    this.requestById.set(consumerRequest.id, consumerRequest)
    this.tracer.setRequestCreatedAt(consumerRequest.id, consumerRequest.createdAt)
    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'request-generated',
      priority: EventPriority.ARRIVAL,
      requestId: consumerRequest.id,
      nodeId,
      payload: { request: consumerRequest, branchOfRequestId: producerRequest.id }
    })
    this.appendNodeToPath(consumerRequest, nodeId)
    this.metrics.recordNodeArrival(nodeId, this.clock)
    this.recordNodePhaseArrival(consumerRequest, nodeId, this.clock)
    this.admitToNodeQueue(node, nodeId, consumerRequest)
  }

  private admitToNodeQueue(node: GGcKNode, nodeId: string, request: Request): void {
    const result = node.handleArrival(request, this.clock)
    const nodeSnapshot = this.createNodeSnapshot(nodeId)
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

    const routes = routeResult.routes
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
    const observationPoint = scope === 'in-flight' ? 'edge' : 'node'
    if (scope === 'in-flight') {
      this.releaseEdgeTransfer(event.data.edgeId)
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
    if (observationPoint === 'node') {
      this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, false)
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
    this.releaseEdgeTransfer(event.data.edgeId)
    if (observationPoint === 'node') {
      this.markNodeUnhealthyForReason(event.nodeId, reason)
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    if (observationPoint === 'node') {
      this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, false)
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
    this.markRequestTerminal(request, 'rejected')
  }

  private handleNodeFailure(event: SimulationEvent): void {
    const spec = this.resolveFailureSpec(event, event.nodeId)
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
        endUs: null
      })
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
  }

  private handleNodeRecovery(event: SimulationEvent): void {
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
  }

  /** Finalize failure intervals (ms): windows still open at cutoff close at the run horizon. */
  private buildStatusTimeline(): StatusWindow[] {
    return this.statusWindows.map((w) => ({
      componentId: w.componentId,
      mode: w.mode,
      startMs: microToMs(w.startUs),
      endMs: microToMs(w.endUs ?? this.simulationDurationUs)
    }))
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
    this.markRequestTerminal(request, 'connection_reset')
  }

  private assertAllNodeInvariants(): void {
    for (const node of this.nodes.values()) {
      node.debugAssertInvariants()
    }
  }

  private sampleEdgeLatencyUs(
    edge: EdgeDefinition,
    request: Request,
    activeTransfers: number
  ): bigint {
    const latencyDistribution = edge.latency.derivedFromPathType
      ? getPathTypeLatencyProfile(edge.latency.pathType)
      : edge.latency.distribution
    const propagationMs = Math.max(0, this.distributions.fromConfig(latencyDistribution))
    const transmissionMs = request.sizeBytes / (edge.bandwidth * 125)
    // Streaming links reuse an already-open channel, so only a small framing
    // cost remains on each message instead of the full per-request setup cost.
    const protocolOverheadMs =
      getProtocolLatencyOverheadMs(edge.protocol) * (edge.mode === 'streaming' ? 0.25 : 1)
    const utilization =
      edge.maxConcurrentRequests > 0
        ? Math.min(0.98, activeTransfers / edge.maxConcurrentRequests)
        : 0
    const delayMultiplier = Math.min(50, 1 / Math.max(0.02, 1 - utilization))
    const totalLatencyMs =
      Math.max(0, propagationMs * delayMultiplier) + transmissionMs + protocolOverheadMs
    return msToMicro(totalLatencyMs)
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
        this.terminalStatusByRequestId.set(
          fromEvent.id,
          fromEvent.metadata.__terminal as TerminalRequestStatus
        )
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
      metadata: { ...request.metadata }
    }
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

  private markRequestTerminal(request: Request, status: TerminalRequestStatus): void {
    request.metadata.__terminal = status
    this.terminalStatusByRequestId.set(request.id, status)
    // First terminal wins: races are already tombstoned upstream, but guard so a
    // stray second transition can never double-count a request in the ledger.
    if (!this.requestOutcomeById.has(request.id)) {
      const createdAtMs = microToMs(request.createdAt)
      const terminalAtMs = microToMs(this.clock)
      this.requestOutcomeById.set(request.id, {
        requestId: request.id,
        status,
        createdAtMs,
        terminalAtMs,
        nodeId: request.path.length > 0 ? request.path[request.path.length - 1] : null,
        attempts: (request.retryCount ?? 0) + 1,
        latencyMs: Math.max(0, terminalAtMs - createdAtMs)
      })
    }
    this.requestById.delete(request.id)
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
      if (this.requestOutcomeById.has(request.id)) {
        continue
      }
      this.requestOutcomeById.set(request.id, {
        requestId: request.id,
        status: 'in-flight',
        createdAtMs: microToMs(request.createdAt),
        terminalAtMs: null,
        nodeId: request.path.length > 0 ? request.path[request.path.length - 1] : null,
        attempts: (request.retryCount ?? 0) + 1,
        latencyMs: null
      })
    }

    return [...this.requestOutcomeById.values()].sort((a, b) => {
      const aKey = a.terminalAtMs ?? Number.POSITIVE_INFINITY
      const bKey = b.terminalAtMs ?? Number.POSITIVE_INFINITY
      if (aKey !== bKey) return aKey - bKey
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs
      return a.requestId.localeCompare(b.requestId)
    })
  }

  private takeSnapshot(): TimeSeriesSnapshot {
    this.lastSnapshotAt = this.clock
    const nodes: TimeSeriesSnapshot['node'] = {}

    for (const [nodeId, node] of this.nodes) {
      const state = node.getState()
      this.metrics.recordNodeSnapshot(nodeId, state, this.clock)
      nodes[nodeId] = {
        queueLength: state.queueLength,
        activeWorkers: state.activeWorkers,
        totalInSystem: state.totalInSystem,
        utilization: state.utilization,
        status: state.status
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
    const horizonUs =
      this.clock < this.simulationDurationUs ? this.simulationDurationUs : this.clock
    for (const [nodeId, node] of this.nodes) {
      node.finalizeUtilization(horizonUs)
      const workers = this.nodeLimitsById.get(nodeId)?.workers ?? 1
      this.metrics.recordNodeBusyTime(nodeId, node.getBusyAreaUs(), workers)
    }

    const eventStream = this.getEventStream()
    const eventCountsByType = this.getEventCountsByType()
    const eventLog = this.debugTarget ? [...this.debugEvents] : null
    const debuggedLifecycle =
      this.debugTarget && this.debugTarget !== 'all'
        ? this.buildDebuggedLifecycle(this.debugTarget, eventStream)
        : null

    return generateSimulationOutput(
      this.metrics,
      this.tracer,
      this.timeSeries,
      null,
      [],
      this.topology.global,
      this.eventsProcessed,
      eventStream,
      eventCountsByType,
      {
        eventLog,
        debuggedLifecycle,
        statusTimeline: this.buildStatusTimeline(),
        requestOutcomes: this.buildRequestOutcomes()
      }
    )
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
      onTraitDecision: (decision) => {
        this.recordTraitPayloadMetrics(decision.nodeId, decision.payload)
        this.recordTraitDecision(decision.nodeId, request.id, decision.traitName, decision.hook, {
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
    if (reason === 'node_failed' || reason === 'capacity_exceeded') {
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
        startedAtMs: microToMs(this.clock),
        completedAtMs: microToMs(completedAt),
        latencyMs: microToMs(latencyUs),
        status,
        failureCause
      })
    }

    const currentLoad = this.activeTransfersByEdgeId.get(edge.id) ?? 0
    if (
      protocolSupportsConnectionLimits(edge.protocol) &&
      currentLoad >= edge.maxConcurrentRequests
    ) {
      emitEdgeFlowEvent('edge-error', this.clock, 0n, 'connection_refused')
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
            edgeInTimeUs: this.clock,
            reason: 'connection_refused',
            observationPoint: 'edge'
          },
          this.clock
        )
      )
      return
    }

    let edgeLatencyUs = this.sampleEdgeLatencyUs(edge, request, currentLoad + 1)
    if (this.distributions.random() < edge.packetLossRate) {
      if (isReliableProtocol(edge.protocol)) {
        edgeLatencyUs += edgeLatencyUs
      } else {
        const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
        emitEdgeFlowEvent('packet-loss', timeoutAt, timeoutAt - this.clock, 'packet_loss')
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
              edgeInTimeUs: this.clock,
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
      emitEdgeFlowEvent('edge-error', this.clock, 0n, 'edge_error_rate')
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
            edgeInTimeUs: this.clock,
            reason: 'edge_error_rate',
            observationPoint: 'edge'
          },
          this.clock
        )
      )
      return
    }

    this.activeTransfersByEdgeId.set(edge.id, currentLoad + 1)
    const arrivalTime = this.clock + edgeLatencyUs
    if (request.deadline <= arrivalTime) {
      const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
      emitEdgeFlowEvent('timeout', timeoutAt, timeoutAt - this.clock, 'deadline_exceeded')
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
            edgeInTimeUs: this.clock,
            reason: 'deadline_exceeded',
            scope: 'in-flight',
            timeoutSeq: request.timeoutSeq ?? 0
          },
          timeoutAt
        )
      )
      return
    }

    emitEdgeFlowEvent('success', arrivalTime, edgeLatencyUs)
    // Record the completed hop so the phase timeline can attribute this transit
    // latency to the edge (rather than blaming the downstream node).
    edgePhase.edgeOutUs = arrivalTime
    ;(request.hops ??= []).push({
      edgeId: edge.id,
      source: edge.source,
      target: targetNodeId,
      edgeInUs: this.clock,
      edgeOutUs: arrivalTime
    })
    this.metrics.recordEdgeTransit(edge.id, edge.source, targetNodeId, edgeLatencyUs, arrivalTime)
    this.eventQueue.insert(
      createEvent(
        'request-arrival',
        targetNodeId,
        request.id,
        { request, edge, edgeId: edge.id, sourceNodeId: edge.source },
        arrivalTime
      )
    )
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
        nodeState: this.nodes.get(nodeId)?.getState()
      })
      this.recordTraitPayloadMetrics(nodeId, decision.payload)
      this.recordTraitDecision(nodeId, request.id, trait.name, 'beforeArrival', {
        decision: decision.action,
        ...(decision.action === 'handled' ? { latencyUs: decision.latencyUs.toString() } : {}),
        ...(decision.action === 'rejected' ? { reason: decision.reason } : {}),
        ...(decision.payload ?? {})
      })

      if (decision.action !== 'continue') {
        return decision
      }
    }

    return { action: 'continue' }
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
        nodeState: this.nodes.get(nodeId)?.getState()
      })
      this.recordTraitPayloadMetrics(nodeId, decision.payload)
      this.recordTraitDecision(nodeId, request.id, trait.name, 'beforeRouting', {
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
    requestId: string,
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

    this.recordCanonicalEvent({
      timestampUs: this.clock,
      type: 'trait-evaluated',
      priority,
      requestId,
      nodeId,
      payload: {
        traitName,
        hook,
        ...payload
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
