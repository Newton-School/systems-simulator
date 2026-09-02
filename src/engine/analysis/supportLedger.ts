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
      'Edge latency, packet loss, protocol overhead, HTTP acknowledgements, session lifecycle markers, and L4-versus-L7 rejection/flow-control behavior are modeled, while bandwidth and pool limits remain simplified.',
    simulates: [
      'edge latency',
      'edge packet loss',
      'basic protocol overhead',
      'HTTP acknowledgements',
      'session lifecycle',
      'L4/L7 divergence'
    ],
    deferred: ['bandwidth enforcement', 'connection-pool limits', 'full transport-stack physics']
  },
  resilience: {
    tier: 'guided',
    summary:
      'Retries, circuit breakers, health-aware routing, failure windows, deterministic replica promotion, and quorum availability are modeled, with physical consensus timing still simplified.',
    simulates: [
      'retry backoff',
      'circuit breaker state',
      'health-aware routing',
      'status timelines',
      'replica failover',
      'quorum availability'
    ],
    deferred: ['packet-level replication', 'real Raft election timing', 'Byzantine consensus']
  },
  correctness: {
    tier: 'guided',
    summary:
      'Guarded paths, lock contention, duplicate suppression, commit-outcome journaling, modeled external reconciliation, and quorum commit evidence are teachable, but exactly-once and linearizability are not formally proved.',
    simulates: [
      'lock contention',
      'duplicate suppression',
      'commit outcome journal transitions',
      'guarded write paths',
      'modeled external outcome probes',
      'quorum commit evidence'
    ],
    inferred: ['topology proxies', 'justification-backed decisions'],
    deferred: ['exactly-once commit coordination', 'formal linearizability proof']
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
      'Per-partition stream ordering is modeled for broker delivery and replay; global cross-partition ordering is not guaranteed.'
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
    tier: 'deferred',
    summary: 'Linearizability is not a first-class runtime or grading surface today.'
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
