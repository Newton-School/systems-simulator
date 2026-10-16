# System Design Teaching Concept Taxonomy

Status: research-backed curriculum inventory, 2026-10-15

## Purpose and scope

This is a living inventory of concepts that can reasonably appear in a system-design
course, interview, lab, architecture review, or simulator question. It is deliberately
broader than the simulator's current component catalog. Its jobs are to:

- prevent question authoring from being anchored to one example such as QuickCart;
- give Classroom and Question Studio a stable curriculum vocabulary;
- distinguish a teachable concept from a product or cloud-service name;
- identify the smallest honest teaching surface for each concept; and
- expose gaps that require a new card, control, check, scenario, metric, or engine model.

No static list can be literally exhaustive: the field changes, and domain-specific
systems introduce new combinations. This taxonomy aims for category completeness and
is designed to accept new leaf concepts without reorganizing the whole curriculum.

## Teaching-surface legend

These are recommended pedagogical surfaces, not claims of current implementation.

- **C — Classroom:** concept cards, topology, locked givens, simple arithmetic, named
  choices, and lesson-language checks are sufficient.
- **G — Guided:** the learner should change a small number of curated controls while
  the rest of the system remains locked.
- **A — Architect:** full scenarios, runtime semantics, failures, detailed resources,
  or advanced grading are required.
- **X — Explanation or external lab:** discussion, proof, code, packet, database, or
  formal-method tooling is a more honest teaching surface than the current simulator.

A concept can support more than one surface. For example, replication placement is a
Classroom structural lesson, replica lag is Guided/Architect, and a proof of a consensus
algorithm belongs in an external formal-method lab.

## 1. Problem framing and architecture reasoning

- **PF-01 [C] Stakeholders and actors:** end users, administrators, operators,
  developers, partners, regulators, attackers, and dependent systems.
- **PF-02 [C] Functional requirements:** primary use cases, secondary use cases,
  control-plane operations, data-plane operations, and explicit non-goals.
- **PF-03 [C] Quality attributes:** availability, reliability, latency, throughput,
  scalability, durability, consistency, security, privacy, operability,
  maintainability, evolvability, portability, usability, cost, and sustainability.
- **PF-04 [C] Constraints:** time, team, budget, legacy integration, regulation,
  geography, data residency, hardware, network, vendor, and migration constraints.
- **PF-05 [C] Assumptions and unknowns:** documenting uncertain inputs, sensitivity
  analysis, risk-bearing assumptions, and questions that change the design.
- **PF-06 [C] Prioritization:** must/should/could, critical user journeys, tiering,
  graceful degradation priorities, and minimum viable architecture.
- **PF-07 [C/G] Trade-off reasoning:** benefit, cost, failure mode, reversibility,
  blast radius, operational burden, and second-order effects of a decision.
- **PF-08 [C] Architecture communication:** context, container, component, deployment,
  data-flow, sequence, state, failure, and trust-boundary diagrams.
- **PF-09 [G] Architecture decisions:** ADRs, alternatives considered, decision drivers,
  consequences, expiry/revisit criteria, and fitness functions.
- **PF-10 [G/A] Evolution planning:** current state, target state, transition states,
  strangler migration, coexistence, rollback, and decommissioning.

## 2. Scale estimation and capacity planning

- **SC-01 [C] Traffic estimation:** requests per second, peak-to-average ratio, burst
  size, seasonality, diurnal patterns, organic growth, and launch events.
- **SC-02 [C] User estimation:** daily/monthly active users, concurrency, session
  length, think time, fan-out per action, and geographic distribution.
- **SC-03 [C] Data-volume estimation:** object count, row/document size, metadata,
  indexes, replication overhead, retention, and annual growth.
- **SC-04 [C] Bandwidth estimation:** ingress, egress, inter-service, replication,
  backup, media bitrate, compression, and protocol overhead.
- **SC-05 [C/G] Compute estimation:** service time, concurrency, CPU time, memory,
  accelerators, worker count, throughput per copy, utilization target, and headroom.
- **SC-06 [C/G] Queueing intuition:** arrival rate, service rate, Little's Law,
  utilization, queue depth, waiting time, concurrency, and saturation knee.
- **SC-07 [G/A] Queueing models:** M/M/1, M/M/c, bounded queues, burst absorption,
  priority queues, head-of-line blocking, and non-Poisson workloads.
- **SC-08 [C/G] Capacity margins:** N, N+1, N+2, quorum margin, zone loss, region loss,
  failover capacity, maintenance capacity, and recovery surge.
- **SC-09 [G/A] Autoscaling:** horizontal, vertical, scheduled, predictive, event-driven,
  control-loop delay, cooldown, hysteresis, cold starts, and scaling oscillation.
- **SC-10 [G/A] Load and performance testing:** baseline, stress, spike, soak, breakpoint,
  failover, capacity envelope, coordinated omission, and representative workloads.

## 3. Architecture styles and decomposition

- **AS-01 [C] Monoliths:** modular monolith, deployment unit, shared state, simple
  transactions, scaling constraints, and appropriate use cases.
- **AS-02 [C/G] Layered and n-tier systems:** presentation, application, domain, data,
  dependency direction, and deployment boundaries.
- **AS-03 [C/G] Microservices:** bounded services, independent deployment, decentralized
  data, operational cost, network failure, and service sprawl.
- **AS-04 [C/G] Service-oriented architecture:** enterprise service bus, contracts,
  orchestration, governance, and differences from microservices.
- **AS-05 [C] Event-driven architecture:** producers, consumers, events, commands,
  notification versus event-carried state transfer, and temporal decoupling.
- **AS-06 [C/G] Serverless architecture:** functions, managed events, cold starts,
  statelessness, concurrency limits, duration limits, and cost shape.
- **AS-07 [G/A] Data-intensive styles:** Lambda architecture, Kappa architecture,
  batch plus serving, streaming-first processing, and materialized views.
- **AS-08 [G] Hexagonal/clean architecture:** ports, adapters, dependency inversion,
  testability, and isolation of infrastructure concerns.
- **AS-09 [G] Domain-driven decomposition:** domains, subdomains, bounded contexts,
  aggregates, context maps, ubiquitous language, and team ownership.
- **AS-10 [G] Cell-based architecture:** self-contained cells, tenant or traffic
  partitioning, blast-radius reduction, routing, and cell imbalance.
- **AS-11 [G] Control plane versus data plane:** separate scaling, availability,
  consistency, security, and failure requirements.
- **AS-12 [C/G] Buy, build, or managed service:** differentiation, lock-in, compliance,
  integration, operability, and total cost of ownership.

## 4. API and interface design

- **API-01 [C/G] Resource-oriented APIs:** resources, identifiers, collections,
  relationships, filtering, sorting, pagination, and partial responses.
- **API-02 [G] RPC and procedure-oriented APIs:** commands, schemas, generated clients,
  deadlines, streaming RPC, and coupling.
- **API-03 [G] Graph query APIs:** client-selected fields, resolver fan-out, batching,
  authorization, depth limits, cost limits, and schema evolution.
- **API-04 [C/G] Request semantics:** safe operations, idempotency, idempotency keys,
  conditional requests, retries, duplicate suppression, and replay.
- **API-05 [G] Contracts and schemas:** validation, optionality, defaults, compatibility,
  additive changes, consumer-driven contracts, and schema registry.
- **API-06 [G] Versioning and evolution:** URI/header/schema versions, deprecation,
  compatibility windows, feature negotiation, and migration.
