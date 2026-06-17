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
  eventInputFromSimulationEvent
} from './core/event-stream'
import { EventPriority, createEvent, Request, SimulationEvent } from './core/events'
import { microToMs, msToMicro, secToMicro } from './core/time'
import { ComponentNode, EdgeDefinition, EventScheduler, TopologyJSON } from './core/types'
import { MetricsCollector } from './metrics'
import { GGcKNode } from './nodes/GGcKNode'
import { RoutingTable } from './routing'
import { MinHeap } from './scheduler/min-heap'
import { Distributions } from './stochastic/distribution'
import { createRandom } from './stochastic/random'
import { RequestTracer } from './tracer'
import { WorkloadGenerator } from './workload'

interface SecurityPolicyConfig {
  blockRate: number
  droppedPackets: number
}

export class SimulationEngine {
  onProgress?: (percent: number, eventsProcessed: number) => void
  onSnapshot?: (snapshot: TimeSeriesSnapshot) => void
  onDebugEvent?: (event: DebugEvent) => void
  onAdmissionDecision?: (decision: AdmissionDecision) => void

  private readonly eventQueue = new MinHeap<SimulationEvent>()
  private readonly eventRecorder = new EventStreamRecorder({
    onRecord: (_record, debugEvent) => this.handleRecordedDebugEvent(debugEvent)
  })
  private readonly distributions: Distributions
  private readonly routing: RoutingTable
  private readonly metrics: MetricsCollector
  private readonly tracer: RequestTracer
  private readonly nodes = new Map<string, GGcKNode>()
  private readonly nodeErrorRateById = new Map<string, number>()
  private readonly nodeTimeoutUsById = new Map<string, bigint>()
  private readonly securityPolicyByNodeId = new Map<string, SecurityPolicyConfig>()
  private readonly nodeLimitsById = new Map<string, { workers: number; capacity: number }>()
  private readonly workload?: WorkloadGenerator

  private readonly requestById = new Map<string, Request>()
  private readonly terminalStatusByRequestId = new Map<string, TerminalRequestStatus>()
  private readonly simulationDurationUs: bigint
  private readonly snapshotIntervalUs = secToMicro(1)

  private clock = 0n
  private lastSnapshotAt = -1n
  private eventsProcessed = 0
  private forkCounter = 0
  private running = false
  private paused = false
  private readonly timeSeries: TimeSeriesSnapshot[] = []
  private debugTarget: 'all' | string | null = null
  private forcedTraceRequestId: string | null = null
  private readonly debugEvents: DebugEvent[] = []

  constructor(private readonly topology: TopologyJSON) {
    const rng = createRandom(topology.global.seed)
    this.distributions = new Distributions(rng)
    this.routing = new RoutingTable(topology.edges, rng, topology.nodes)
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
        this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
        break
      case 'node-recovery':
        this.nodes.get(event.nodeId)?.recover(this.clock)
        this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))
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
    const routes = this.routing.resolveTarget(sourceNodeId, request)
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
    this.appendNodeToPath(request, event.nodeId)
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))

    if (this.applySecurityPolicy(event.nodeId, request)) {
      return
    }

    const result = node.handleArrival(request, this.clock)
    const nodeSnapshot = this.createNodeSnapshot(event.nodeId)
    if (result.status === 'rejected') {
      this.emitAdmissionDecision(request.id, event.nodeId, 'rejected', result.reason, nodeSnapshot)
      this.eventQueue.insert(
        createEvent(
          'request-rejected',
          event.nodeId,
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
        nodeId: event.nodeId,
        payload: { request },
        nodeSnapshot
      })
      this.emitAdmissionDecision(
        request.id,
        event.nodeId,
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
        nodeId: event.nodeId,
        payload: { request },
        nodeSnapshot
      })
      this.emitAdmissionDecision(
        request.id,
        event.nodeId,
        'accepted',
        undefined,
        nodeSnapshot,
        record.sequence
      )
    }

    this.scheduleNodeTimeout(event.nodeId, request)
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

    const routes = this.routing.resolveTarget(event.nodeId, request)
    if (routes.length === 0) {
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
    if (scope === 'node') {
      const arrivalTime = this.nodes.get(event.nodeId)?.cancelRequest(request.id, this.clock)
      if (arrivalTime === null || arrivalTime === undefined) {
        return
      }
      event.data.nodeArrivalTime = arrivalTime
    }
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))

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
    this.recordSimulationEvent(event, this.createNodeSnapshot(event.nodeId))

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

  private sampleEdgeLatencyUs(edge: EdgeDefinition): bigint {
    const latencyMs = Math.max(0, this.distributions.fromConfig(edge.latency.distribution))
    return msToMicro(latencyMs)
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

  private handleRecordedDebugEvent(debugEvent: DebugEvent): void {
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
    return replayEventStream(eventStream.filter((event) => event.requestId === requestId))
      .lifecycleByRequestId[requestId] ?? null
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
    if (this.distributions.random() < edge.packetLossRate) {
      const timeoutAt = request.deadline > this.clock ? request.deadline : this.clock
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

    if (this.distributions.random() < edge.errorRate) {
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

    const arrivalTime = this.clock + this.sampleEdgeLatencyUs(edge)
    if (request.deadline <= arrivalTime) {
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
          request.deadline
        )
      )
      return
    }

    this.eventQueue.insert(
      createEvent(
        'request-arrival',
        targetNodeId,
        request.id,
        { request, edge, sourceNodeId: edge.source },
        arrivalTime
      )
    )
  }
}
