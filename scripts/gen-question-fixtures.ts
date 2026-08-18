/**
 * Generates the per-question trio (question.json + reference-topology.json +
 * gamed-topology.json + answers.json [+ gamed-answers.json] + README.md) for the
 * system-design-simulator-questions project, one directory per question.
 *
 * Topologies are built from shared helpers so worker/latency sizing is tunable
 * in one place. Run scripts/validate-question-dir.ts afterwards to confirm each
 * reference PASSES and each gamed FAILS on the intended axis.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ComponentCategory,
  ComponentType,
  TopologyJSON,
  WorkloadKind
} from '../src/engine/core/types'
import type { InstanceType } from '../src/engine/catalog/instanceCatalog'
import { buildReproducingResources } from '../src/engine/catalog/resourceDefaults'

// Self-contained: each question's package now lives in its own directory. The
// builders only patch it idempotently, so re-running regenerates topologies in
// place without a separate flat source library.
const ROOT =
  '/Users/hritvikmohan/Desktop/HM25/ns-simulator-prod/system-design-simulator-questions/questions'
const questionSource = (id: string) => join(ROOT, id, 'question.json')

// ── type → category ──────────────────────────────────────────────────────────
const CATEGORY: Record<string, ComponentCategory> = {
  'api-endpoint': 'compute',
  'load-balancer': 'network-and-edge',
  cdn: 'network-and-edge',
  microservice: 'compute',
  'batch-worker': 'compute',
  'in-memory-cache': 'storage-and-data',
  'kv-store': 'storage-and-data',
  'nosql-db': 'storage-and-data',
  'relational-db': 'storage-and-data',
  'time-series-db': 'storage-and-data',
  'search-index': 'storage-and-data',
  'object-storage': 'storage-and-data',
  queue: 'messaging-and-streaming',
  'message-broker': 'messaging-and-streaming',
  'event-sourcing-store': 'messaging-and-streaming',
  'distributed-lock': 'consensus-and-coordination',
  'rate-limiter': 'auxiliary',
  'idempotency-manager': 'auxiliary'
}

let py = 0
interface NodeOpts {
  workers?: number
  proc?: number
  cap?: number
  config?: Record<string, unknown>
  label?: string
  /** Override the resolved instance type (e.g. a deliberately-small bottleneck). */
  instanceType?: InstanceType
  /** Override workloadKind — cpu-bound gives ~1 worker/vCPU (a tight bottleneck). */
  workloadKind?: WorkloadKind
}
function node(id: string, type: ComponentType, o: NodeOpts = {}) {
  const { workers = 50, proc = 1, cap = 100000, config, label } = o
  py += 90
  // Concurrency is derived from the instance now (workers/cap here only seed the
  // read-only queue). Override instance type / workload to size a node deliberately.
  const resources = buildReproducingResources(type, workers, cap)
  if (o.instanceType) resources.instanceType = o.instanceType
  if (o.workloadKind) resources.workloadKind = o.workloadKind
  return {
    id,
    type,
    category: CATEGORY[type] ?? 'auxiliary',
    label: label ?? id,
    position: { x: 0, y: py },
    queue: { workers, capacity: cap, discipline: 'fifo' as const },
    resources,
    processing: { distribution: { type: 'constant' as const, value: proc }, timeout: 5000 },
    ...(config ? { config } : {})
  }
}