- **API-07 [C/G] Pagination:** offset, cursor, keyset, stable ordering, continuation
  tokens, concurrent mutation, and deep-page cost.
- **API-08 [G] Long-running operations:** asynchronous request-reply, job resources,
  polling, webhooks, callbacks, cancellation, and progress.
- **API-09 [G] Real-time interfaces:** WebSocket, server-sent events, long polling,
  bidirectional streams, backpressure, reconnect, and presence.
- **API-10 [G] API gateways and backends-for-frontends:** routing, aggregation,
  authentication, authorization, quotas, transformation, and client specialization.
- **API-11 [G] Error models:** status codes, machine-readable errors, retryability,
  partial success, validation details, correlation IDs, and localization.
- **API-12 [A/X] Protocol design:** framing, serialization, negotiation, flow control,
  compatibility, formal state machines, and protocol ossification.

## 5. Networking, naming, and edge delivery

- **NET-01 [C/G] Addressing and naming:** IP addresses, ports, DNS, service discovery,
  registration, health, TTLs, caching, and stale records.
- **NET-02 [G/X] Transport fundamentals:** TCP, UDP, QUIC, connection setup, reliability,
  ordering, congestion control, multiplexing, and head-of-line blocking.
- **NET-03 [G] Application protocols:** HTTP versions, TLS, gRPC, WebSocket, MQTT,
  protocol selection, connection reuse, and message size.
- **NET-04 [C/G] Proxies and gateways:** forward proxy, reverse proxy, ingress, egress,
  API gateway, service mesh proxy, and trust termination.
- **NET-05 [C/G] Load balancing:** L4/L7, round-robin, least-connections, weighted,
  hash-based, locality-aware, health-aware, global, and client-side balancing.
- **NET-06 [G] Session affinity:** cookies, source hashing, state locality, rebalance,
  failover, hot spots, and alternatives to stickiness.
- **NET-07 [C/G] CDN and edge caching:** points of presence, origin shielding, cache keys,
  TTL, purge, stale serving, signed URLs, and dynamic acceleration.
- **NET-08 [G/A] Network failure:** delay, jitter, loss, duplication, reordering,
  partitions, asymmetric reachability, black holes, and gray failures.
- **NET-09 [G] Network topology:** regions, zones, VPC/VNet, subnets, routing tables,
  NAT, peering, private links, transit, and egress control.
- **NET-10 [G] Service discovery and mesh:** registry, sidecar/ambient data plane,
  mTLS, retries, traffic policy, telemetry, and control-plane failure.
- **NET-11 [G] Edge security:** DDoS absorption, WAF, bot management, rate limits,
  geo restrictions, TLS termination, and origin protection.
- **NET-12 [A/X] Packet-level performance:** MTU, fragmentation, retransmission,
  bandwidth-delay product, socket buffers, and kernel/network offload.

## 6. Compute, concurrency, and resource management

- **CMP-01 [C/G] Stateless and stateful compute:** local state, external state,
  replaceability, affinity, recovery, and scaling implications.
- **CMP-02 [C/G] Horizontal versus vertical scaling:** capacity, limits, availability,
  cost, partitionability, and operational complexity.
- **CMP-03 [G] Processes, threads, event loops, and coroutines:** concurrency models,
  blocking, scheduling, context switches, and workload fit.
- **CMP-04 [G/A] Resource bottlenecks:** CPU, memory, disk IOPS, disk throughput,
  network, file descriptors, threads, connections, and accelerators.
- **CMP-05 [G/A] Resource isolation:** requests, limits, quotas, cgroups, noisy neighbors,
  priority, preemption, and admission control.
- **CMP-06 [G] Scheduling:** bin packing, spread, affinity, anti-affinity, taints,
  priorities, topology constraints, data locality, and gang scheduling.
- **CMP-07 [G] Batch processing:** jobs, task graphs, partitioning, stragglers,
  speculative execution, checkpoints, retries, and work stealing.
- **CMP-08 [G/A] Parallel computation:** data parallelism, task parallelism, pipelines,
  map/reduce, scatter-gather, fork-join, and synchronization barriers.
- **CMP-09 [G] Serverless execution:** concurrency, cold/warm instances, event sources,
  ephemeral storage, time limits, and poison events.
- **CMP-10 [G/A] Accelerated compute:** GPU/TPU allocation, batching, model placement,
  memory bandwidth, interconnect, and utilization.
- **CMP-11 [G] Backpressure and admission:** bounded concurrency, semaphores, queues,
  token buckets, load shedding, and overload signals.
- **CMP-12 [G/A] Runtime behavior:** garbage collection, memory fragmentation,
  connection pools, thread pools, caches, and warmup.

## 7. Data modeling and storage selection

- **DATA-01 [C/G] Access-pattern-first design:** reads, writes, scans, updates, joins,
  aggregations, latency, scale, and consistency requirements.
- **DATA-02 [C/G] Relational modeling:** entities, relations, keys, normalization,
  denormalization, constraints, joins, and referential integrity.
- **DATA-03 [C/G] Key-value modeling:** keys, values, namespaces, access locality,
  conditional updates, and limitations.
- **DATA-04 [C/G] Document modeling:** aggregates, embedding, references, schema
  flexibility, update granularity, and document growth.
- **DATA-05 [G] Wide-column modeling:** partition keys, clustering keys, sparse rows,
  query-driven tables, and write amplification.
- **DATA-06 [G] Graph modeling:** vertices, edges, properties, traversals, supernodes,
  path queries, and graph partitioning.
- **DATA-07 [G] Time-series modeling:** timestamps, tags, high-cardinality dimensions,
  rollups, retention, downsampling, and late data.
- **DATA-08 [G] Geospatial modeling:** coordinates, cells, geohash/S2-like indexing,
  proximity, bounding regions, routing, and spatial joins.
- **DATA-09 [G] Blob/object/file storage:** object identifiers, metadata, multipart
  upload, immutability, lifecycle, range reads, and namespace semantics.
- **DATA-10 [G] Search indexes:** inverted indexes, analyzers, tokenization, ranking,
  shards, replicas, refresh, and index lag.
- **DATA-11 [G] Vector storage:** embeddings, exact versus approximate nearest neighbor,
  distance metrics, filtering, index build, recall, and freshness.
- **DATA-12 [C/G] Polyglot persistence:** selecting stores per access pattern,
  duplication, synchronization, governance, and operational cost.
- **DATA-13 [G] Metadata and schema:** catalog, lineage, ownership, compatibility,
  quality, discoverability, and governance.
- **DATA-14 [G/A] Data lifecycle:** creation, hot/warm/cold tiers, archival, retention,
  legal hold, deletion, compaction, and restoration.

## 8. Query processing and indexing

- **QRY-01 [G/X] Index structures:** B-tree/B+ tree, hash, LSM tree, bitmap, inverted,
  spatial, bloom filters, and learned indexes.
- **QRY-02 [G] Index design:** selectivity, composite keys, covering indexes, ordering,
  write cost, storage cost, and maintenance.
- **QRY-03 [G/A] Query execution:** scans, seeks, joins, sorts, aggregation, plans,
  statistics, cardinality estimation, and plan regressions.
- **QRY-04 [G/A] Distributed queries:** partition pruning, scatter-gather, exchanges,
  shuffles, partial aggregation, coordinator bottlenecks, and stragglers.
