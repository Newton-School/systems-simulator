import type { ComponentCategory } from '../core/types'
import type { QuestionDomain } from './gradingCriteria'

export const SUPPORT_TIERS = [
  'first-class',
  'guided',
  'structural-only',
  'presentational-only',
  'deferred'
] as const

export type SupportTier = (typeof SUPPORT_TIERS)[number]

export interface SupportLedgerEntry {
  tier: SupportTier
  summary: string
  simulates?: readonly string[]
  inferred?: readonly string[]
  deferred?: readonly string[]
}

export const DOMAIN_SUPPORT_LEDGER: Record<QuestionDomain, SupportLedgerEntry> = {
  compute: {
    tier: 'first-class',
    summary:
      'Queueing, latency, throughput, saturation, and async-versus-sync bottlenecks are directly measurable at runtime.',
    simulates: ['latency', 'throughput', 'queue depth', 'utilization', 'timeouts']
  },
  storage: {
    tier: 'first-class',
    summary:
      'Store-fit, cache placement, read/write routing, and data-path bottlenecks are gradeable through runtime and semantic checks.',
    simulates: ['cache hit behavior', 'read/write latency differences', 'storage-fit proxies']
  },
  network: {
    tier: 'guided',
    summary:
      'Edge latency, packet loss, protocol overhead, request-direction bandwidth (transmission delay plus FIFO link queueing), per-edge concurrency caps, an opt-in connection model (TCP/TLS/upgrade handshakes on new connections, keep-alive and persistent reuse, TLS session resumption, per-protocol streams per connection so HTTP/1.1 head-of-line waits at a full pool while HTTP/2 multiplexes), opt-in Kafka producer batching (linger.ms / batch.size), HTTP acknowledgements, session lifecycle markers, and L4-versus-L7 rejection/flow-control behavior are modeled, while response payloads remain simplified.',
    simulates: [
      'edge latency',
      'edge packet loss',
      'basic protocol overhead',
      'HTTP acknowledgements',
      'session lifecycle',
      'L4/L7 divergence',
      'edge bandwidth (transmission delay and link queueing)',
      'per-edge latency breakdown',
      'connection handshakes (TCP 1 RTT, TLS 1.2 2 RTT / 1.3 1 RTT, WebSocket upgrade 1 RTT, AMQP open 4 RTT, Kafka ApiVersions 1 RTT) on new connections, one RTT = one edge latency sample',
      'connection reuse: per-request, keep-alive with idle timeout, persistent; per-client pools on edges leaving the traffic source',
      'TLS session resumption (1.2 abbreviated handshake, 1.3 0-RTT)',
      'client connection-pool limits (maxConnections) with FIFO connection wait and deadline timeouts',
      'HTTP/2 multiplexing: streams per connection (gRPC 100, HTTPS/TCP 1); synchronous requests hold a stream until their response, WebSocket/AMQP/Kafka messages until delivery',
      'Kafka producer batching: a batch is one transfer (one edge slot, one protocol overhead, one propagation sample, its total bytes on the link); records pay the measured batch wait'
    ],
    deferred: [
      'response payload bandwidth (responses do not cross edges)',
      'bandwidth, connection model and batching in the heavy-load fluid tier',
      'TLS handshake CPU cost, certificate chain size, and session-ticket expiry',
      'per-replica connection pools (a service edge has one pool shared by its instances)',
      'Kafka compression, producer acks levels (acks=0/1/all), buffer.memory back-pressure, and per-partition batches',
      'database-specific connection startup (authentication exchanges, backend process spawn)',
      'full transport-stack physics (slow start, windowing, segmentation)'
    ]
  },
  resilience: {
    tier: 'guided',
    summary:
      'Retries, circuit breakers, bulkheads, load shedding, health-aware routing, failure windows, Region / AZ / Subnet outages (every component inside fails for the window), deterministic replica promotion, and quorum availability are modeled, with physical consensus timing still simplified.',
    simulates: [
      'retry backoff',
      'circuit breaker state',
      'bulkhead compartments',
      'load shedding',
      'health-aware routing',
      'status timelines',
      'fault-domain outages (region / availability zone / subnet)',
      'replica failover',
      'quorum availability'
    ],
    deferred: [
      'packet-level replication',
      'real Raft election timing',
      'Byzantine consensus',
      'correlated partial degradation of a zone (slow or lossy rather than down)',
      'partitions between zones that are both up',
      'cross-region replication lag'
    ]
  },
  correctness: {
    tier: 'guided',
    summary:
      'Guarded paths, lock contention, duplicate suppression, commit-outcome journaling, modeled external reconciliation, quorum commit evidence, and read-consistency oracles (stale reads, read-your-writes and monotonic-read violations, and a bounded single-key linearizability check) are teachable; exactly-once is not proved and linearizability is only checked within a per-key history bound.',
    simulates: [
      'lock contention',
      'duplicate suppression',
      'commit outcome journal transitions',
      'guarded write paths',
      'modeled external outcome probes',
      'quorum commit evidence',
      'stale-read, read-your-writes, and monotonic-read oracles over recorded data versions',
      'bounded single-key register linearizability check'
    ],
    inferred: ['topology proxies', 'justification-backed decisions'],
    deferred: [
      'exactly-once commit coordination',
      'linearizability beyond the per-key history bound or across keys (reported as not checked)'
    ]
  },
  cost: {
    tier: 'guided',
    summary:
      'Always-on cost output and budget checks exist, but the model is still simplified and does not cover every provider-specific pricing dimension.',
    simulates: ['topology cost totals', 'budget caps', 'per-node cost breakdown'],
    deferred: ['managed-service consumption pricing', 'full provider-specific billing nuance']
  }
}