type Mode = 'synchronous' | 'asynchronous' | 'streaming' | 'conditional'
interface EdgeOpts {
  mode?: Mode
  protocol?: string
  cond?: string
  ms?: number
}
function edge(source: string, target: string, o: EdgeOpts = {}) {
  const { mode = 'synchronous', protocol = 'tcp', cond, ms = 0.5 } = o
  return {
    id: `e-${source}-${target}`,
    source,
    target,
    mode: cond ? ('conditional' as Mode) : mode,
    ...(cond ? { condition: cond } : {}),
    protocol,
    latency: {
      distribution: { type: 'constant' as const, value: ms },
      pathType: 'same-dc' as const
    },
    // Realistic-but-non-binding edge sizing (V1: nodes are the sole bottleneck).
    // 1 Gbps far exceeds payload throughput (~rps × payload, capped by the source),
    // and 50k concurrency stays above the saturated worst case (~rps × timeout), so an
    // edge never binds and never produces false rejections that would corrupt the
    // node-saturation lesson. Avoids the absurd 1 Tbps / 200k defaults.
    bandwidth: 1_000, // Mbps (1 Gbps)
    maxConcurrentRequests: 50_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

const READ = 'request.type === "read"'
const WRITE = 'request.type === "write"'

function topo(
  id: string,
  name: string,
  nodes: ReturnType<typeof node>[],
  edges: ReturnType<typeof edge>[],
  entryNodeId: string,
  baseRps: number,
  dist?: Array<{ type: string; weight: number; sizeBytes: number }>
): TopologyJSON {
  py = 0
  // Every topology is driven by an explicit Client (api-endpoint, source profile)
  // that feeds the entry node. Load balancers are NOT valid workload sources - the
  // UI now forbids selecting them - so traffic always originates from the client.
  const client = node('client', 'api-endpoint', { workers: 500, proc: 0.1, label: 'Client' })
  return {
    id,
    name,
    version: '1.0.0',
    global: {
      simulationDuration: 30000,
      warmupDuration: 5000,
      seed: id,
      timeResolution: 'millisecond',
      defaultTimeout: 5000
    },
    nodes: [client, ...nodes],
    edges: [edge('client', entryNodeId), ...edges],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps,
      // The validator requires a distribution; untyped questions get a single class.
      requestDistribution: dist ?? [{ type: 'read', weight: 1.0, sizeBytes: 256 }]
    }
  } as unknown as TopologyJSON
}

const RW = (r: number, w: number) => [
  { type: 'read', weight: r, sizeBytes: 256 },
  { type: 'write', weight: w, sizeBytes: 512 }
]
const WONLY = [{ type: 'write', weight: 1.0, sizeBytes: 512 }]

// A fast read cache: absorbs 90% of reads so the backing store stays unsaturated.
const CACHE = (id: string) =>
  node(id, 'in-memory-cache', {
    workers: 1000,
    proc: 1,
    config: { cacheHitRate: 0.9, cacheHitLatencyMs: 1 }
  })
// A deliberately small store: a 2-vCPU cpu-bound instance derives ~2 parallel
// servers, so at ~3ms/lookup its throughput ceiling (~667 rps) is far below peak —
// it saturates (p99 → ~1003ms) unless a cache fronts it and offloads the reads.
const SMALL_STORE = (id: string, type: ComponentType) =>
  node(id, type, { proc: 3, instanceType: 't3.small', workloadKind: 'cpu-bound' })

// ── per-question builders ────────────────────────────────────────────────────
interface Trio {
  ref: TopologyJSON
  gamed: TopologyJSON
  answers: Array<{ promptId: string; text: string }>
  gamedAnswers?: Array<{ promptId: string; text: string }>
  intended: string
  patchQuestion?: (q: any) => void
}

const builders: Record<string, () => Trio> = {
  'url-shortener': () => ({
    intended: 'simulation p99 (< 100ms): removing the cache saturates the KV store.',
    ref: topo(
      'url-ref',
      'URL shortener (reference)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        CACHE('cache'),
        SMALL_STORE('store', 'kv-store')
      ],
      [
        edge('lb', 'svc'),
        edge('svc', 'cache', { cond: READ }),
        edge('svc', 'store', { cond: WRITE }),
        edge('cache', 'store')
      ],
      'lb',
      2000,
      RW(0.99, 0.01)
    ),
    gamed: topo(
      'url-gamed',
      'URL shortener (gamed: no cache)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        SMALL_STORE('store', 'kv-store')
      ],
      [edge('lb', 'svc'), edge('svc', 'store')],
      'lb',
      2000,
      RW(0.99, 0.01)
    ),
    answers: [
      {
        promptId: 'why-store',
        text: 'A KV store gives O(1) point lookups for short codes at 200000 rps, but we give up ad-hoc SQL joins and multi-key transactions.'
      }
    ]
  }),

  'cache-placement': () => ({
    intended:
      'placement + p99 (< 120ms): with no cache between service and DB, reads saturate the relational DB.',
    ref: topo(
      'cache-ref',
      'Cache placement (reference)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        CACHE('cache'),
        SMALL_STORE('db', 'relational-db')
      ],
      [
        edge('lb', 'svc'),
        edge('svc', 'cache', { cond: READ }),
        edge('svc', 'db', { cond: WRITE }),
        edge('cache', 'db')
      ],
      'lb',
      2000,
      RW(0.95, 0.05)
    ),
    gamed: topo(
      'cache-gamed',
      'Cache placement (gamed: no cache)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        SMALL_STORE('db', 'relational-db')
      ],
      [edge('lb', 'svc'), edge('svc', 'db')],
      'lb',
      2000,
      RW(0.95, 0.05)
    ),
    answers: []
  }),

  'cargo-cult-cdn': () => ({
    // V1: justification is disabled, so the reference OMITS the CDN (correct minimal
    // design → forbidUnjustified passes) and the gamed design adds an undefended CDN
    // (present + no justification → forbidUnjustified fails). Still discriminates.
    intended: 'forbidUnjustified: the gamed design adds a CDN with no benefit for dynamic traffic.',
    // V1: justification is hidden, so the forbidUnjustified criterion drops its
    // justifyId and becomes a plain "this component must be absent" check.
    patchQuestion: (q) => {
      const c = q.semanticCriteria?.find((s: any) => s.kind === 'forbidUnjustified')
      if (c) delete c.justifyId
    },
    ref: topo(
      'cdn-ref',
      'Cargo-cult CDN (reference: no CDN)',
      [
        node('svc', 'microservice', { workers: 80, proc: 1 }),
        node('db', 'nosql-db', { workers: 50, proc: 2 })
      ],
      [edge('svc', 'db')],
      'svc',
      1000
    ),
    gamed: topo(
      'cdn-gamed',
      'Cargo-cult CDN (gamed: needless CDN)',
      [
        node('cdn', 'cdn', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 1 }),
        node('db', 'nosql-db', { workers: 50, proc: 2 })
      ],
      [edge('cdn', 'svc'), edge('svc', 'db')],
      'cdn',
      1000
    ),
    answers: []
  }),

  'messaging-fanout': () => ({
    intended: 'fanout: a work-queue delivering to 3 consumers is not pub/sub fan-out.',
    ref: topo(
      'fanout-ref',
      'Fan-out (reference: broker to 3)',
      [
        node('svc', 'microservice', { workers: 80 }),
        node('broker', 'message-broker', { workers: 200 }),
        node('c1', 'batch-worker'),
        node('c2', 'batch-worker'),
        node('c3', 'batch-worker')
      ],
      [
        edge('svc', 'broker'),
        edge('broker', 'c1', { mode: 'asynchronous' }),
        edge('broker', 'c2', { mode: 'asynchronous' }),
        edge('broker', 'c3', { mode: 'asynchronous' })
      ],
      'svc',
      1000
    ),
    gamed: topo(
      'fanout-gamed',
      'Fan-out (gamed: queue to 3)',
      [
        node('svc', 'microservice', { workers: 80 }),
        node('broker', 'message-broker', { workers: 200 }),
        node('q', 'queue', { workers: 200 }),
        node('c1', 'batch-worker'),
        node('c2', 'batch-worker'),
        node('c3', 'batch-worker')
      ],
      [
        edge('svc', 'broker'),
        edge('svc', 'q'),
        edge('q', 'c1', { mode: 'asynchronous' }),
        edge('q', 'c2', { mode: 'asynchronous' }),
        edge('q', 'c3', { mode: 'asynchronous' })
      ],
      'svc',
      1000
    ),
    answers: [
      {
        promptId: 'why-broker',
        text: 'A pub/sub message broker delivers each event to all 3 consumers independently, but at the cost of at-least-once duplicate delivery.'
      }
    ]
  }),

  'news-feed': () => ({
    intended: 'simulation p99 (< 200ms): removing the read cache saturates the timeline KV store.',
    ref: topo(
      'feed-ref',
      'News feed (reference)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        CACHE('cache'),
        node('kv', 'kv-store', { proc: 3, instanceType: 't3.small', workloadKind: 'cpu-bound' }),
        node('broker', 'message-broker', { workers: 200 }),
        node('tb1', 'batch-worker'),
        node('tb2', 'batch-worker')
      ],
      [
        edge('lb', 'svc'),
        edge('svc', 'cache', { cond: READ }),
        edge('cache', 'kv'),
        edge('svc', 'broker', { cond: WRITE }),
        edge('broker', 'tb1', { mode: 'asynchronous' }),
        edge('broker', 'tb2', { mode: 'asynchronous' })
      ],
      'lb',
      3000,
      RW(0.98, 0.02)
    ),
    gamed: topo(
      'feed-gamed',
      'News feed (gamed: no cache)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        node('kv', 'kv-store', { proc: 3, instanceType: 't3.small', workloadKind: 'cpu-bound' }),
        node('broker', 'message-broker', { workers: 200 }),
        node('tb1', 'batch-worker'),
        node('tb2', 'batch-worker')
      ],
      [
        edge('lb', 'svc'),
        edge('svc', 'kv', { cond: READ }),
        edge('svc', 'broker', { cond: WRITE }),
        edge('broker', 'tb1', { mode: 'asynchronous' }),
        edge('broker', 'tb2', { mode: 'asynchronous' })
      ],
      'lb',
      3000,
      RW(0.98, 0.02)
    ),
    answers: [
      {
        promptId: 'why-fanout',
        text: 'Fan-out on write via a message broker precomputes timelines so 50000 rps of reads are cheap, but it wastes work for inactive users.'
      }
    ]
  }),

  'payment-system': () => ({
    intended:
      'guardedPath: the gamed design lets a write reach the ledger without passing the idempotency check.',
    // The availability NFR (99.99%) maps to a near-zero error-rate rubric check.
    patchQuestion: (q) => {
      if (!q.rubric.checks.some((c: any) => c.metric === 'summary.errorRate')) {
        q.rubric.checks.unshift({
          id: 'availability',
          kind: 'simulation',
          description: 'Ledger error rate < 0.01% (availability)',
          metric: 'summary.errorRate',
          op: '<',
          value: 0.0001,
          points: 1
        })
      }
    },
    ref: topo(
      'pay-ref',
      'Payments (reference)',
      [
        node('svc', 'microservice', { workers: 80 }),
        node('idem', 'idempotency-manager', { workers: 100 }),
        node('ledger', 'event-sourcing-store', { workers: 100 })
      ],
      [edge('svc', 'idem'), edge('idem', 'ledger')],
      'svc',
      1000,
      RW(0.1, 0.9)
    ),
    gamed: topo(
      'pay-gamed',
      'Payments (gamed: idempotency bypass)',
      [
        node('svc', 'microservice', { workers: 80 }),
        node('idem', 'idempotency-manager', { workers: 100 }),
        node('ledger', 'event-sourcing-store', { workers: 100 })
      ],
      [edge('svc', 'idem'), edge('idem', 'ledger'), edge('svc', 'ledger', { cond: WRITE })],
      'svc',
      1000,
      RW(0.1, 0.9)
    ),
    answers: [
      {
        promptId: 'exactly-once',
        text: 'An idempotency-manager keyed on the idempotency key dedups retried payments before the append-only ledger, but adds one lookup per write.'
      }
    ]
  }),

  'rate-limiter': () => ({
    intended:
      'requires_edge / shared-counter path: the gamed limiter keeps per-instance counters (no edge to the shared cache).',
    // The latency_p99 NFR (< 10ms) maps to a simulation rubric check.
    patchQuestion: (q) => {
      if (!q.rubric.checks.some((c: any) => c.metric === 'summary.latency.p99')) {
        q.rubric.checks.unshift({
          id: 'counter-latency',
          kind: 'simulation',
          description: 'Counter check adds < 10ms (p99)',
          metric: 'summary.latency.p99',
          op: '<',
          value: 10,
          points: 2
        })
      }
    },
    ref: topo(
      'rl-ref',
      'Rate limiter (reference)',
      [
        node('rl', 'rate-limiter', { workers: 200 }),
        CACHE('cache'),
        node('svc', 'microservice', { workers: 80 }),
        node('db', 'nosql-db', { workers: 50, proc: 2 })
      ],
      [edge('rl', 'cache'), edge('cache', 'svc'), edge('svc', 'db')],
      'rl',
      1000
    ),
    gamed: topo(
      'rl-gamed',
      'Rate limiter (gamed: per-instance counters)',
      [
        node('rl', 'rate-limiter', { workers: 200 }),
        CACHE('cache'),
        node('svc', 'microservice', { workers: 80 }),
        node('db', 'nosql-db', { workers: 50, proc: 2 })
      ],
      [edge('rl', 'svc'), edge('svc', 'cache'), edge('svc', 'db')],
      'rl',
      1000
    ),
    answers: [
      {
        promptId: 'which-algo',
        text: 'A token-bucket rate-limiter allows short bursts up to the bucket size, but is less precise than a sliding-window counter.'
      },
      {
        promptId: 'why-cache',
        text: 'A shared in-memory cache holds counters for 100000 rps with sub-millisecond reads, but risks losing counters on eviction or failover.'
      }
    ]
  }),

  'ride-hailing': () => ({
    intended:
      'storageFit + placement: the gamed design puts payments on a KV store and drops the geospatial cache.',
    patchQuestion: (q) => {
      const sf = q.semanticCriteria.find((c: any) => c.id === 'pay-fits-relational')
      if (sf) sf.antiPattern = ['kv-store', 'nosql-db']
    },
    ref: topo(
      'ride-ref',
      'Ride-hailing (reference)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        CACHE('cache'),
        node('db', 'relational-db', { workers: 5, proc: 3 })
      ],
      [
        edge('lb', 'svc'),
        edge('svc', 'cache', { cond: READ }),
        edge('cache', 'db'),
        edge('svc', 'db', { cond: WRITE })
      ],
      'lb',
      3000,
      RW(0.8, 0.2)
    ),
    // relational-db stays present (structural has-payment-db passes) but a kv-store
    // is also wired as the payment store, so the failure lands on storageFit
    // (kv is an anti-pattern) + placement (no geospatial cache) — the intended axis.
    gamed: topo(
      'ride-gamed',
      'Ride-hailing (gamed: payments on KV, no geo cache)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        node('kv', 'kv-store', { workers: 20, proc: 2 }),
        node('db', 'relational-db', { workers: 20, proc: 2 })
      ],
      [edge('lb', 'svc'), edge('svc', 'kv', { cond: READ }), edge('svc', 'db', { cond: WRITE })],
      'lb',
      3000,
      RW(0.8, 0.2)
    ),
    answers: [
      {
        promptId: 'why-hot-cold',
        text: 'The geospatial hot path uses an in-memory cache for 40000 rps sub-second matches, but payments stay on the relational DB for ACID, at the cost of running two stores.'
      }
    ]
  }),

  'sensor-store': () => ({
    intended:
      'storageFit + throughput: a relational DB cannot sustain 200K-scale time-series writes and saturates.',
    ref: topo(
      'sensor-ref',
      'Sensor store (reference)',
      [
        node('svc', 'microservice', { workers: 80 }),
        node('tsdb', 'time-series-db', { workers: 60, proc: 1 })
      ],
      [edge('svc', 'tsdb')],
      'svc',
      3000,
      [
        { type: 'write', weight: 0.95, sizeBytes: 256 },
        { type: 'read', weight: 0.05, sizeBytes: 256 }
      ]
    ),
    gamed: topo(
      'sensor-gamed',
      'Sensor store (gamed: relational DB)',
      [node('svc', 'microservice', { workers: 80 }), SMALL_STORE('db', 'relational-db')],
      [edge('svc', 'db')],
      'svc',
      3000,
      [
        { type: 'write', weight: 0.95, sizeBytes: 256 },
        { type: 'read', weight: 0.05, sizeBytes: 256 }
      ]
    ),
    answers: [
      {
        promptId: 'why-db',
        text: 'A time-series DB ingests 200000 writes/sec append-only with time-partitioning, but cannot do ad-hoc relational joins.'
      }
    ]
  }),

  ticketmaster: () => ({
    intended:
      'guardedPath: the gamed design lets a seat hold reach the DB without the distributed lock.',
    ref: topo(
      'tm-ref',
      'Ticketmaster (reference)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('q', 'queue', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        node('lock', 'distributed-lock', { workers: 100 }),
        node('db', 'relational-db', { workers: 20, proc: 2 }),
        node('search', 'search-index', { workers: 60, proc: 1 })
      ],
      [
        edge('lb', 'q'),
        edge('q', 'svc'),
        edge('svc', 'search', { cond: READ }),
        edge('svc', 'lock', { cond: WRITE }),
        edge('lock', 'db')
      ],
      'lb',
      3000,
      RW(0.7, 0.3)
    ),
    gamed: topo(
      'tm-gamed',
      'Ticketmaster (gamed: lock bypass)',
      [
        node('lb', 'load-balancer', { workers: 300 }),
        node('q', 'queue', { workers: 300 }),
        node('svc', 'microservice', { workers: 80, proc: 2 }),
        node('lock', 'distributed-lock', { workers: 100 }),
        node('db', 'relational-db', { workers: 20, proc: 2 }),
        node('search', 'search-index', { workers: 60, proc: 1 })
      ],
      [
        edge('lb', 'q'),
        edge('q', 'svc'),
        edge('svc', 'search', { cond: READ }),
        edge('svc', 'lock'),
        edge('lock', 'db'),
        edge('svc', 'db', { cond: WRITE })
      ],
      'lb',
      3000,
      RW(0.7, 0.3)
    ),
    answers: [
      {
        promptId: 'no-double-book',
        text: 'A distributed lock with a TTL serializes seat holds so no seat is double-booked, but reduces concurrency under heavy contention.'
      }
    ]
  }),

  'web-crawler': () => ({
    intended:
      'guardedPath: the gamed crawler enqueues URLs to the frontier without passing the dedup index.',
    ref: topo(
      'crawler-ref',
      'Web crawler (reference)',
      [
        node('seed', 'microservice', { workers: 80 }),
        node('dedup', 'kv-store', { workers: 80, proc: 1 }),
        node('frontier', 'queue', { workers: 300 }),
        node('fetch', 'batch-worker', { workers: 100 }),
        node('proc', 'microservice', { workers: 100 }),
        node('store', 'object-storage', { workers: 100, proc: 1 })
      ],
      [
        edge('seed', 'dedup'),
        edge('dedup', 'frontier', { mode: 'asynchronous' }),
        edge('frontier', 'fetch', { mode: 'asynchronous' }),
        edge('fetch', 'proc'),
        edge('proc', 'store')
      ],
      'seed',
      3000,
      WONLY
    ),
    gamed: topo(
      'crawler-gamed',
      'Web crawler (gamed: dedup bypass)',
      [
        node('seed', 'microservice', { workers: 80 }),
        node('dedup', 'kv-store', { workers: 80, proc: 1 }),
        node('frontier', 'queue', { workers: 300 }),
        node('fetch', 'batch-worker', { workers: 100 }),
        node('proc', 'microservice', { workers: 100 }),
        node('store', 'object-storage', { workers: 100, proc: 1 })
      ],
      [
        edge('seed', 'dedup'),
        edge('seed', 'frontier', { mode: 'asynchronous' }),
        edge('dedup', 'frontier', { mode: 'asynchronous' }),
        edge('frontier', 'fetch', { mode: 'asynchronous' }),
        edge('fetch', 'proc'),
        edge('proc', 'store')
      ],
      'seed',
      3000,
      WONLY
    ),
    answers: [
      {
        promptId: 'why-dedup',
        text: 'A kv-store dedup index drops already-seen URLs before the frontier, but false positives can occasionally skip a genuinely new URL.'
      }
    ]
  }),

  'async-sla': () => ({
    intended:
      'structural + guardedPath: the gamed design is synchronous — no queue and no workers to decouple ingest.',
    ref: topo(
      'async-ref',
      'Async SLA (reference)',
      [
        node('svc', 'microservice', { workers: 80 }),
        node('q', 'queue', { workers: 300 }),
        node('worker', 'batch-worker', { workers: 100, proc: 2 }),
        node('db', 'relational-db', { workers: 60, proc: 2 })
      ],
      [
        edge('svc', 'q', { mode: 'asynchronous' }),
        edge('q', 'worker', { mode: 'asynchronous' }),
        edge('worker', 'db')
      ],
      'svc',
      3000,
      WONLY
    ),
    gamed: topo(
      'async-gamed',
      'Async SLA (gamed: synchronous, no queue)',
      [node('svc', 'microservice', { workers: 80 }), SMALL_STORE('db', 'relational-db')],
      [edge('svc', 'db')],
      'svc',
      3000,
      WONLY
    ),
    answers: [
      {
        promptId: 'why-async',
        text: 'An async queue absorbs 3000 rps spikes and lets workers drain jobs within the 15s SLA, but adds eventual-consistency latency.'
      }
    ]
  })
}