- **QRY-05 [G] OLTP versus OLAP:** point operations, short transactions, scans,
  columnar storage, vectorized execution, and workload isolation.
- **QRY-06 [G] Row versus column storage:** locality, compression, updates, projections,
  and analytical scan efficiency.
- **QRY-07 [G/A] Materialization:** materialized views, precomputation, incremental
  maintenance, freshness, invalidation, and storage trade-offs.
- **QRY-08 [G] Data federation:** query pushdown, heterogeneous sources, schema mapping,
  consistency, performance, and governance.
- **QRY-09 [G/A] Approximate computation:** sampling, sketches, HyperLogLog-like
  cardinality, quantiles, error bounds, and cost/accuracy trade-offs.

## 9. Caching and content reuse

- **CACHE-01 [C/G] Cache placement:** browser, device, CDN, gateway, application,
  distributed cache, database buffer, and result cache.
- **CACHE-02 [C/G] Cache-aside, read-through, write-through, write-behind, and
  refresh-ahead patterns.**
- **CACHE-03 [G] Cache keys:** normalization, versioning, tenant/user dimensions,
  authorization context, locale, device, and query parameters.
- **CACHE-04 [G] Expiration and invalidation:** TTL, explicit purge, versioned keys,
  event-driven invalidation, dependency tracking, and stale-while-revalidate.
- **CACHE-05 [G/A] Eviction:** LRU, LFU, FIFO, random, size-aware, admission policies,
  memory pressure, and working sets.
- **CACHE-06 [G/A] Cache failure modes:** stampede, penetration, avalanche, hot keys,
  stale data, split caches, cache poisoning, and origin overload.
- **CACHE-07 [G] Stampede protection:** request coalescing, single-flight, leases,
  probabilistic early refresh, jittered TTLs, and stale serving.
- **CACHE-08 [G] Consistency trade-offs:** read-after-write, stale reads, invalidation
  races, local versus shared caches, and cache/database ordering.
- **CACHE-09 [G] Negative and semantic caching:** absence caching, error caching,
  approximate equivalence, privacy boundaries, and false matches.
- **CACHE-10 [C/G] Hit-rate economics:** hit ratio, miss penalty, object popularity,
  cache size, latency, origin offload, and cost.

## 10. Partitioning and sharding

- **PART-01 [C/G] Why partition:** capacity limits, throughput, storage, locality,
  isolation, ownership, and administrative boundaries.
- **PART-02 [G] Horizontal, vertical, functional, directory-based, and tenant-based
  partitioning.**
- **PART-03 [G] Range, hash, consistent-hash, rendezvous-hash, geographic, and
  composite partitioning.**
- **PART-04 [G] Partition-key design:** cardinality, evenness, locality, query fit,
  monotonic keys, time buckets, and tenant skew.
- **PART-05 [G/A] Hot partitions and hot keys:** skew detection, salting, splitting,
  replication, caching, isolation, and adaptive routing.
- **PART-06 [G/A] Rebalancing:** virtual nodes, shard splitting/merging, data movement,
  throttling, dual routing, and consistency during migration.
- **PART-07 [G] Cross-shard operations:** scatter-gather reads, global indexes,
  distributed joins, aggregations, transactions, and referential constraints.
- **PART-08 [G] Resharding and growth:** online migration, shadow writes, backfill,
  checkpoints, validation, cutover, and rollback.
- **PART-09 [G] Partition-aware identifiers:** natural keys, synthetic keys, sortable
  IDs, embedded shard hints, opacity, and hotspot risk.
- **PART-10 [G/A] Multi-level partitioning:** region, cell, tenant, shard, replica,
  and physical storage hierarchy.

## 11. Replication, durability, and availability

- **REP-01 [C/G] Replication purpose:** availability, durability, read scale,
  geographic proximity, backup, analytics, and isolation.
- **REP-02 [C/G] Leader-follower, multi-leader, and leaderless replication.**
- **REP-03 [G/A] Synchronous, semi-synchronous, and asynchronous replication:**
  latency, acknowledged durability, data loss, and availability.
- **REP-04 [G/A] Quorums:** N/R/W, majority, flexible quorums, sloppy quorums,
  quorum intersection, and failure tolerance.
- **REP-05 [G/A] Replica lag:** measurement, bounded staleness, read-your-writes,
  monotonic reads, lag-aware routing, and catch-up.
- **REP-06 [G/A] Conflict handling:** last-write-wins, version vectors, merge functions,
  CRDTs, application reconciliation, and user-visible conflicts.
- **REP-07 [G/A] Anti-entropy and repair:** read repair, background repair, Merkle trees,
  hinted handoff, tombstones, and garbage collection.
- **REP-08 [G] Failover:** detection, promotion, fencing, split brain, DNS/routing change,
  client reconnection, and failback.
- **REP-09 [G] Durability mechanisms:** write-ahead log, fsync, checksums, replication,
  erasure coding, snapshots, backup, and immutable storage.
- **REP-10 [G/A] Data-loss windows:** RPO, acknowledged writes, regional disasters,
  corruption, latent faults, and recovery validation.
- **REP-11 [G] Backups versus replicas:** correlated corruption, point-in-time recovery,
  air gaps, retention, restore drills, and backup integrity.
- **REP-12 [A/X] Erasure coding:** data/parity fragments, reconstruction, storage
  efficiency, repair bandwidth, and small-object trade-offs.

## 12. Consistency, concurrency, and transactions

- **CONS-01 [C/G] Consistency vocabulary:** strong, eventual, causal, sequential,
  linearizable, serializable, and externally consistent behavior.
- **CONS-02 [G/A] Client/session guarantees:** read-your-writes, monotonic reads,
  monotonic writes, writes-follow-reads, and consistent prefix.
- **CONS-03 [G/A] CAP reasoning:** partitions, availability, consistency, operation-level
  choices, and why normal-operation latency still matters.
- **CONS-04 [G] PACELC reasoning:** partition trade-offs and latency/consistency
  trade-offs when the system is healthy.
- **CONS-05 [G/A] ACID transactions:** atomicity, consistency, isolation, durability,
  transaction boundaries, and business invariants.
- **CONS-06 [G/A] Isolation levels and anomalies:** dirty reads/writes, non-repeatable
  reads, lost updates, read/write skew, phantoms, and serializability.
- **CONS-07 [G/A] Concurrency control:** locks, two-phase locking, MVCC, optimistic
  concurrency, compare-and-swap, validation, and deadlocks.
- **CONS-08 [G/A] Distributed transactions:** two-phase commit, coordinator failure,
  blocking, three-phase ideas, consensus-backed commit, and recovery.
- **CONS-09 [G/A] Sagas:** orchestration, choreography, compensating actions,
  semantic rollback, isolation problems, and observability.
- **CONS-10 [G/A] Idempotency and deduplication:** request IDs, inbox/outbox tables,
  replay windows, result caching, and side-effect boundaries.
- **CONS-11 [G/A] Ordering:** per-key, per-partition, causal, total, global, event time,
  processing time, reordering buffers, and late events.
- **CONS-12 [A/X] Correctness testing:** histories, linearizability checking,
  serializability checking, invariant checking, and bounded claims.

## 13. Distributed coordination, time, and consensus

- **COORD-01 [G/X] Distributed-system models:** processes, messages, partial failure,
  asynchronous/synchronous timing assumptions, and failure detectors.
- **COORD-02 [G/X] Time and clocks:** wall clocks, monotonic clocks, skew, drift,
  synchronization, leap events, and uncertainty intervals.