export const COMPONENT_CATEGORY_SUPPORT_LEDGER: Record<ComponentCategory, SupportLedgerEntry> = {
  compute: {
    tier: 'first-class',
    summary: 'Core compute services have differentiated queueing, latency, and resource behavior.'
  },
  'network-and-edge': {
    tier: 'guided',
    summary:
      'Routing, edge effects, protocol/session markers, and L4-versus-L7 behavior exist; low-level transport physics remains simplified.'
  },
  'storage-and-data': {
    tier: 'first-class',
    summary: 'Storage choices, caches, and data-serving paths are strong simulator surfaces.'
  },
  'messaging-and-streaming': {
    tier: 'guided',
    summary:
      'Queues, fanout, deterministic partition assignment, one-delivery-per-group routing, offsets, retention expiry, replay reads, group lag, and consumer rebalancing are modeled; physical broker replication remains partial.'
  },
  'orchestration-and-infra': {
    tier: 'presentational-only',
    summary:
      'Most control-plane and orchestration nodes still simulate as generic queues unless a trait note says otherwise.'
  },
  'security-and-identity': {
    tier: 'presentational-only',
    summary:
      'Most security nodes are present for topology teaching, not for deep policy or auth semantics at runtime.'
  },
  observability: {
    tier: 'presentational-only',
    summary:
      'Observability sinks mostly behave like generic queues today, with honest notes about missing ingest and retention semantics.'
  },
  'devops-and-delivery': {
    tier: 'presentational-only',
    summary:
      'CI/CD and delivery nodes are available for architecture diagrams but not for first-class runtime teaching.'
  },
  'data-infra-and-analytics': {
    tier: 'presentational-only',
    summary:
      'Analytics and ML-adjacent infrastructure is mostly structural today, not deeply modeled physics.'
  },
  'real-time-and-media': {
    tier: 'guided',
    summary:
      'Realtime nodes can carry session and flow-control semantics, but media encoding, jitter buffers, and codec behavior remain presentational.'
  },
  'external-and-integration': {
    tier: 'guided',
    summary:
      'External connectors can participate in modeled authoritative side-effect reconciliation, but live provider APIs and provider-specific consistency are not simulated.'
  },
  'dns-and-certs': {
    tier: 'guided',
    summary:
      'DNS routing policies and cache TTL effects are partially modeled, while certificate and resolution-chain semantics remain incomplete.'
  },
  'consensus-and-coordination': {
    tier: 'guided',
    summary:
      'Locking, reservations, quorum membership, deterministic leader promotion, and conflict policies are modeled, while full consensus-protocol timing remains simplified.'
  },
  auxiliary: {
    tier: 'guided',
    summary:
      'Several auxiliary control nodes are real trait carriers, but others remain structural helpers rather than deep runtime models.'
  }
}