// ── student-facing text rewrite (Architecture-First framing) ─────────────────
// Rewrites ONLY prompt text / FRs / NFR descriptions / justify decisions / title.
// No grading structure or numeric NFR/scale value changes, so the trios still
// grade identically. Tags [G]/[J]/[N] live in the README, not the student text.
const FRAMING =
  'You are designing the system architecture — placing, connecting, and sizing infrastructure components, not writing application code.'

interface Buckets {
  G: string[]
  J: string[]
  N: string[]
}
interface Rewrite {
  title?: string
  text: string
  frs: string[]
  nfr?: string[] // by index, aligned to prompt.nonFunctionalRequirements
  justify?: Record<string, string> // promptId -> decision
  scaleAdd?: Record<string, number>
  buckets: Buckets
}

const REWRITE: Record<string, Rewrite> = {
  'url-shortener': {
    text: `You are the lead infrastructure architect for a new URL-shortening service (like bit.ly). ${FRAMING}

Design a write path that accepts a long URL and persists a short-code → long-URL mapping in a durable store, and a read path that resolves a short code and issues an HTTP redirect.

Target: redirect (read-path) p99 latency under 100 ms at peak.

Traffic: 200,000 peak RPS at a 99:1 read-to-write ratio. Reads that fall through to the primary store will saturate it.

At submission you will defend your storage-engine choice for point-lookups at this scale, your short-code generation and collision-handling strategy (e.g. base62), and your redirect status code (301 vs 302).`,
    frs: [
      'Write path: accept a long URL and persist a short-code → long-URL mapping to a durable store.',
      'Read path: resolve a short code to its long URL and return a redirect within the p99 target.'
    ],
    nfr: ['Redirect (read-path) p99 latency under 100 ms at peak load.'],
    justify: {
      'why-store':
        'Which storage engine did you choose for short-code point-lookups at 200,000 RPS and why; how do you generate collision-free short codes (e.g. base62); and which redirect status code (301 vs 302) do you return?'
    },
    buckets: {
      G: [
        'Durable store on the write path + fits point-lookup (structural + storageFit)',
        'Redirect read-path p99 < 100 ms (rubric simulation)',
        '99:1 read/write injected as requestDistribution — uncached reads saturate the store (reinforcing loop)'
      ],
      J: ['Store fit, base62 code generation/collision handling, 301 vs 302 (justify: why-store)'],
      N: ['bit.ly-style scenario; 200,000 peak RPS / 50M DAU display scale']
    }
  },

  'cache-placement': {
    title: 'Scale a read-hot product API',
    text: `You are an SRE hardening a product-catalog API that has started to buckle under read traffic. ${FRAMING}

All traffic must enter through a load balancer, reach the application service, and read from the primary database. Introduce and position an accelerating layer so reads are shielded from the database — it must sit on the path between the service and the database, never in front of the load balancer.

Target: read p99 latency under 120 ms at peak.

Traffic: 20,000 peak RPS at a 95:5 read-to-write ratio; unshielded reads will overwhelm the database.`,
    frs: [
      'Route all traffic through the load balancer before it reaches the service.',
      'Serve reads through an accelerating layer positioned between the service and the database (not before the load balancer).'
    ],
    nfr: ['Read p99 latency under 120 ms at peak load.'],
    buckets: {
      G: [
        'Load balancer fronts the system (requires_component)',
        'Accelerating layer between service and DB, not before the LB (placement)',
        'Read p99 < 120 ms (rubric); 95:5 read/write injected'
      ],
      J: ['— none authored'],
      N: ['Product-catalog API under read pressure; 20,000 peak RPS']
    }
  },

  'cargo-cult-cdn': {
    title: 'Design a dynamic per-user API',
    text: `You are reviewing an architecture for an API that serves dynamic, per-user responses (personalized, non-cacheable). ${FRAMING}

Design the request path from the edge to the service and its data store. Add only components that earn their place — an edge cache/CDN for content that is not cacheable is cargo-cult.

Traffic: 8,000 peak RPS of personalized responses.

If you include a CDN, you will be required at submission to defend what it actually accelerates here; otherwise omit it.`,
    frs: [
      'Serve dynamic, per-user responses from the service and its data store.',
      'Do not add infrastructure that provides no benefit for non-cacheable traffic.'
    ],
    justify: {
      'why-cdn':
        'If your design includes a CDN in front of dynamic per-user responses, justify precisely what it accelerates and the trade-off you accept; if not, explain why it is omitted.'
    },
    buckets: {
      G: [
        'Single source of traffic (structural)',
        'A CDN, if present, must be defended or it fails (forbidUnjustified)'
      ],
      J: ['Whether a CDN is warranted for non-cacheable traffic (justify: why-cdn)'],
      N: ['Personalized-API review; 8,000 peak RPS']
    }
  },

  'messaging-fanout': {
    title: 'Design an event-notification backbone',
    text: `You are designing the notification backbone that delivers every domain event to several independent downstream services (analytics, a search-indexer, email). ${FRAMING}

One producer publishes each event once. Every one of the three downstream consumers must receive every event independently.

Traffic: 5,000 events/sec from a single producer.

At submission you will defend your choice of messaging primitive and its delivery-semantics trade-off.`,
    frs: [
      'Publish each event exactly once from a single producer.',
      'Deliver every event to all three independent consumers (each consumer sees the full stream).'
    ],
    justify: {
      'why-broker':
        'Why does your messaging primitive deliver each event to all consumers (broadcast) rather than to just one, and what delivery-semantics trade-off (e.g. at-least-once duplicates) do you accept?'
    },
    buckets: {
      G: [
        'A broadcast broker is present (requires_component)',
        'Broker fans out to ≥3 independent consumers; a work-queue to 3 is wrong (fanout, hardFail)'
      ],
      J: ['Broadcast vs work-queue delivery semantics (justify: why-broker)'],
      N: ['analytics/search/email backbone; 5,000 events/sec']
    }
  },

  'news-feed': {
    title: 'Design a social news feed',
    text: `You are the architect for a social app's home feed. ${FRAMING}

Design a write path where posting an item fans it out to followers' timelines via a broadcast primitive to independent timeline builders, and a read path where a user loads their prebuilt timeline by point-lookup.

Target: feed-load (read-path) p99 latency under 200 ms.

Traffic: 50,000 peak RPS at a 98:2 read-to-write ratio; timeline reads that hit the backing store directly will saturate it.

At submission you will defend your fan-out-on-write versus fan-out-on-read decision given the read ratio.`,
    frs: [
      'Write path: on a new post, fan the item out to follower timelines via a broadcast primitive to independent timeline builders.',
      "Read path: load a user's prebuilt timeline by point-lookup within the p99 target."
    ],
    nfr: ['Feed-load (read-path) p99 latency under 200 ms at peak.'],
    justify: {
      'why-fanout':
        'Given a 50,000-RPS, 98:2 read-heavy load, why fan out on write (precompute timelines) versus on read, and what is the trade-off?'
    },
    buckets: {
      G: [
        'Broadcast fan-out to ≥2 independent timeline builders (fanout)',
        'Timeline store fits point-lookup (storageFit)',
        'Feed p99 < 200 ms (rubric); 98:2 read/write injected'
      ],
      J: ['Fan-out-on-write vs -on-read, cites the 50k scale (justify: why-fanout)'],
      N: ['social home feed; 50,000 peak RPS / 10M DAU']
    }
  },

  'payment-system': {
    title: 'Design a payment-processing backend',
    text: `You are the architect for a payments platform that must never charge a customer twice and must keep an auditable trail. ${FRAMING}

Design the write path so every payment first passes a deduplication (idempotency) check and is then appended to an immutable, append-only ledger. A cache is never the system of record.

Target: ≥ 99.99% availability for ledger writes (near-zero error rate under load).

Traffic: 10,000 peak RPS, write-dominant (90% writes).

At submission you will defend your exactly-once strategy (idempotency keys) and why the ledger is append-only/immutable — correctness a load test cannot prove.`,
    frs: [
      'Route every payment write through a deduplication (idempotency) check before it reaches the ledger.',
      'Append committed payments to an immutable, append-only ledger (never mutate in place).'
    ],
    nfr: ['≥ 99.99% availability for ledger writes (error rate below 0.01%).'],
    justify: {
      'exactly-once':
        'How do you guarantee exactly-once payment processing (idempotency keys) and an auditable, immutable ledger, and what trade-off does that impose?'
    },
    buckets: {
      G: [
        'Idempotency check + append-only ledger present (structural)',
        'Every write guarded through idempotency before the ledger (guardedPath, hardFail)',
        'Ledger fits append-only, not a cache (storageFit, hardFail)',
        'Availability ≥ 99.99% / errorRate < 0.01% (rubric)'
      ],
      J: ['Exactly-once via idempotency keys + immutable-ledger rationale (justify: exactly-once)'],
      N: ['payments platform; 10,000 peak RPS, write-dominant']
    }
  },

  'rate-limiter': {
    title: 'Design a distributed rate limiter',
    text: `You are adding rate limiting in front of a multi-instance API tier. ${FRAMING}

Every request passes a rate-limit check before reaching the service. The limiter's counters must live in a single shared store that all instances read and write — per-instance in-memory counters let a client exceed the limit by spreading requests across instances.

Target: the counter check adds under 10 ms p99.

Traffic: 100,000 peak RPS across many app instances.

At submission you will defend your limiting algorithm (e.g. token bucket vs sliding window) and why a shared in-memory store (not a disk-backed DB) holds the counters.`,
    frs: [
      'Check and enforce the limit before a request reaches the service.',
      'Keep all counters in one shared store read/written by every instance (no per-instance counters).'
    ],
    nfr: ['Counter-check overhead under 10 ms p99.'],
    justify: {
      'which-algo':
        'Which limiting algorithm (token bucket, sliding window, …) did you choose and what is its accuracy/burst trade-off?',
      'why-cache':
        'Why hold the counters in a shared in-memory store rather than a disk-backed database at 100,000 RPS, and what durability trade-off do you accept?'
    },
    buckets: {
      G: [
        'Rate limiter + shared cache present, limiter→shared-cache edge (structural)',
        'All checks traverse the shared counter store (guardedPath, hardFail)',
        'Counter-check p99 < 10 ms (rubric)'
      ],
      J: ['Algorithm choice + shared-store vs DB for counters (justify: which-algo, why-cache)'],
      N: ['multi-instance API tier; 100,000 peak RPS']
    }
  },

  'ride-hailing': {
    title: 'Design a ride-hailing match & payment backend',
    text: `You are the lead infrastructure architect at a ride-hailing company preparing for a national-holiday surge. ${FRAMING}

Design a matching path that keeps geospatial lookups on a fast in-memory layer positioned between the service and the payment database, and a separate payment path that commits to a strongly-consistent transactional database. Keep the hot matching path off the payment database.

Target: rider-to-driver match p99 latency under 3 s.

Traffic: 40,000 peak RPS at an 80:20 read-to-write ratio.

At submission you will defend why the geospatial hot path is separated from the payment store and how payments stay ACID-consistent.`,
    frs: [
      'Serve rider→driver matching from a fast in-memory geospatial layer positioned between the service and the payment database.',
      'Commit payments to a strongly-consistent (transactional) database, isolated from the matching path.'
    ],
    nfr: ['Rider-to-driver match p99 latency under 3 s at peak.'],
    justify: {
      'why-hot-cold':
        'Why separate the geospatial hot path (in-memory) from the payment database, citing the 40,000-RPS scale, and what is the trade-off of running two stores?'
    },
    buckets: {
      G: [
        'Transactional DB present for payments (structural)',
        'Payment store fits transactional-relational, not KV (storageFit)',
        'Geospatial cache between service and payment DB (placement)',
        'Match p99 < 3 s (rubric); 80:20 read/write injected'
      ],
      J: ['Hot/cold split + ACID payments (justify: why-hot-cold)'],
      N: ['ride-hailing holiday surge; 40,000 peak RPS']
    }
  },

  'sensor-store': {
    title: 'Ingest a large IoT sensor fleet',
    text: `You are designing the ingestion backend for a large IoT fleet emitting time-stamped readings continuously. ${FRAMING}

Design an ingest path that sustains a very high, append-only write rate and supports range-queries over recent time windows per sensor. Choose a storage engine whose access pattern matches time-partitioned, join-free data.

Target: sustain the injected write throughput without dropping events.

Traffic: 200,000 writes/sec, append-only, ~5% reads (recent-window range queries).

At submission you will defend your storage-engine choice for time-series at this write rate.`,
    frs: [
      'Ingest time-stamped readings at a sustained, append-only write rate.',
      'Support range-queries over recent time windows per sensor.'
    ],
    nfr: ['Sustain the injected write throughput (≥ 2,000 RPS in-sim) without dropped events.'],
    justify: {
      'why-db':
        'Why is your storage engine the right fit for 200,000 append-only time-series writes/sec (vs a relational database), and what capability do you trade away?'
    },
    buckets: {
      G: [
        'Store fits time-series, not relational (storageFit, hardFail)',
        'Sustains write throughput (rubric throughput); 200K write-dominant load injected'
      ],
      J: ['Time-series engine choice + join trade-off (justify: why-db)'],
      N: ['IoT fleet ingest; 200,000 writes/sec']
    }
  },

  ticketmaster: {
    title: 'Design a high-demand ticketing system',
    text: `You are architecting seat sales for high-demand events that open to a thundering herd. ${FRAMING}

Design a search path over an event catalog, a seat-hold path that serializes holds through a distributed lock and commits to a transactional database, and a virtual waiting queue that absorbs the onsale surge.

Target: hold-response p99 latency under 2 s via the waiting queue.

Traffic: 50,000 peak RPS onsale surge at a 70:30 read-to-write ratio.

At submission you will defend how you prevent double-booking under contention (locking + TTL + optimistic concurrency).`,
    frs: [
      'Search events via a search index.',
      'Serialize every seat hold through a distributed lock before committing to the transactional database.',
      'Absorb the onsale surge with a virtual waiting queue.'
    ],
    nfr: ['Hold-response p99 latency under 2 s via the waiting queue.'],
    justify: {
      'no-double-book':
        'How do you guarantee no double-booking under contention (distributed lock + TTL + optimistic concurrency), and what concurrency trade-off do you accept?'
    },
    buckets: {
      G: [
        'Distributed lock + search index + waiting queue present (structural)',
        'Every hold guarded through the lock to the DB (guardedPath, hardFail)',
        'Bookings fit transactional-relational (storageFit)',
        'Hold p99 < 2 s (rubric)'
      ],
      J: ["No-double-booking strategy the sim can't measure (justify: no-double-book)"],
      N: ['high-demand onsale; 50,000 peak RPS']
    }
  },

  'web-crawler': {
    title: 'Design a distributed web crawler',
    text: `You are building a distributed crawler that must fetch billions of pages without re-crawling. ${FRAMING}

Design a pipeline: URLs are deduplicated against an index before entering the frontier queue, the frontier fans work out to many fetchers, and fetched pages flow through processors in order into object storage.

Target: sustain the injected aggregate crawl throughput.

Traffic: ~23,000 URLs/sec steady, write-dominant.

At submission you will defend your dedup mechanism (e.g. bloom filter vs exact index) before enqueue.`,
    frs: [
      'Deduplicate URLs against an index before enqueueing them into the frontier (no re-crawls).',
      'Fan the frontier out to many fetch workers.',
      'Flow fetched pages through processors in an ordered pipeline into object storage.'
    ],
    nfr: ['Sustain the injected aggregate crawl throughput (≥ 2,000 RPS in-sim).'],
    justify: {
      'why-dedup':
        'Why deduplicate before enqueue and how (bloom filter vs exact index), and what false-positive trade-off do you accept?'
    },
    buckets: {
      G: [
        'Frontier queue + dedup index present (structural)',
        'URLs guarded through dedup before the frontier (guardedPath)',
        'Ordered pipeline frontier→fetchers→processors (placement)',
        'Aggregate throughput sustained (rubric)'
      ],
      J: ['Dedup mechanism + false-positive trade-off (justify: why-dedup)'],
      N: ['billions-of-pages crawler; ~23,000 URLs/sec']
    }
  },

  'async-sla': {
    title: 'Job-processing backend for a 15s SLA',
    text: `You are decoupling a synchronous request path that collapses under spikes. ${FRAMING}

Accept jobs quickly at ingest, hand them to an asynchronous queue, and process each with a pool of scalable workers within the SLA. Ingest must not block on processing.

Target: p99 job completion under 15 s under spike load.

Traffic: 50,000 jobs/min with bursty spikes (write-dominant).

At submission you will defend why decoupling via a queue meets the SLA versus a synchronous path.`,
    frs: [
      'Accept jobs at ingest without blocking on downstream processing.',
      'Buffer jobs in an asynchronous queue and process each with scalable workers within the 15 s SLA.'
    ],
    nfr: ['p99 job-completion latency under 15 s under spike load.'],
    justify: {
      'why-async':
        'Why decouple ingest from processing with a queue under spike load (vs a synchronous path), and what consistency trade-off do you accept?'
    },
    buckets: {
      G: [
        'Async queue + scalable workers present (structural)',
        'Ingest guarded through the queue to workers, no bypass (guardedPath)',
        'p99 completion < 15 s (rubric); spike write load injected'
      ],
      J: ['Queue-decoupling rationale + consistency trade-off (justify: why-async)'],
      N: ['monolith spike decoupling; 50,000 jobs/min']
    }
  }
}