- **COORD-03 [G/X] Logical time:** Lamport clocks, vector clocks, happens-before,
  causality, concurrent events, and hybrid logical clocks.
- **COORD-04 [G/A] Leader election:** leases, terms/epochs, failure detection,
  split-brain prevention, fencing tokens, and re-election.
- **COORD-05 [G/A] Distributed locks and leases:** ownership, expiry, renewal,
  fencing, lock service failure, and safety versus liveness.
- **COORD-06 [A/X] Consensus:** agreement, validity, termination, quorum, replicated
  logs, state-machine replication, and minority failure.
- **COORD-07 [A/X] Paxos-family concepts:** proposer/acceptor/learner roles, ballots,
  quorum intersection, Multi-Paxos, and reconfiguration.
- **COORD-08 [A/X] Raft-family concepts:** terms, leader election, log matching,
  commit index, snapshots, membership change, and safety.
- **COORD-09 [G/A] Coordination services:** naming, configuration, membership,
  leader election, locks, watches, and ephemeral nodes.
- **COORD-10 [A/X] Impossibility and limits:** FLP intuition, Byzantine versus crash
  faults, failure-detector assumptions, and coordination cost.
- **COORD-11 [A/X] Byzantine fault tolerance:** quorum sizes, equivocation, signatures,
  view changes, finality, and performance costs.
- **COORD-12 [G/A] Distributed identifiers:** UUID variants, sequence services,
  timestamp-based IDs, clock rollback, collision, ordering, and information leakage.

## 14. Messaging, queues, and asynchronous work

- **MSG-01 [C] Synchronous versus asynchronous processing:** coupling, latency,
  availability, buffering, user feedback, and operational complexity.
- **MSG-02 [C/G] Queue topology:** producer, broker, consumer, competing consumers,
  priority queues, delay queues, and dead-letter queues.
- **MSG-03 [G/A] Delivery semantics:** at-most-once, at-least-once, bounded
  exactly-once scopes, acknowledgement timing, and failure windows.
- **MSG-04 [G/A] Consumer behavior:** prefetch, concurrency, acknowledgement,
  visibility timeout, redelivery, poison messages, and graceful shutdown.
- **MSG-05 [G/A] Backlog management:** queue depth, age of oldest message, arrival versus
  drain rate, autoscaling, retention, expiration, and overload.
- **MSG-06 [G] Routing:** point-to-point, publish/subscribe, topics, fan-out, filters,
  routing keys, headers, and content-based routing.
- **MSG-07 [G/A] Ordering:** FIFO scope, message groups, partitions, parallelism,
  retries, dead letters, and reordering.
- **MSG-08 [G/A] Duplicate handling:** idempotent consumers, dedup stores, natural
  idempotence, side effects, and dedup retention.
- **MSG-09 [G] Transactional outbox/inbox and change-data-capture publication.**
- **MSG-10 [G] Large-message handling:** claim-check pattern, object storage,
  references, lifecycle, authorization, and atomicity.
- **MSG-11 [G/A] Flow control and backpressure:** credits, windows, bounded buffers,
  producer throttling, consumer lag, and load shedding.
- **MSG-12 [G/A] Scheduling and workflows:** delayed work, cron, dependency graphs,
  retries, compensation, human tasks, and durable execution.

## 15. Event streaming and stream processing

- **STR-01 [C/G] Event logs:** append-only records, topics, partitions, offsets,
  retention, replay, and consumers.
- **STR-02 [G/A] Partitioning and consumer groups:** ownership, parallelism,
  rebalancing, assignment, lag, and ordering scope.
- **STR-03 [G/A] Producer semantics:** keys, partition selection, batching,
  acknowledgements, retries, idempotent producers, and transactions.
- **STR-04 [G/A] Consumer semantics:** offset commit, processing failure, replay,
  at-least-once effects, read-committed behavior, and poison events.
- **STR-05 [G/A] Stream-time semantics:** event time, ingestion time, processing time,
  watermarks, allowed lateness, and out-of-order events.
- **STR-06 [G/A] Stateful processing:** keyed state, windows, joins, aggregations,
  changelogs, checkpoints, and state recovery.
- **STR-07 [G/A] Windowing:** tumbling, hopping, sliding, session windows, triggers,
  early/late results, and correction.
- **STR-08 [G/A] Stream-table duality:** logs as change history, tables as current
  state, materialized views, upserts, and tombstones.
- **STR-09 [G] Event sourcing:** event store, aggregates, replay, snapshots,
  projections, schema evolution, and correction events.
- **STR-10 [G/A] Change data capture:** logs, snapshots, ordering, schema changes,
  backfill, duplicates, and downstream consistency.
- **STR-11 [G/A] Stream joins and enrichment:** co-partitioning, lookup state,
  temporal joins, late updates, and memory/state growth.
- **STR-12 [G] Data contracts:** event ownership, schemas, compatibility, quality,
  lineage, discoverability, and personally identifiable information.

## 16. Reliability, resilience, and failure engineering

- **REL-01 [C/G] Failure modes:** crash, omission, timing, corruption, overload,
  dependency failure, network partition, gray failure, and operator error.
- **REL-02 [C/G] Redundancy and fault domains:** instance, rack, zone, region, provider,
  software version, dependency, and organizational common-mode failure.
- **REL-03 [G/A] Timeouts and deadlines:** connect/read/overall timeout, deadline
  propagation, cancellation, abandoned work, and timeout budgets.
- **REL-04 [G/A] Retries:** retryable errors, limits, exponential backoff, jitter,
  retry budgets, layered retries, and retry storms.
- **REL-05 [G/A] Circuit breakers:** closed/open/half-open states, thresholds,
  probe traffic, recovery, and interaction with retries.
- **REL-06 [G/A] Bulkheads:** thread/connection/resource pools, tenant isolation,
  failure containment, and underutilization trade-offs.
- **REL-07 [G/A] Rate limiting and quotas:** token bucket, leaky bucket, fixed/sliding
  windows, distributed limits, fairness, bursts, and client signaling.
- **REL-08 [G/A] Load shedding and admission control:** priority, early rejection,
  adaptive concurrency, queue bounds, and brownout.
- **REL-09 [C/G] Graceful degradation:** optional features, stale data, cached results,
  partial responses, reduced quality, and critical-path preservation.
- **REL-10 [G/A] Hedging and redundant requests:** tail reduction, cancellation,
  extra load, idempotency, and percentile-triggered hedges.
- **REL-11 [G/A] Health checks:** liveness, readiness, startup, dependency checks,
  false positives, fail-open/closed, and coordinated restarts.
- **REL-12 [G/A] Cascading failures:** positive feedback, overload redistribution,
  retry amplification, cache failure, dependency fan-out, and recovery.
- **REL-13 [G/A] Chaos engineering:** hypothesis, steady state, fault injection,
  blast-radius controls, observability, abort conditions, and learning.
- **REL-14 [G/A] Disaster recovery:** risk assessment, RTO, RPO, backup, restore,
  failover, failback, runbooks, and exercises.
- **REL-15 [G/A] Dependency resilience:** criticality, fallback, isolation,
  contract behavior, timeout budgets, and third-party outage planning.

## 17. Performance and latency engineering

- **PERF-01 [C/G] Latency decomposition:** network, queue, service, storage,
  serialization, contention, retries, and client rendering.
