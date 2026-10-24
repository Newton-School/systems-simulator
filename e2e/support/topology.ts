/**
 * Builders for the engine's TopologyJSON, so each flow states its inputs (rates, service times,
 * capacities) in one place and the expected numbers can be computed from the same inputs.
 */
import type { TopologyJSON } from '../../src/engine/core/types'

export type Pattern =
  | 'constant'
  | 'poisson'
  | 'bursty'
  | 'diurnal'
  | 'spike'
  | 'sawtooth'
  | 'replay'

export interface ServerSpec {
  id: string
  /** Mean service time in ms (constant). */
  serviceMs: number
  workers?: number
  /** Total system capacity K (servers plus waiting room). */
  capacity?: number
  timeoutMs?: number
  /** Extra node fields merged in (resilience, config, resources...). */
  extra?: Record<string, unknown>
}

export interface RunSpec {
  name: string
  rps: number
  pattern: Pattern
  durationMs: number
  warmupMs: number
  seed: string
  timeoutMs?: number
}

export function edge(source: string, target: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0,
    ...extra
  }
}

export function server(spec: ServerSpec) {
  return {
    id: spec.id,
    type: 'microservice',
    category: 'compute',
    label: spec.id,
    position: { x: 300, y: 0 },
    queue: {
      workers: spec.workers ?? 1,
      capacity: spec.capacity ?? 100_000,
      discipline: 'fifo'
    },
    processing: {
      distribution: { type: 'constant', value: spec.serviceMs },
      timeout: spec.timeoutMs ?? 60_000
    },
    ...spec.extra
  }
}

/** source -> srv chain: the single queue under test is the node `srv`. */
export function singleServer(run: RunSpec, srv: Omit<ServerSpec, 'id'>): TopologyJSON {
  return {
    id: 'e2e',
    name: run.name,
    version: '1.0.0',
    global: {
      simulationDuration: run.durationMs,
      seed: run.seed,
      warmupDuration: run.warmupMs,
      timeResolution: 'microsecond',
      defaultTimeout: run.timeoutMs ?? 60_000,
      traceSampleRate: 0
    },
    nodes: [
      {
        id: 'source',
        type: 'api-endpoint',
        category: 'compute',
        label: 'source',
        position: { x: 0, y: 0 },
        queue: { workers: 1, capacity: 100, discipline: 'fifo' },
        processing: { distribution: { type: 'constant', value: 0 }, timeout: 60_000 }
      },
      server({ id: 'srv', ...srv })
    ],
    edges: [edge('source', 'srv')],
    workload: {
      sourceNodeId: 'source',
      pattern: run.pattern,
      baseRps: run.rps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
}

export interface InstanceServerSpec {
  /** Service time distribution; mean is derived by the caller for the oracle. */
  service: { type: 'constant'; value: number } | { type: 'exponential'; lambda: number }
  timeoutMs?: number
  /** m5.large cpu-bound = exactly 2 servers, perf factor 1.0 (service time unchanged). */
  instanceType?: string
  instanceCount?: number
  /** K = floor(RAM / perRequestMemMb), never below c. m5.large has 8192 MB. */
  perRequestMemMb?: number
  extra?: Record<string, unknown>
}

/**
 * source -> srv where srv uses the instance model, which is how the UI treats every node.
 * Without `resources` the UI applies the component default (c5.large, io-bound) and silently
 * changes c and the service time, so theory-based flows always declare resources.
 * m5.large: 2 vCPU, 8 GB, perfFactor 1.0. cpu-bound: 1 worker per vCPU, so c = 2 x instanceCount.
 */
export function instanceServer(run: RunSpec, srv: InstanceServerSpec): TopologyJSON {
  const topology = singleServer(run, { serviceMs: 1, timeoutMs: srv.timeoutMs })
  const node = topology.nodes.find((n) => n.id === 'srv') as unknown as Record<string, unknown>
  delete node.queue
  node.processing = {
    distribution: srv.service,
    timeout: srv.timeoutMs ?? 60_000
  }
  node.resources = {
    instanceType: srv.instanceType ?? 'm5.large',
    instanceCount: srv.instanceCount ?? 1,
    workloadKind: 'cpu-bound',
    ...(srv.perRequestMemMb ? { perRequestMemMb: srv.perRequestMemMb } : {})
  }
  Object.assign(node, srv.extra ?? {})
  return topology
}

export interface ChainOptions {
  run: RunSpec
  /** Extra fields merged into the source node (for example resilience.retry or a circuit breaker). */
  source?: Record<string, unknown>
  /** Nodes after the source, wired in order unless `edges` is given. */
  nodes: Record<string, unknown>[]
  /** Edges as [from, to] or [from, to, fields]; fields override the edge defaults. */
  edges?: ([string, string] | [string, string, Record<string, unknown>])[]
  faults?: Record<string, unknown>[]
  requestDistribution?: Record<string, unknown>[]
}

/** Instance-model compute node: m5.* cpu-bound, constant service time. */
export function computeNode(
  id: string,
  opts: {
    serviceMs: number
    instanceType?: string
    timeoutMs?: number
    config?: Record<string, unknown>
    resilience?: Record<string, unknown>
    type?: string
  }
): Record<string, unknown> {
  return {
    id,
    type: opts.type ?? 'microservice',
    category: 'compute',
    label: id,
    position: { x: 300, y: 0 },
    processing: {
      distribution: { type: 'constant', value: opts.serviceMs },
      timeout: opts.timeoutMs ?? 60_000
    },
    resources: {
      instanceType: opts.instanceType ?? 'm5.large',
      instanceCount: 1,
      workloadKind: 'cpu-bound'
    },
    ...(opts.config ? { config: opts.config } : {}),
    ...(opts.resilience ? { resilience: opts.resilience } : {})
  }
}

/** A pass-through node (load balancer, rate limiter, gateway) with negligible service time. */
export function passNode(
  id: string,
  type: string,
  config?: Record<string, unknown>
): Record<string, unknown> {
  return {
    id,
    type,
    category: 'network',
    label: id,
    position: { x: 150, y: 0 },
    queue: { workers: 10_000, capacity: 1_000_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 0 }, timeout: 60_000 },
    ...(config ? { config } : {})
  }
}

export function chain(opts: ChainOptions): TopologyJSON {
  const base = singleServer(opts.run, { serviceMs: 1 })
  const source = (base.nodes as unknown as Record<string, unknown>[])[0]
  Object.assign(source, opts.source ?? {})
  const ids = ['source', ...opts.nodes.map((n) => n.id as string)]
  const edges: ([string, string] | [string, string, Record<string, unknown>])[] =
    opts.edges ?? ids.slice(0, -1).map((id, i) => [id, ids[i + 1]] as [string, string])
  return {
    ...base,
    nodes: [source, ...opts.nodes],
    edges: edges.map(([a, b, extra]) => edge(a, b, extra)),
    ...(opts.faults ? { faults: opts.faults } : {}),
    workload: {
      ...(base.workload as object),
      ...(opts.requestDistribution ? { requestDistribution: opts.requestDistribution } : {})
    }
  } as unknown as TopologyJSON
}