export const TRAIT_SUPPORT_LEDGER = {
  'cache.read-through': {
    tier: 'first-class',
    summary: 'Cache hit/miss behavior, TTL, and latency differences are modeled and test-covered.'
  },
  'cache.request-collapsing': {
    tier: 'first-class',
    summary:
      'Opt-in single-flight on cache nodes (sim.requestCollapsing): concurrent misses for the same request key park behind one in-flight leader fetch, so N simultaneous misses make one downstream call; followers complete when the leader returns (latency includes the wait) or fail with its cause. Needs keyed requests (source keyspace); the derived LRU fills on response, so a cold hot key shows the stampede it fixes. Waiter caps, lock timeouts, and stale-while-revalidate are not modeled.'
  },
  'routing.content-aware': {
    tier: 'first-class',
    summary: 'Content-based routing decisions are modeled and exposed as node behavior.'
  },
  'routing.health-aware': {
    tier: 'first-class',
    summary: 'Route filtering by observed health is modeled and test-covered.'
  },
  'routing.key-based': {
    tier: 'first-class',
    summary: 'Deterministic key-based routing and partition affinity proxies are modeled.'
  },
  'routing.dns-policy': {
    tier: 'first-class',
    summary:
      'Weighted, failover, and latency-aware DNS policy choices are modeled at the routing layer.'
  },
  'messaging.broadcast-fanout': {
    tier: 'guided',
    summary:
      'One-to-many fanout is modeled for broadcast brokers; stream-specific retention, partitions, and offset semantics live under stream.partitioned-broker.'
  },
  'routing.fanout-amplification': {
    tier: 'guided',
    summary:
      'An edge `fanoutFactor` amplifies each delivery into N recipient writes (e.g. one post → N follower feed writes), so the target genuinely receives N× load and can saturate; the amplification factor is a configured constant, not derived from a live subscriber/follower set.'
  },
  'edge.connection-model': {
    tier: 'guided',
    summary:
      'Opt-in per edge (edge.connection). New connections pay real handshake round trips (TCP 1, TLS 1.2 +2 or 1.3 +1, WebSocket upgrade +1, AMQP open +4, Kafka ApiVersions +1), each one sample of the edge latency; keep-alive reuses warm connections until an idle timeout, persistent keeps them open, per-request reopens every time; TLS resumption shortens later handshakes. Streams per connection follow the protocol (HTTPS/TCP 1, gRPC 100, Kafka 5, WebSocket/AMQP unlimited): a synchronous request holds its stream until its response returns, so at a full pool HTTP/1.1 requests wait in line while HTTP/2 multiplexes. Edges leaving the traffic source pool per client identity. Handshake CPU, certificate size, ticket expiry and per-replica pools are not modeled; unset keeps the historical always-warm assumption.'
  },
  'edge.producer-batching': {
    tier: 'guided',
    summary:
      "Opt-in on Kafka edges (edge.batching): records accumulate until batch.size bytes or linger.ms after the first record, then the batch is one transfer that takes one edge in-flight slot, one protocol overhead and one trip, with its total bytes on the link. Throughput under the in-flight cap and each record's batch wait are measured, not declared. Compression, acks levels, buffer.memory back-pressure and per-partition batches are not modeled."
  },
  'stream.partitioned-broker': {
    tier: 'first-class',
    summary:
      'Partition-affine routing, one delivery per configured consumer group, offset commits, scheduled retention expiry, replay reads, group lag, rebalancing, and broker availability are modeled; multi-broker replication is not.'
  },
  'queue.ack-and-release': {
    tier: 'guided',
    summary:
      'Async queue receive, visibility timeout, redelivery, and DLQ handoff are modeled, but end-to-end exactly-once is not.'
  },
  'coordination.idempotency-dedup': {
    tier: 'guided',
    summary:
      'Time-window duplicate suppression, commit-outcome journal transitions, and modeled authoritative external reconciliation probes are modeled, but live provider I/O and cross-node exactly-once consensus are not.'
  },
  'coordination.lock-lease': {
    tier: 'guided',
    summary:
      'Per-key lock acquisition, TTL, and contention are modeled, but full distributed correctness proofs are not.'
  },
  'storage.reservation-store': {
    tier: 'first-class',
    summary:
      'Reservation state and guard-store behavior are modeled as first-class runtime effects.'
  },
  'storage.consistency-model': {
    tier: 'guided',
    summary:
      "Opt-in on replicated SQL/NoSQL datastores (sim.consistencyModel): writes the leader serves commit a new version of their request key, followers apply it after the configured replica lag (quorum-acked writes at commit), and reads observe the version their node has applied. Follower reads wait for replication catch-up as the model requires (strong: newest committed; read-your-writes: the session's acknowledged writes; monotonic reads: the session's newest read), so the cost is measured read latency and worker time. Oracles count stale reads, read-your-writes and monotonic-read violations (sessions come from workload.sessions) and run a single-key register linearizability check over at most 100 recorded ops per key for the first 200 keys, reporting the rest as not checked. Leader round trips for follower reads, quorum membership, variable lag, and multi-key transactions are not modeled."
  },
  'access.read-write-split': {
    tier: 'first-class',
    summary: 'Read and write paths can diverge with distinct latency behavior and routing rules.'
  },
  'access.read-only': {
    tier: 'first-class',
    summary: 'Read-only rejection behavior is modeled and test-covered.'
  },
  'resilience.retry-backoff': {
    tier: 'first-class',
    summary: 'Retry timing, capped backoff, and jitter behavior are modeled.'
  },
  'resilience.circuit-breaker': {
    tier: 'first-class',
    summary: 'Breaker open/close state and rejection behavior are modeled and observable.'
  },
  'resilience.bulkhead': {
    tier: 'first-class',
    summary:
      'Per-compartment (request type or metadata key) caps on requests held at a node, with fast bulkhead_full rejection, are modeled and observable.'
  },
  'resilience.load-shedding': {
    tier: 'first-class',
    summary:
      'Arrival-time shedding on queue depth or estimated queueing delay, with fast load_shed rejection, is modeled and observable.'
  },
  'compute.autoscaler': {
    tier: 'first-class',
    summary:
      'A utilization-target control loop resizes instance count every cooldown, bounded by min and max.'
  },
  'scheduler.cluster': {
    tier: 'guided',
    summary:
      'Opt-in on a Kubernetes Cluster node whose instances are its worker machines. Workloads that name it in sim.scheduledOn run as pods requesting their instance type (vCPU and RAM); pods are bin-packed (spread or bin-pack scoring) and a pod that fits nowhere stays pending and serves nothing, so capacity follows cluster size and fragmentation. Autoscaler scale-ups become pending pods when the cluster is full; pods start after a pod-startup delay; a machine failure drops its pods at once and replacements appear only after detection + eviction (Kubernetes default 340s) and need room; optional cluster autoscaling boots machines after a delay. Time-weighted ready replicas, pending pods, allocation and measured recovery time are reported. Requests vs limits, system-reserved overhead, affinity/taints/preemption, scale-down of machines and control-plane limits are not modeled; in-flight requests on a lost pod drain rather than reset.'
  },
  'scheduler.workload': {
    tier: 'guided',
    summary:
      'A scheduled workload serves with its ready pods only; with none ready it refuses requests (no_ready_replicas). Billed as the cluster machines, not per pod.'
  },
  'observability.telemetry-sink': {
    tier: 'guided',
    summary:
      'Opt-in fire-and-forget ingest on log/metric/trace collectors (sim.telemetryAsyncIngest): events past an events/s ceiling or a full collector buffer are dropped and counted (telemetryDropped) instead of failing as requests, and head sampling keeps unexported events off the collector. Dropped events do not count as processed. Exporter batching, tail sampling, retention and query cost are not modeled.'
  },
  'stream.change-ordering': {
    tier: 'guided',
    summary:
      'Opt-in on a partitioned Event Stream (sim.changeStreamOrdering): change events are numbered per entity in receive order and a consumer applying an older change after a newer one is counted (changeOrderViolations). Violations come from concurrent processing of one entity: parallel consumers, or a partition key that is not the entity key. consumerOrdering per-partition / per-key holds later deliveries until the earlier one finishes, removing violations at a measured throughput cost. CDC capture lag from the database log, producer-side reordering and version-checked writes are not modeled.'
  },
  'realtime.persistent-connection-fanout': {
    tier: 'guided',
    summary:
      'Node side of held connections (the edge connection model already covers per-edge reuse, handshakes and WebSocket persistence; fanoutFactor covers N downstream writes). A gateway that declares offered connections holds up to maxConnectionsPerInstance x instances and as many as fit in RAM (memPerConnectionKb), refusing the rest; held connections pin RAM before request admission and keepalive heartbeats take cores before request work and count in CPU utilization. pushRecipients makes each message a write to that many sockets as on-core work that stretches under contention; recipients whose connection was refused are counted undeliverable. Connect/reconnect storms, slow-consumer send buffers and inter-gateway routing are not modeled.'
  },
  'control.rate-limiter': {
    tier: 'first-class',
    summary:
      'Shared rate-limiter behavior and request rejection are modeled with explicit controls.'
  },
  'performance.cold-start': {
    tier: 'first-class',
    summary: 'Cold-start penalties and idle-time rewarming behavior are modeled.'
  },
  'capacity.memory-pressure': {
    tier: 'first-class',
    summary: 'Memory-bound slowdown, GC pressure, and OOM behavior are modeled.'
  },
  'observability.consumer-lag': {
    tier: 'first-class',
    summary: 'Lag proxies are recorded from queue depth and in-system totals.'
  },
  'storage.profile': {
    tier: 'first-class',
    summary:
      'Different storage profiles can project distinct latency shapes for reads, writes, queries, scans, or ingest.'
  },
  'streaming-broker.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'observability-sink.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'network-gateway.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'health-check-manager.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'llm-gateway.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'agent-orchestrator.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'memory-fabric.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'tool-registry.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  },
  'safety-observability-mesh.honesty': {
    tier: 'presentational-only',
    summary: 'This is an honesty note, not a runtime trait.'
  }
} as const satisfies Record<string, SupportLedgerEntry>