- **PERF-02 [C/G] Percentiles and distributions:** median, p95/p99/p99.9, averages,
  histograms, multimodality, and outliers.
- **PERF-03 [G/A] Tail latency:** fan-out amplification, stragglers, hedging,
  micro-partitioning, load balancing, and utilization.
- **PERF-04 [G/A] Throughput versus latency:** saturation, queueing, concurrency,
  batching, headroom, and the universal scalability intuition.
- **PERF-05 [G/A] Batching:** amortized overhead, batch size, wait time, throughput,
  memory, failure granularity, and fairness.
- **PERF-06 [G/A] Fan-out and scatter-gather:** critical path, parallelism, partial
  results, deadlines, stragglers, and coordinator load.
- **PERF-07 [G] Data locality:** compute-to-data, cache locality, region affinity,
  partition-aware routing, and cross-zone/region cost.
- **PERF-08 [G/A] Contention:** locks, hot rows, hot keys, connection pools,
  shared resources, convoying, and priority inversion.
- **PERF-09 [G/A] Profiling and benchmarking:** representative inputs, warmup,
  bottleneck attribution, micro versus macro benchmarks, and regression budgets.
- **PERF-10 [G/A] Performance anti-patterns:** chatty calls, N+1 queries, unbounded
  concurrency, synchronous chains, excessive serialization, and premature caching.

## 18. Security architecture

- **SEC-01 [C/G] Threat modeling:** assets, actors, trust boundaries, entry points,
  abuse cases, STRIDE-like categories, likelihood, impact, and mitigations.
- **SEC-02 [C/G] Authentication:** passwords, MFA, sessions, tokens, federation,
  workload identity, device identity, and credential recovery.
- **SEC-03 [C/G] Authorization:** RBAC, ABAC, ReBAC, policy decision/enforcement,
  least privilege, object-level access, and tenant boundaries.
- **SEC-04 [G] Identity protocols:** OAuth, OpenID Connect, SAML, token audiences,
  scopes, consent, refresh, revocation, and key rotation.
- **SEC-05 [G] Session and token design:** cookies, CSRF, token storage, expiration,
  rotation, replay, logout, and distributed revocation.
- **SEC-06 [G] Cryptography in architecture:** encryption in transit/at rest/in use,
  envelope encryption, key hierarchy, KMS/HSM, rotation, and crypto agility.
- **SEC-07 [G] Secrets management:** issuance, storage, distribution, rotation,
  short-lived credentials, audit, and break-glass access.
- **SEC-08 [G] Network security:** segmentation, private connectivity, firewall policy,
  egress control, mTLS, zero trust, and service identity.
- **SEC-09 [G] API security:** broken object authorization, broken authentication,
  mass assignment, resource exhaustion, inventory, unsafe consumption, and abuse.
- **SEC-10 [G] Application-layer defenses:** input validation, output encoding,
  injection prevention, SSRF controls, file handling, and deserialization safety.
- **SEC-11 [G/A] Availability security:** DDoS, bot abuse, quotas, proof of work,
  upstream protection, circuit breaking, and recovery.
- **SEC-12 [G] Software supply chain:** provenance, dependency risk, signing, SBOM,
  artifact integrity, CI isolation, and deployment policy.
- **SEC-13 [G] Audit and forensics:** immutable logs, actor/action/resource/time,
  tamper evidence, retention, privacy, access, and investigation.
- **SEC-14 [G] Zero-trust architecture:** no implicit network trust, continuous
  authentication/authorization, resource protection, policy signals, and enforcement.
- **SEC-15 [G/A] Security failure behavior:** fail-open/closed, degraded identity,
  key-service outage, clock failure, revocation lag, and emergency access.

## 19. Privacy, compliance, and governance

- **PRIV-01 [C/G] Data classification:** public, internal, confidential, sensitive,
  regulated, secrets, and derived/inferred data.
- **PRIV-02 [G] Data minimization and purpose limitation:** collect, process, expose,
  and retain only what is necessary.
- **PRIV-03 [G] Consent and preference:** collection, versioned consent, revocation,
  downstream propagation, and auditability.
- **PRIV-04 [G/A] Data residency and sovereignty:** storage, processing, support access,
  backups, replication, and cross-border transfer.
- **PRIV-05 [G] Retention and deletion:** TTLs, legal holds, backup deletion,
  derived data, caches, indexes, logs, and deletion verification.
- **PRIV-06 [G] Subject rights:** access, correction, portability, restriction,
  deletion, identity verification, and asynchronous workflows.
- **PRIV-07 [G] De-identification:** masking, tokenization, pseudonymization,
  anonymization limits, aggregation, and re-identification risk.
- **PRIV-08 [G] Multi-purpose data governance:** ownership, lineage, catalog,
  quality, access review, policy-as-code, and exception management.
- **PRIV-09 [G] Compliance architecture:** evidence, controls, segregation of duties,
  audit scope, retention, change control, and continuous compliance.
- **PRIV-10 [G] Regional and age-sensitive experiences:** policy routing, parental
  controls, localization, content restrictions, and explainability.

## 20. Observability and SRE

- **OBS-01 [C/G] Service-level vocabulary:** SLI, SLO, SLA, error budget, availability,
  durability, correctness, freshness, and latency objectives.
- **OBS-02 [C/G] Golden signals:** latency, traffic, errors, saturation, plus
  domain-specific indicators.
- **OBS-03 [G] Metrics:** counters, gauges, histograms, summaries, labels,
  cardinality, aggregation, retention, and exemplars.
- **OBS-04 [G] Logs:** structured events, levels, context, sampling, redaction,
  indexing, retention, and cost.
- **OBS-05 [G] Distributed tracing:** trace/span context, propagation, sampling,
  causality, critical path, baggage, and privacy.
- **OBS-06 [G] Correlation:** request IDs, trace IDs, deployment versions, tenant,
  region, feature flags, and cross-signal links.
- **OBS-07 [G] Alerting:** symptom versus cause, burn-rate alerts, paging versus ticket,
  noise, deduplication, inhibition, and actionable runbooks.
- **OBS-08 [G] Dashboards:** user journey, service overview, dependency, capacity,
  deployment, business, and debugging views.
- **OBS-09 [G/A] Incident response:** detection, triage, command, communication,
  mitigation, recovery, handoff, timeline, and status updates.
- **OBS-10 [G] Post-incident learning:** blameless analysis, contributing factors,
  corrective actions, owners, recurrence tests, and systemic fixes.
- **OBS-11 [G] On-call design:** escalation, ownership, access, training, handover,
  sustainable load, and toil reduction.
- **OBS-12 [G/A] Capacity and reliability reviews:** forecasts, dependencies,
  failure-mode analysis, game days, readiness, and launch criteria.
- **OBS-13 [G] Observability architecture:** agents/collectors, pipelines, buffering,
  backpressure, sampling, storage tiers, multi-tenancy, and self-observability.
- **OBS-14 [G] Telemetry economics and safety:** cardinality budgets, sampling,
  retention, egress, PII/secrets, access control, and cost.

## 21. Deployment, release, and system evolution

- **DEP-01 [C/G] Deployment strategies:** recreate, rolling, blue-green, canary,
  ring, shadow, and progressive delivery.
- **DEP-02 [G] Release safety:** health gates, SLO gates, automated rollback,
  feature flags, kill switches, and blast-radius control.
- **DEP-03 [G] Backward/forward compatibility:** APIs, events, schemas, databases,
  clients, mixed-version clusters, and expand-contract migrations.
