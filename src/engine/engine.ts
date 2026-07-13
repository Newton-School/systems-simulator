import { generateSimulationOutput, SimulationOutput, TimeSeriesSnapshot } from './analysis/output'
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
  TerminalRequestStatus,
  eventInputFromSimulationEvent,
  projectToDebugEvent
} from './core/event-stream'
import {
  EventPriority,
  createEvent,
  type EdgeFlowEvent,
  type EdgeFlowStatus,
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
import { GGcKNode } from './nodes/GGcKNode'
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
  private readonly simulationDurationUs: bigint
  private readonly snapshotIntervalUs = secToMicro(1)

  private clock = 0n
  private lastSnapshotAt = -1n
  private eventsProcessed = 0
  private edgeFlowSequence = 0
  private forkCounter = 0
  private running = false
  private paused = false
  private readonly timeSeries: TimeSeriesSnapshot[] = []
  private debugTarget: 'all' | string | null = null
  private forcedTraceRequestId: string | null = null
  private readonly debugEvents: DebugEvent[] = []

  constructor(
    private readonly topology: TopologyJSON,
    options: SimulationEngineOptions = {}
  ) {
    const rng = createRandom(topology.global.seed)
    const traitResolver = options.resolveTraits ?? resolveTraits
    this.distributions = new Distributions(rng)
    this.routing = new RoutingTable(topology.edges, rng, topology.nodes, traitResolver)
    this.metrics = new MetricsCollector({
      warmupDuration: topology.global.warmupDuration,
      nodes: topology.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        slo: node.slo
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
        this.nodes.get(event.nodeId)?.fail(this.clock)
        this.nodeUnhealthyUntilUs.set(
          event.nodeId,
          this.clock + LOAD_BALANCER_UNHEALTHY_COOLDOWN_US
        )
        this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
        break
      case 'node-recovery':
        this.nodes.get(event.nodeId)?.recover(this.clock)
        this.nodeUnhealthyUntilUs.delete(event.nodeId)
        this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
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
    if (request.deadline <= completionTime) {
      this.eventQueue.insert(
        createEvent(
          'request-timeout',
          nodeId,
          request.id,
          { request, nodeArrivalTime: this.clock, scope: 'trait' },
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

    const completion = node.handleCompletion(request, this.clock)
    if (completion.completedSpan) {
      request.spans.push(completion.completedSpan)
    }
    if (!completion.completedSpan) {
      return
    }
    const nodeSnapshot = this.createNodeSnapshot(event.nodeId)
    this.recordSimulationEvent(event, nodeSnapshot)

    if (completion.nextRequest) {
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
    this.metrics.recordRequest({
      id: request.id,
      status: 'success',
      totalLatency,
      path: request.path,
      spans: request.spans,
      createdAt: request.createdAt,
      completedAt: this.clock
    })

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.markStatus(request.id, 'success')
    this.markRequestTerminal(request, 'success')
  }

  private handleRequestTimeout(event: SimulationEvent): void {
    const request = this.getRequest(event, false)
    if (!request) {
      return
    }

    const scope = typeof event.data.scope === 'string' ? event.data.scope : undefined
    if (scope === 'in-flight') {
      this.releaseEdgeTransfer(event.data.edgeId)
    }
    if (scope === 'node') {
      const arrivalTime = this.nodes.get(event.nodeId)?.cancelRequest(request.id, this.clock)
      if (arrivalTime === null || arrivalTime === undefined) {
        return
      }
      event.data.nodeArrivalTime = arrivalTime
      this.markNodeTemporarilyUnhealthy(event.nodeId)
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, false)

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.markStatus(request.id, 'timeout')
    this.markRequestTerminal(request, 'timeout')

    const nodeArrivalTime =
      typeof event.data.nodeArrivalTime === 'bigint' ? event.data.nodeArrivalTime : undefined
    this.metrics.recordTimeout(event.requestId, event.nodeId, {
      requestCreatedAt: request.createdAt,
      nodeArrivalTime
    })
  }

  private handleRequestRejected(event: SimulationEvent): void {
    const reason = (event.data.reason as string | undefined) ?? 'rejected'
    const request = this.getRequest(event, false)
    if (!request) {
      return
    }
    this.releaseEdgeTransfer(event.data.edgeId)
    this.markNodeUnhealthyForReason(event.nodeId, reason)
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
    this.maybeRecordCircuitBreakerOutcome(request, event.nodeId, false)

    const nodeArrivalTime =
      typeof event.data.nodeArrivalTime === 'bigint' ? event.data.nodeArrivalTime : undefined
    this.metrics.recordRejection(event.nodeId, reason, {
      requestCreatedAt: request.createdAt,
      nodeArrivalTime
    })

    for (const span of request.spans) {
      this.tracer.recordSpan(request.id, span)
    }
    this.tracer.markStatus(request.id, 'rejected')
    this.markRequestTerminal(request, 'rejected')
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
    const protocolOverheadMs = getProtocolLatencyOverheadMs(edge.protocol)
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
      metadata: { ...request.metadata }
    }
  }

  private appendNodeToPath(request: Request, nodeId: string): void {
    request.path.push(nodeId)
  }

  private markRequestTerminal(request: Request, status: TerminalRequestStatus): void {
    request.metadata.__terminal = status
    this.terminalStatusByRequestId.set(request.id, status)
    this.requestById.delete(request.id)
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
        debuggedLifecycle
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
          { request, nodeArrivalTime: this.clock },
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
        { request, nodeArrivalTime: this.clock, scope: 'node' },
        effectiveTimeoutAt
      )
    )
  }

  private enqueueEdgeTransfer(request: Request, edge: EdgeDefinition, targetNodeId: string): void {
    const emitEdgeFlowEvent = (
      status: EdgeFlowStatus,
      completedAt: bigint,
      latencyUs: bigint
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
        status
      })
    }

    const currentLoad = this.activeTransfersByEdgeId.get(edge.id) ?? 0
    if (
      protocolSupportsConnectionLimits(edge.protocol) &&
      currentLoad >= edge.maxConcurrentRequests
    ) {
      emitEdgeFlowEvent('edge-error', this.clock, 0n)
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
            reason: 'connection_refused',
            nodeArrivalTime: this.clock
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
        emitEdgeFlowEvent('packet-loss', timeoutAt, timeoutAt - this.clock)
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
              nodeArrivalTime: this.clock,
              scope: 'in-flight'
            },
            timeoutAt
          )
        )
        return
      }
    }

    if (this.distributions.random() < edge.errorRate) {
      emitEdgeFlowEvent('edge-error', this.clock, 0n)
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
            reason: 'edge_error_rate',
            nodeArrivalTime: this.clock
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
      emitEdgeFlowEvent('timeout', timeoutAt, timeoutAt - this.clock)
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
            nodeArrivalTime: this.clock,
            scope: 'in-flight'
          },
          timeoutAt
        )
      )
      return
    }

    emitEdgeFlowEvent('success', arrivalTime, edgeLatencyUs)
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
