import type { ComponentNode, EdgeDefinition, TopologyJSON, WorkloadProfile } from '../../core/types'

export function node(
  id: string,
  type: ComponentNode['type'],
  opts: {
    workers?: number
    capacity?: number
    serviceMs?: number
    config?: Record<string, unknown>
    category?: ComponentNode['category']
    role?: ComponentNode['role']
  } = {}
): ComponentNode {
  return {
    id,
    type,
    category: opts.category ?? 'compute',
    role: opts.role ?? 'processor',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: opts.workers ?? 8, capacity: opts.capacity ?? 64, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: opts.serviceMs ?? 5 }, timeout: 1_000 },
    // Databases take their service time from the storage profile, so pin it too.
    ...(opts.config || type === 'relational-db'
      ? {
          config: {
            ...(type === 'relational-db' ? { storageReadMs: opts.serviceMs ?? 5 } : {}),
            ...opts.config
          }
        }
      : {})
  }
}

export function source(id = 'client'): ComponentNode {
  return {
    id,
    type: 'api-endpoint',
    category: 'compute',
    role: 'source',
    label: id,
    position: { x: 0, y: 0 }
  }
}

export function edge(sourceId: string, target: string): EdgeDefinition {
  return {
    id: `${sourceId}-${target}`,
    source: sourceId,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 10_000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

export function topology(
  nodes: ComponentNode[],
  edges: EdgeDefinition[],
  workload: Partial<WorkloadProfile> & { baseRps: number }
): TopologyJSON {
  return {
    id: 'chaos-test',
    name: 'chaos-test',
    version: '1.0.0',
    global: {
      simulationDuration: 10_000,
      seed: 'chaos-seed',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000,
      traceSampleRate: 0
    },
    nodes,
    edges,
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 512 }],
      ...workload
    }
  }
}

/** client -> api -> db. */
export function apiDbTopology(opts: { baseRps?: number; dbWorkers?: number } = {}): TopologyJSON {
  return topology(
    [
      source(),
      node('api', 'microservice', { workers: 16, capacity: 128, serviceMs: 2 }),
      node('db', 'relational-db', {
        workers: opts.dbWorkers ?? 8,
        capacity: 64,
        serviceMs: 5,
        category: 'storage-and-data',
        role: 'storage'
      })
    ],
    [edge('client', 'api'), edge('api', 'db')],
    { baseRps: opts.baseRps ?? 100 }
  )
}

/** client -> api -> cache (declared 90% hit rate) -> db. */
export function cacheTopology(
  opts: {
    baseRps?: number
    dbWorkers?: number
    dbCapacity?: number
    cacheConfig?: Record<string, unknown>
  } = {}
): TopologyJSON {
  return topology(
    [
      source(),
      node('api', 'microservice', { workers: 32, capacity: 256, serviceMs: 1 }),
      node('cache', 'in-memory-cache', {
        workers: 32,
        capacity: 256,
        serviceMs: 0.5,
        category: 'storage-and-data',
        role: 'storage',
        config: opts.cacheConfig ?? { cacheHitRate: 0.9, cacheHitLatencyMs: 0.2 }
      }),
      node('db', 'relational-db', {
        workers: opts.dbWorkers ?? 2,
        capacity: opts.dbCapacity ?? 16,
        serviceMs: 10,
        category: 'storage-and-data',
        role: 'storage'
      })
    ],
    [edge('client', 'api'), edge('api', 'cache'), edge('cache', 'db')],
    { baseRps: opts.baseRps ?? 120 }
  )
}

/** client -> api -> lb -> {primary, replica}: a health-aware router in front of two databases. */
export function failoverTopology(opts: { withRouter?: boolean } = {}): TopologyJSON {
  const withRouter = opts.withRouter ?? true
  const db = (id: string, role: 'primary' | 'replica') =>
    node(id, 'relational-db', {
      workers: 8,
      capacity: 64,
      serviceMs: 5,
      category: 'storage-and-data',
      role: 'storage',
      config: { replicationRole: role }
    })
  return topology(
    [
      source(),
      node('api', 'microservice', { workers: 16, capacity: 128, serviceMs: 2 }),
      ...(withRouter
        ? [
            node('db-lb', 'load-balancer', {
              workers: 64,
              capacity: 512,
              serviceMs: 0.2,
              role: 'router'
            })
          ]
        : []),
      db('primary', 'primary'),
      db('replica', 'replica')
    ],
    withRouter
      ? [
          edge('client', 'api'),
          edge('api', 'db-lb'),
          edge('db-lb', 'primary'),
          edge('db-lb', 'replica')
        ]
      : [edge('client', 'api'), edge('api', 'primary'), edge('api', 'replica')],
    { baseRps: 100 }
  )
}