- **DEP-04 [G/A] Database migration:** additive schema, dual read/write, backfill,
  validation, cutover, cleanup, and rollback limitations.
- **DEP-05 [G] Configuration management:** defaults, validation, dynamic config,
  rollout, versioning, secrets separation, and safe fallback.
- **DEP-06 [G] Infrastructure as code:** declarative state, plans, drift, modules,
  policy, state protection, and promotion.
- **DEP-07 [G] Immutable infrastructure and image pipelines:** build once, provenance,
  scanning, signing, promotion, and rollback.
- **DEP-08 [G] Environment strategy:** local, test, staging, production, ephemeral,
  parity, test data, isolation, and cost.
- **DEP-09 [G] Feature management:** flags, experiments, targeting, dependencies,
  lifecycle, stale flags, and emergency disablement.
- **DEP-10 [G] Legacy modernization:** strangler, anti-corruption layer, branch by
  abstraction, parallel run, data synchronization, and decommissioning.
- **DEP-11 [G/A] Fleet and control-plane upgrades:** version skew, quorum safety,
  draining, surge capacity, rollback, and compatibility.
- **DEP-12 [G] Organizational architecture:** ownership, Conway's Law, platform teams,
  service catalogs, golden paths, and cognitive load.

## 22. Containers, orchestration, and cloud platforms

- **PLAT-01 [C/G] VMs, containers, bare metal, functions, and managed platforms:**
  isolation, startup, density, control, portability, and operations.
- **PLAT-02 [G] Container images:** layers, registries, immutability, provenance,
  vulnerability management, and runtime identity.
- **PLAT-03 [G] Orchestrator architecture:** control plane, workers, desired state,
  reconciliation, scheduler, controllers, and backing store.
- **PLAT-04 [G] Workload controllers:** stateless replicas, stateful sets, daemon jobs,
  batch jobs, disruption, rollout, and identity.
- **PLAT-05 [G] Service networking:** service VIP/DNS, ingress, gateway, network policy,
  pod/task networking, and load balancing.
- **PLAT-06 [G] Storage orchestration:** ephemeral versus persistent volumes,
  provisioning, attachment, locality, snapshots, and failure.
- **PLAT-07 [G] Scheduling and placement:** requests/limits, affinity, topology spread,
  taints, priorities, quotas, and preemption.
- **PLAT-08 [G/A] Autoscaling layers:** request/workload, node/cluster, vertical,
  event-driven, scheduling constraints, and capacity lag.
- **PLAT-09 [G] Multi-account/project/subscription design:** isolation, billing,
  identity, policy, networking, logging, and organizational units.
- **PLAT-10 [G] Hybrid and multi-cloud:** connectivity, identity, portability,
  consistent policy, data gravity, egress, failover, and operational complexity.
- **PLAT-11 [G] Platform engineering:** self-service APIs, paved roads, templates,
  policy, observability, developer experience, and platform SLOs.
- **PLAT-12 [G/A] Control-plane resilience:** reconciliation backlog, API overload,
  backing-store failure, split brain, upgrade, and disaster recovery.

## 23. Multi-region, geo-distribution, and disaster recovery

- **GEO-01 [C/G] Region selection:** users, latency, services, capacity, cost,
  regulation, sustainability, and failure correlation.
- **GEO-02 [C/G] Active-passive, pilot-light, warm-standby, and active-active designs.**
- **GEO-03 [G/A] Global traffic management:** DNS, anycast, global proxies,
  geo/proximity routing, health, weights, failover, and stale control data.
- **GEO-04 [G/A] Data placement:** home region, local replicas, global tables,
  write locality, read locality, residency, and replication lag.
- **GEO-05 [G/A] Cross-region consistency:** synchronous latency, asynchronous loss,
  conflict resolution, session guarantees, and partitions.
- **GEO-06 [G/A] Regional evacuation:** detection, traffic drain, dependency readiness,
  capacity, data promotion, validation, and failback.
- **GEO-07 [G] Dependency mapping:** region-scoped versus global services, hidden
  control-plane dependencies, certificates, identity, observability, and CI/CD.
- **GEO-08 [G] DR objectives and tiers:** business impact, RTO/RPO, cost, automation,
  backup, replication, and test frequency.
- **GEO-09 [G/A] Disaster exercises:** scenario, authority, communications, data
  integrity, recovery sequence, abort conditions, and lessons.
- **GEO-10 [G] Sovereign and disconnected operation:** local control planes,
  delayed synchronization, package distribution, key management, and audit.

## 24. Cost, efficiency, and sustainability

- **COST-01 [C/G] Cost model:** compute time, storage capacity/operations, network
  egress, managed-service units, licenses, support, and engineering labor.
- **COST-02 [C/G] Unit economics:** cost per request, user, tenant, transaction,
  GB processed, model inference, and business outcome.
- **COST-03 [C/G] Provisioning trade-offs:** on-demand, reservation/commitment,
  spot/preemptible, autoscaling, overprovisioning, and scarcity.
- **COST-04 [G] Storage lifecycle economics:** hot/warm/cold/archive, retrieval fees,
  minimum duration, compression, deduplication, and deletion.
- **COST-05 [G] Data-transfer economics:** zones, regions, providers, CDN, replication,
  observability, backups, and data gravity.
- **COST-06 [G] FinOps:** allocation, tagging, budgets, forecasts, anomaly detection,
  showback/chargeback, ownership, and optimization loops.
- **COST-07 [C/G] Cost versus reliability/performance/security:** redundancy,
  headroom, premium services, encryption, observability, and recovery.
- **COST-08 [G] Sustainability:** energy proportionality, utilization, carbon-aware
  region/time, efficient algorithms, data minimization, hardware life, and measurement.
- **COST-09 [G] Waste and complexity:** idle resources, zombie data, unused replicas,
  cardinality, over-retention, service sprawl, and operational burden.
- **COST-10 [G] Build-versus-buy economics:** staffing, opportunity cost, lock-in,
  scale discounts, migration cost, and exit strategy.

## 25. Multi-tenancy and SaaS architecture

- **TEN-01 [C/G] Tenancy models:** shared everything, shared app/separate schema,
  separate database, separate stack, cells, and hybrid tiers.
- **TEN-02 [G] Tenant identity and context propagation:** authentication, routing,
  data access, background jobs, events, logs, and traces.
- **TEN-03 [G/A] Isolation:** data, compute, memory, connections, cache, queue,
  network, encryption keys, observability, and administration.
- **TEN-04 [G/A] Fairness and noisy neighbors:** quotas, rate limits, weighted
  scheduling, reserved capacity, burst credits, and admission control.
- **TEN-05 [G] Tenant-aware partitioning:** shard keys, placement, large tenants,
  migration, residency, and hot tenants.
- **TEN-06 [G] Customization:** configuration, schema extensions, workflows,
  feature flags, branding, and upgrade compatibility.
- **TEN-07 [G] Tenant lifecycle:** provisioning, onboarding, trial, suspension,
  export, deletion, restore, and offboarding.
- **TEN-08 [G] Tiered service:** entitlements, SLOs, quotas, regions, support,
  pricing, and graceful limit behavior.
- **TEN-09 [G] Control-plane/data-plane separation:** global catalog, tenant routing,
  regional cells, management operations, and blast radius.
- **TEN-10 [G] Tenant observability and billing:** usage metering, attribution,
  privacy, cardinality, reconciliation, and dispute handling.