function applyRewrite(id: string, q: any): Rewrite | undefined {
  const r = REWRITE[id]
  if (!r) return undefined
  if (r.title) q.title = r.title
  q.prompt.text = r.text
  q.prompt.functionalRequirements = r.frs
  if (r.nfr)
    r.nfr.forEach((d, i) => {
      if (q.prompt.nonFunctionalRequirements[i])
        q.prompt.nonFunctionalRequirements[i].description = d
    })
  if (r.scaleAdd) Object.assign(q.prompt.scale, r.scaleAdd)
  if (r.justify) for (const p of q.justify ?? []) if (r.justify[p.id]) p.decision = r.justify[p.id]
  return r
}

// ── emit ─────────────────────────────────────────────────────────────────────
// Deferred to a later version: these questions require coordination/auxiliary
// nodes (idempotency-manager, event-sourcing-store, distributed-lock, rate-limiter)
// that are not in the V1 palette and have no special simulation behavior yet. Their
// generated trios live under `deferred-v2/`; skip them here so the V1 bank has only
// the 9 buildable, physics-relevant questions.
const DEFERRED_V2 = new Set(['payment-system', 'ticketmaster', 'rate-limiter'])

// Bottleneck domain(s) each question exercises (see specs/question-families-and-bottlenecks.md).
// A question can span several — a domain is only listed where the question actually grades it
// (compute → a sim/forbidUnjustified check; storage → a storageFit/fanout criterion), so the
// authoring validator stays clean. Used as the first-class `domains` field + the guide's name.
const DOMAINS: Record<string, string[]> = {
  'url-shortener': ['compute', 'storage'],
  'cache-placement': ['compute'],
  'cargo-cult-cdn': ['compute'],
  'news-feed': ['compute', 'storage'],
  'ride-hailing': ['compute', 'storage'],
  'web-crawler': ['compute'],
  'async-sla': ['compute'],
  'messaging-fanout': ['storage'],
  'sensor-store': ['storage']
}
// The specific concept(s) each question teaches (lesson-level, finer than `domains`).
// Kebab-case slugs; composed questions list several. See the "Concept taught per question"
// table in specs/question-families-and-bottlenecks.md.
const CONCEPTS: Record<string, string[]> = {
  'async-sla': ['async-decoupling'],
  'cache-placement': ['cache-placement'],
  'cargo-cult-cdn': ['justified-omission'],
  'url-shortener': ['read-cache', 'store-fit'],
  'news-feed': ['fan-out-on-write', 'read-cache'],
  'ride-hailing': ['store-fit', 'geo-cache-placement'],
  'messaging-fanout': ['pubsub-fanout'],
  'sensor-store': ['store-fit'],
  'web-crawler': ['dedup-gate']
}
const DOMAIN_LABEL: Record<string, string> = {
  compute: 'Compute & Capacity (node-bottleneck)',
  storage: 'Storage & State (data-bottleneck)',
  network: 'Network & Edge (connection-bottleneck)',
  resilience: 'Resilience & Chaos (fault-bottleneck)',
  correctness: 'Correctness (concurrency-bottleneck)',
  cost: 'Cost (meta-constraint)'
}