export const CONCEPT_SUPPORT_LEDGER = {
  'read-cache': {
    tier: 'first-class',
    summary: 'Read-heavy cache placement and miss penalties are strong simulator territory.'
  },
  'request-collapsing': {
    tier: 'first-class',
    summary:
      'Thundering-herd misses on a hot key and single-flight collapsing are measurable: downstream calls drop to about one per key per in-flight window while the hit rate stays the same.'
  },
  'store-fit': {
    tier: 'first-class',
    summary: 'Store-choice questions map well to semantic criteria and runtime load.'
  },
  'async-decoupling': {
    tier: 'first-class',
    summary:
      'Moving synchronous work behind queues and workers is directly visible in latency and backlog.'
  },
  fanout: {
    tier: 'first-class',
    summary: 'Broadcast versus queue semantics are teachable through structure and runtime.'
  },
  'baseline-optimization': {
    tier: 'first-class',
    summary: 'Optimize-from-baseline questions fit the current grading and runtime model well.'
  },
  'scaffold-repair': {
    tier: 'first-class',
    summary: 'Repair-the-architecture questions are well supported by the current grading stack.'
  },
  'rate-limiting': {
    tier: 'guided',
    summary:
      'Rate limiting behavior is modeled, but shared-state correctness and algorithm tradeoffs still need honest framing.'
  },
  'circuit-breaking': {
    tier: 'guided',
    summary:
      'Breaker behavior is modeled, but resilience outcomes still simplify real replication and failover.'
  },
  bulkhead: {
    tier: 'guided',
    summary:
      'Compartment caps at a node are modeled; per-downstream-dependency pools are not, because a node frees its worker before forwarding.'
  },
  'load-shedding': {
    tier: 'guided',
    summary:
      'Shedding new arrivals on queue depth or queueing delay is modeled; evicting already-queued requests and adaptive concurrency limits are not.'
  },
  'retry-backoff': {
    tier: 'guided',
    summary: 'Retry timing is modeled, but end-to-end delivery guarantees remain partial.'
  },
  'health-aware-routing': {
    tier: 'guided',
    summary:
      'Observed-health routing exists, but active probing and control-plane-driven eviction are still simplified.'
  },
  'dns-routing': {
    tier: 'guided',
    summary:
      'DNS policy choices are teachable, but full recursive resolution and global routing semantics are not.'
  },
  idempotency: {
    tier: 'guided',
    summary:
      'Duplicate suppression, commit journals, and modeled authoritative reconciliation probes expose confirmed versus unknown outcomes, but do not prove full exactly-once correctness by themselves.'
  },
  'lock-contention': {
    tier: 'guided',
    summary:
      'Contention and lease behavior are visible, but correctness judgments still need structural framing.'
  },
  'exactly-once': {
    tier: 'structural-only',
    summary:
      'Exactly-once can be taught through guarded paths and durable ledgers, but the runtime does not yet prove the guarantee.'
  },
  'l4-vs-l7': {
    tier: 'guided',
    summary:
      'The simulator distinguishes L4 pass-through from L7 content rejection, HTTP acknowledgements, sessions, and streaming flow control; full transport-stack physics remains out of scope.'
  },
  'consumer-groups': {
    tier: 'first-class',
    summary:
      'One delivery per configured consumer group, committed offsets, replay reads, rebalancing, and group-specific lag are first-class runtime behavior for stream brokers.'
  },
  'message-ordering': {
    tier: 'guided',
    summary:
      'Per-partition stream ordering is modeled for broker delivery and replay; global cross-partition ordering is not guaranteed. With change ordering on, out-of-order applies per entity are counted and per-partition / per-key ordered consumption is available.'
  },
  'cluster-scheduling': {
    tier: 'guided',
    summary:
      'Bin-packing replicas onto a finite machine pool is measurable: pending pods add no capacity, scale-ups stall on a full cluster, and machine failures show detection, eviction and restart time.'
  },
  quorum: {
    tier: 'guided',
    summary:
      'Replica quorum acknowledgement and quorum-unavailable evidence are modeled, but formal consensus safety is not proved.'
  },
  consensus: {
    tier: 'guided',
    summary:
      'Consensus protocol labels, quorum membership, durable indexes, and deterministic leader promotion are modeled; real election timing and log conflict resolution are simplified.'
  },
  linearizability: {
    tier: 'guided',
    summary:
      'Datastores with a consistency model record per-key read/write histories and run a real single-key register linearizability check (Wing and Gong search) within a bound of 100 ops per key and 200 keys; consistency.linearizabilityViolations counts failing keys and consistency.linearizableVerified is 1 only when nothing was left unchecked. Multi-key (transactional) linearizability is not checked.'
  },
  'read-consistency': {
    tier: 'guided',
    summary:
      'Eventual, monotonic-read, read-your-writes, and strong reads on replicated datastores, with stale-read and session-guarantee oracles gradable as consistency.staleReads, consistency.readYourWritesViolations, and consistency.monotonicReadViolations; the latency cost of stronger models is measured catch-up wait.'
  },
  'protocol-semantics': {
    tier: 'guided',
    summary:
      'Session lifecycle, HTTP acknowledgement timing, L7 rejection, and streaming flow-control evidence are modeled; packet-level protocol behavior remains simplified.'
  },
  'requirements-first': {
    tier: 'guided',
    summary:
      'The authoring contract exists, but the learner-facing staged workflow is not yet fully productized.'
  },
  'locked-lab': {
    tier: 'guided',
    summary:
      'The abstraction exists and validator support exists, but the visible product surface remains intentionally hidden.'
  }
} as const satisfies Record<string, SupportLedgerEntry>

export type KnownTraitSupportKey = keyof typeof TRAIT_SUPPORT_LEDGER
export type KnownQuestionConcept = keyof typeof CONCEPT_SUPPORT_LEDGER

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

export function getDomainSupport(domain: QuestionDomain): SupportLedgerEntry {
  return DOMAIN_SUPPORT_LEDGER[domain]
}

export function getComponentCategorySupport(category: ComponentCategory): SupportLedgerEntry {
  return COMPONENT_CATEGORY_SUPPORT_LEDGER[category]
}

export function getTraitSupport(traitName: string): SupportLedgerEntry | null {
  return TRAIT_SUPPORT_LEDGER[normalizeKey(traitName) as KnownTraitSupportKey] ?? null
}

export function getConceptSupport(concept: string): SupportLedgerEntry | null {
  return CONCEPT_SUPPORT_LEDGER[normalizeKey(concept) as KnownQuestionConcept] ?? null
}

export function supportTierNeedsAuthorWarning(tier: SupportTier): boolean {
  return tier !== 'first-class'
}

export function buildSupportLedgerMessage(subject: string, entry: SupportLedgerEntry): string {
  return `${subject} is currently ${entry.tier}: ${entry.summary}`
}