## 26. Testing, verification, and architecture fitness

- **TEST-01 [C/G] Test pyramid and distributed-system test portfolio:** unit,
  component, contract, integration, end-to-end, and production verification.
- **TEST-02 [G] Contract testing:** provider/consumer compatibility, schemas,
  examples, evolution, and deployment gates.
- **TEST-03 [G/A] Deterministic simulation:** seeds, virtual time, controlled faults,
  repeatability, invariants, and model boundaries.
- **TEST-04 [G/A] Fault injection:** process, network, storage, dependency, latency,
  corruption, clock, and resource faults.
- **TEST-05 [G/A] Property and invariant testing:** generated operations, safety,
  liveness proxies, state-machine models, and shrinking failures.
- **TEST-06 [A/X] Model checking and formal specification:** state spaces, temporal
  properties, refinement, counterexamples, and limits.
- **TEST-07 [G/A] Data correctness testing:** reconciliation, checksums, shadow reads,
  dual-write comparison, replay, and drift detection.
- **TEST-08 [G/A] Resilience testing:** dependency loss, zone/region loss, overload,
  retry storms, failover, recovery, and steady-state hypotheses.
- **TEST-09 [G/A] Performance testing correctness:** workload fidelity, coordinated
  omission, warm caches, saturation, percentiles, and environment variance.
- **TEST-10 [G] Architecture fitness functions:** automated rules for dependencies,
  latency, cost, security, resilience, data ownership, and standards.
- **TEST-11 [G] Game days and exercises:** scenario design, roles, evidence, safety,
  runbooks, communication, and follow-up.
- **TEST-12 [G] Production verification:** canaries, synthetic probes, shadow traffic,
  real-user monitoring, feature experiments, and rollback triggers.

## 27. Domain archetypes and their distinctive concepts

These are combinations of the preceding fundamentals, but each introduces recurring
teaching problems worth tracking explicitly.

- **DOM-01 [C/G/A] E-commerce:** catalog, inventory, cart, pricing, checkout, payment,
  order state, reservation, oversell prevention, and fulfillment.
- **DOM-02 [G/A] Payments and ledgers:** double-entry ledger, authorization/capture,
  idempotency, reconciliation, settlement, disputes, audit, and PCI boundaries.
- **DOM-03 [G/A] Booking and reservations:** availability search, holds, expiry,
  contention, fairness, waitlists, overbooking, and confirmation.
- **DOM-04 [C/G/A] Social feed:** fan-out-on-write/read, ranking, graph traversal,
  celebrity problem, privacy, moderation, freshness, and pagination.
- **DOM-05 [G/A] Messaging and chat:** conversations, ordering scope, delivery/read
  receipts, presence, offline sync, attachments, groups, and encryption.
- **DOM-06 [G/A] Collaborative editing:** operations, conflict-free merging/OT,
  presence, causality, offline edits, snapshots, and compaction.
- **DOM-07 [C/G/A] Notifications:** preferences, templates, channel selection,
  fan-out, throttling, deduplication, scheduling, retries, and provider fallback.
- **DOM-08 [G/A] Search:** crawling/ingestion, parsing, indexing, ranking, query
  understanding, autocomplete, freshness, shards, and serving.
- **DOM-09 [C/G/A] Media streaming:** ingest, transcode, packaging, origin, CDN,
  adaptive bitrate, DRM, playback telemetry, and live latency.
- **DOM-10 [G/A] File storage and synchronization:** namespace, chunks, deduplication,
  upload resume, metadata, sharing, versioning, conflict, and offline sync.
- **DOM-11 [G/A] Geospatial/rides/delivery:** location updates, proximity search,
  matching, routing, ETA, geofencing, map tiles, and location privacy.
- **DOM-12 [G/A] Metrics/logging/tracing platforms:** high-cardinality ingest,
  aggregation, indexing, sampling, retention, query fan-out, and tenant isolation.
- **DOM-13 [G/A] Analytics and data platforms:** ingestion, lake/warehouse/lakehouse,
  ETL/ELT, orchestration, catalog, quality, batch/stream, and serving.
- **DOM-14 [G/A] IoT:** device identity, provisioning, intermittent connectivity,
  telemetry, commands, digital twins, edge processing, firmware, and fleet safety.
- **DOM-15 [G/A] Gaming:** session/matchmaking, authoritative state, tick rate,
  latency, cheating, regional placement, persistence, and leaderboards.
- **DOM-16 [G/A] Ad serving:** targeting, auctions, budget pacing, low latency,
  frequency capping, attribution, fraud, privacy, and reporting.
- **DOM-17 [G/A] Recommendation systems:** candidates, ranking, features, freshness,
  online/offline consistency, experimentation, feedback loops, and bias.
- **DOM-18 [G/A] Email:** submission, routing, queues, reputation, spam filtering,
  mailbox storage, search, synchronization, and deliverability.
- **DOM-19 [G/A] Web crawling:** frontier, politeness, robots rules, deduplication,
  recrawl, prioritization, distributed scheduling, and content storage.
- **DOM-20 [G/A] Identity platform:** directory, credentials, federation, sessions,
  tokens, risk, recovery, revocation, audit, and high availability.
- **DOM-21 [G/A] Feature-flag/configuration service:** low-latency reads, streaming
  updates, targeting, consistency, audit, rollout, and fail-safe defaults.
- **DOM-22 [G/A] Rate-limit service:** distributed counters, windows, token buckets,
  consistency, locality, fail-open/closed, and fairness.
- **DOM-23 [G/A] Unique-ID service:** uniqueness, ordering, throughput, clock failure,
  coordination, region allocation, and privacy.
- **DOM-24 [G/A] Workflow/durable execution:** state persistence, timers, retries,
  compensation, versioning, signals, determinism, and operator intervention.
- **DOM-25 [G/A] Blockchain/distributed ledger:** consensus, mempool, blocks,
  finality, forks, smart contracts, state, fees, and Byzantine assumptions.
- **DOM-26 [G/A] Edge/offline-first systems:** local state, synchronization,
  conflicts, intermittent links, bandwidth, trust, updates, and fleet management.

## 28. AI/ML and LLM system design

- **AI-01 [C/G] ML lifecycle:** data, training, evaluation, registry, deployment,
  inference, monitoring, feedback, and retraining.
- **AI-02 [G/A] Training architecture:** data pipelines, distributed training,
  checkpoints, accelerators, parallelism, fault recovery, and experiment tracking.
- **AI-03 [G/A] Online inference:** model servers, batching, latency, throughput,
  autoscaling, accelerators, warmup, and fallback models.
- **AI-04 [G/A] Offline/batch inference:** partitioning, orchestration, cost,
  checkpointing, retries, and output versioning.
- **AI-05 [G/A] Feature platforms:** offline/online stores, point-in-time correctness,
  freshness, backfill, reuse, lineage, and training-serving skew.
- **AI-06 [G/A] Model lifecycle:** versioning, registry, promotion, canary, shadow,
  rollback, ensemble, and deprecation.
- **AI-07 [G/A] ML observability:** quality, drift, skew, latency, saturation,
  fairness, safety, cost, and feedback delay.
- **AI-08 [G/A] Retrieval-augmented generation:** ingestion, chunking, embeddings,
  vector search, hybrid retrieval, reranking, context assembly, and citations.
- **AI-09 [G/A] LLM serving:** tokenization, prefill/decode, KV cache, continuous
  batching, quantization, model parallelism, routing, and speculative decoding.