for (const [id, build] of Object.entries(builders)) {
  if (DEFERRED_V2.has(id)) continue
  const trio = build()
  const dir = join(ROOT, id)
  mkdirSync(dir, { recursive: true })

  const q = JSON.parse(readFileSync(questionSource(id), 'utf-8'))
  trio.patchQuestion?.(q)
  const rewrite = applyRewrite(id, q)

  // Persist the bottleneck domain(s) as a first-class field (source of truth for the
  // Django file name, the platform's per-domain switching, and the authoring check).
  const domains = DOMAINS[id] ?? ['compute']
  q.domains = domains
  // The concept(s) taught (lesson-level tag, finer-grained than domains).
  const concepts = CONCEPTS[id]
  if (concepts) q.concepts = concepts

  // V1: hide the justification feature. Move `justify` to `_justify` (an unknown
  // key the parser strips), so no justify prompts are graded or shown, while the
  // authored data is preserved in the file for the V2 redesign.
  if (q.justify) {
    q._justify = q.justify
    delete q.justify
  }

  const w = (name: string, data: unknown) =>
    writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + '\n')

  // Remove any stale justification-answer files (unused now that justify is hidden).
  for (const stale of ['answers.json', 'gamed-answers.json']) {
    rmSync(join(dir, stale), { force: true })
  }

  w('question.json', q)
  w('reference-topology.json', trio.ref)
  w('gamed-topology.json', trio.gamed)
  writeFileSync(join(dir, 'README.md'), questionReadme(id, q, trio, rewrite))
  // Remove stale domain-suffixed guides from a prior run's domain set (e.g. a rename
  // from `-compute` to `-compute-storage`). The hand-authored suffix-less
  // `django-admin-assignment.md` has no `-` after "assignment", so it is never matched.
  const djangoName = `django-admin-assignment-${domains.join('-')}.md`
  for (const f of readdirSync(dir)) {
    if (/^django-admin-assignment-.+\.md$/.test(f) && f !== djangoName) {
      rmSync(join(dir, f), { force: true })
    }
  }
  writeFileSync(join(dir, djangoName), djangoAdmin(id, q, domains))
  console.log(`wrote ${id}/ - intended failure: ${trio.intended}`)
}

// ── Django-admin authoring guide (Newton GAME assignment mode) ────────────────
// Fully derived from question.json, so it stays in sync. Justify prompts are hidden
// for V1 (stored as `_justify`), so they are NOT emitted into the SIMULATOR_CONFIG.
function questionTextHtml(q: any): string {
  const paras = String(q.prompt.text)
    .split(/\n\n+/)
    .map((p: string) => `<p>${p.trim().replace(/\s*\n\s*/g, ' ')}</p>`)
    .join('\n')
  const list = (title: string, items: string[]) =>
    items.length
      ? `<h3>${title}</h3>\n<ul>\n${items.map((i) => `  <li>${i}</li>`).join('\n')}\n</ul>`
      : ''
  const frs = list('Functional Requirements', q.prompt.functionalRequirements ?? [])
  const nfrs = list(
    'Non-Functional Targets',
    (q.prompt.nonFunctionalRequirements ?? []).map((n: any) => n.description)
  )
  const s = q.prompt.scale ?? {}
  const scaleItems: string[] = []
  if (s.dau !== undefined) scaleItems.push(`<strong>DAU:</strong> ${s.dau.toLocaleString('en-US')}`)
  if (s.peakRps !== undefined)
    scaleItems.push(`<strong>Peak RPS:</strong> ${s.peakRps.toLocaleString('en-US')}`)
  if (s.readWriteRatio !== undefined)
    scaleItems.push(`<strong>Read / Write:</strong> ${s.readWriteRatio}:${100 - s.readWriteRatio}`)
  const scale = list('Scale', scaleItems)
  return [paras, frs, nfrs, scale].filter(Boolean).join('\n')
}