- **AI-10 [G/A] LLM application reliability:** timeouts, fallbacks, structured output,
  validation, retries, nondeterminism, caching, and graceful degradation.
- **AI-11 [G/A] Agent systems:** tools, planning, memory, state, permissions,
  orchestration, human approval, loop limits, and recovery.
- **AI-12 [G/A] AI safety and security:** prompt injection, data exfiltration,
  untrusted tool output, sandboxing, policy enforcement, and audit.
- **AI-13 [G] AI privacy/governance:** training consent, sensitive data, residency,
  retention, model leakage, access control, provenance, and explainability.
- **AI-14 [G/A] Evaluation:** offline datasets, online experiments, human review,
  task success, factuality, safety, regressions, and adversarial testing.
- **AI-15 [G/A] AI economics:** token/accelerator cost, routing, caching, batching,
  quality tiers, latency, utilization, and carbon/energy impact.

## 29. Architecture anti-patterns and failure lessons

- **ANTI-01 [C/G] Single points of failure and hidden shared dependencies.**
- **ANTI-02 [C/G] Premature distribution, needless microservices, and accidental
  complexity.**
- **ANTI-03 [C/G] Scaling the wrong bottleneck and assuming horizontal scaling solves
  state or contention.**
- **ANTI-04 [G] Chatty interfaces, synchronous dependency chains, and excessive fan-out.**
- **ANTI-05 [G] Shared database coupling and cross-service ownership ambiguity.**
- **ANTI-06 [G] Distributed monoliths: coordinated deploys, shared failure, and weak
  service boundaries.**
- **ANTI-07 [G/A] Unbounded queues, concurrency, retries, cardinality, data growth,
  and retention.**
- **ANTI-08 [G/A] Retry storms, thundering herds, cache stampedes, and autoscaling
  feedback loops.**
- **ANTI-09 [G] Assuming exactly-once, global ordering, zero-downtime migration, or
  automatic failover without defining scope and failure cases.**
- **ANTI-10 [G] Treating replicas as backups or health checks as proof of correctness.**
- **ANTI-11 [G] Ignoring deletion, schema evolution, backfill, rollback, and operability.**
- **ANTI-12 [G] Security only at the perimeter, implicit internal trust, shared
  credentials, and missing object-level authorization.**
- **ANTI-13 [G] Monitoring everything without a question, SLO, cardinality budget,
  retention plan, or actionable response.**
- **ANTI-14 [G] Multi-region architecture without dependency, capacity, data,
  failback, and exercise planning.**
- **ANTI-15 [G] Product-name architecture: choosing technologies before requirements,
  access patterns, failure model, and trade-offs are understood.**

## 30. Cross-cutting reasoning every question can teach

- **XR-01 [C] Identify the system's critical path.**
- **XR-02 [C/G] Identify state, ownership, and the source of truth.**
- **XR-03 [C/G] Identify trust boundaries and authorization decisions.**
- **XR-04 [C/G] Identify scaling units and independent bottlenecks.**
- **XR-05 [C/G] Identify consistency scope: object, key, partition, tenant, region,
  or global.**
- **XR-06 [C/G] Identify ordering scope and whether ordering is actually required.**
- **XR-07 [C/G] Identify failure domains and correlated failures.**
- **XR-08 [C/G] Identify overload behavior before adding retries or autoscaling.**
- **XR-09 [C/G] Identify which data may be stale, lost, duplicated, reordered, or
  temporarily unavailable.**
- **XR-10 [C/G] Identify the recovery path, not just the steady-state path.**
- **XR-11 [C/G] Identify how the system is observed, operated, changed, and rolled back.**
- **XR-12 [C/G] Identify privacy, deletion, audit, and regulatory obligations.**
- **XR-13 [C/G] Quantify cost, headroom, and the price of each quality attribute.**
- **XR-14 [C/G] State the modeling boundary and what the evidence does not prove.**
- **XR-15 [C/G] Compare at least one credible alternative and name the condition under
  which it would be preferable.**

## Curriculum and Question Studio implications

The taxonomy should become a registry rather than a hard-coded list in the UI. Each
leaf concept should eventually carry:

1. stable ID and aliases;
2. prerequisite concepts;
3. recommended teaching surface (C/G/A/X);
4. available concept cards and student controls;
5. supported evidence modes (topology, configuration, runtime, budget, explanation);
6. check templates and metrics that can prove the objective;
7. known misconceptions and discriminating probes;
8. supported workload/fault patterns;
9. explicit modeling boundaries;
10. example question archetypes and difficulty progression; and
11. current implementation status with an owner and capability gap.

Question Studio should first ask for taxonomy concepts and learning objectives. It can
then derive the legal card kit, controls, checks, and authoring path. Unsupported
concepts must produce a specific Guided/Architect/external-lab handoff rather than a
generic rejection or a misleading proxy.

## Current simulator boundary

The current Classroom implementation directly supports visible topology, copy counts,
stated component capacity/cost/latency, peak traffic, generic throughput/utilization,
and a small set of structural and right-sizing checks. A card's presence does not prove
its advanced semantics. For example:

- a Queue card does not prove delivery semantics, ordering, backlog drain, or durability;
- a Cache card does not prove hit ratio, invalidation, or freshness;
- a Database card does not prove replication, consistency, isolation, or transactions;
- a CDN card does not prove geographic latency, caching, or purge behavior; and
- a Gateway card does not prove authentication, authorization, route behavior, or quotas.

The Architect simulator has a wider runtime and grading surface, but formal guarantees,
provider-specific behavior, packet-level networking, arbitrary business logic, and
unbounded distributed correctness claims still require narrowing or external tooling.

## Research basis

This taxonomy synthesizes stable concepts from the following primary or authoritative
sources rather than treating any one interview-preparation list as canonical:

- [AWS Well-Architected Framework](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html)
- [Google Cloud Well-Architected Framework](https://docs.cloud.google.com/architecture/framework)
- [Azure design principles](https://learn.microsoft.com/en-us/azure/architecture/guide/design-principles/)
- [Azure cloud design-pattern catalog](https://learn.microsoft.com/en-us/azure/architecture/patterns/)
- [Google Site Reliability Engineering book](https://sre.google/sre-book/table-of-contents/)
- [Kubernetes concepts](https://kubernetes.io/docs/concepts/)
- [NIST SP 800-207 Zero Trust Architecture](https://www.nist.gov/publications/zero-trust-architecture)
- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [OpenTelemetry concepts](https://opentelemetry.io/docs/concepts/)
- [Apache Kafka design documentation](https://kafka.apache.org/design/)
- [Lamport's distributed-systems publications](https://lamport.azurewebsites.net/pubs/pubs.html)
- [Raft consensus documentation and paper](https://raft.github.io/)
- [Amazon Dynamo paper](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)
- [Google Spanner paper](https://research.google/pubs/spanner-googles-globally-distributed-database-2/)
- [The Tail at Scale](https://research.google/pubs/the-tail-at-scale/)
- [Dapper distributed tracing paper](https://research.google/pubs/dapper-a-large-scale-distributed-systems-tracing-infrastructure/)

## Maintenance rule

Add a new concept when it introduces at least one distinct learning objective,
trade-off, failure mode, evidence requirement, or student decision. Add a product name
only as an example or implementation mapping. Re-review the taxonomy at least once per
academic term and whenever the simulator adds a new component family, runtime trait,
metric, check template, or supported guarantee.