function djangoRow(n: number, title: string, input: unknown): string {
  return `## Row ${n}\n\n- \`title\`: \`${title}\`\n- \`input\`:\n\n\`\`\`json\n${JSON.stringify(
    input,
    null,
    2
  )}\n\`\`\``
}

function djangoAdmin(id: string, q: any, domains: string[]): string {
  const rows: string[] = []
  rows.push(
    djangoRow(1, `SIMULATOR_CONFIG: ${id}`, {
      type: 'SIMULATOR_CONFIG',
      configVersion: '1.0',
      questionId: id,
      questionVersion: q.version,
      questionType: q.type,
      domains,
      concepts: q.concepts,
      difficulty: q.difficulty,
      workloadCategory: q.workloadCategory,
      presentationMode: 'raw-html',
      promptSource: 'question_text',
      scaffold: q.scaffold,
      constraints: q.constraints,
      suite: q.suite,
      rubric: { id: q.rubric.id, passThreshold: q.rubric.passThreshold }
    })
  )
  let n = 2
  for (const r of q.structuralRules ?? [])
    rows.push(djangoRow(n++, `STRUCTURAL_RULE: ${r.id}`, { type: 'STRUCTURAL_RULE', ...r }))
  for (const c of q.semanticCriteria ?? [])
    rows.push(djangoRow(n++, `SEMANTIC_CRITERION: ${c.id}`, { type: 'SEMANTIC_CRITERION', ...c }))
  for (const c of q.rubric.checks ?? [])
    rows.push(djangoRow(n++, `RUBRIC_CHECK: ${c.id}`, { type: 'RUBRIC_CHECK', ...c }))

  return `# Django Admin Setup: ${q.title}

> Domain(s): ${domains.map((d) => DOMAIN_LABEL[d] ?? d).join(' + ')}. This authoring shape is for Newton assignment mode
> only (GAME iframe with \`?host=newton\`). Standalone/local authoring at
> \`https://systems-simulator.newtonschool.co/\` must keep topology open/save available.
>
> V1 note: justification prompts are hidden (stored as \`_justify\`) and are **not** graded,
> so they are not emitted below. Budget is not used for V1.

## Frontend contract

- GAME iframe URL: \`https://systems-simulator.newtonschool.co/?host=newton\`
- Newton-hosted assignment mode must render \`question_text\` as raw Django HTML.
- The frontend translator must rebuild immutable simulator config from the test-case rows below, not from \`initial_game_state\`.
- Newton-hosted assignment mode must hide topology \`Open\` / \`Save\` actions and disable \`Ctrl/Cmd+O\` and \`Ctrl/Cmd+S\`.
- V1: edge configuration is locked in assignment mode (edges are non-editable; the edge config panel is hidden) - students only drag nodes, change storage types, and scale workers/replicas.

## Django fields

- \`question_type\`: \`GAME\`
- \`question_title\`: \`${q.title}\`
- \`question_text\`:

\`\`\`html
${questionTextHtml(q)}
\`\`\`

- \`initial_game_state\`:

\`\`\`json
{}
\`\`\`

- \`initial_game_state\` must stay mutable-only. Do not paste the full \`question.json\` here.

## Test-case mapping rules

- Create the rows in the exact order shown below.
- For every row: \`hidden = false\`, \`output = ""\`, \`output_file = empty\`.
- Paste each JSON block into the Django \`input\` field exactly as shown.

${rows.join('\n\n')}
`
}

function bucketTable(b: Buckets): string {
  const rows: string[] = []
  const add = (tag: string, items: string[]) =>
    items.forEach((it, i) => rows.push(`| ${i === 0 ? tag : ''} | ${it} |`))
  add('**[G]** gradeable', b.G)
  add('**[J]** justification', b.J)
  add('**[N]** narrative', b.N)
  return `| Bucket | Requirement |\n|--------|-------------|\n${rows.join('\n')}`
}

function questionReadme(id: string, q: any, trio: Trio, rewrite?: Rewrite): string {
  return `# ${q.title}

\`${id}\` · type: \`${q.type}\` · workload: \`${q.workloadCategory ?? 'n/a'}\` · difficulty: \`${q.difficulty}\`

> ${q.prompt.text}

## Files
- \`question.json\` - the QuestionPackage (prompt, structural rules, semantic criteria, suite, rubric). Traffic is driven by a Client (api-endpoint) source node feeding the topology.
- \`reference-topology.json\` - a **correct** design. Grades **PASS** on every checkable axis.
- \`gamed-topology.json\` - a plausible-but-wrong design. Grades **FAIL** on the intended axis.

> **V1 note:** the justification feature is hidden for launch, so \`justify\` is stored under \`_justify\` (ignored by the grader) and any \`[J]\` rows below are deferred to V2.

## Requirement buckets ([G]radeable / [J]ustification / [N]arrative)
Every requirement is backed by a check - no orphan requirements.

${rewrite ? bucketTable(rewrite.buckets) : '_n/a_'}

## Intended discrimination
${trio.intended}

## Validate (from the ns-simulator-prod repo)
The harness grades the whole trio (structural, semantic, simulation):
\`\`\`bash
npx tsx scripts/validate-question-dir.ts \\
  ../system-design-simulator-questions/questions/${id}
\`\`\`
Expect: reference PASSES all tests; gamed FAILS on the intended axis.

You can also grade a single topology headlessly (structural + semantic + simulation only — justifications show as unanswered):
\`\`\`bash
npx tsx src/cli/index.ts evaluate question \\
  ../system-design-simulator-questions/questions/${id}/question.json \\
  ../system-design-simulator-questions/questions/${id}/reference-topology.json
\`\`\`
`
}
