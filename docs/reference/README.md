# Reference: how a system should behave in the real world

Purpose: a source-backed description of how each concept in this simulator works in real systems. It is
written **without reading the engine's behaviour**, so it can serve as the independent oracle for the test
catalogue in [`../user-flows-catalogue.md`](../user-flows-catalogue.md). When the simulator disagrees with a
chapter here, that is a finding to triage: engine bug, wrong chapter, or a deliberate simplification.

## Method

1. One **topic card** per concept (template below). Cards cite sources.
2. Source quality is marked on every claim that carries a number or rule:

| Mark    | Meaning                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **[P]** | Primary: original paper, official documentation, the author's own page, or a standards text. Fetched and read.                 |
| **[S]** | Secondary: textbook-level summary, university notes, reputable encyclopedia. Fetched or searched.                              |
| **[K]** | Established knowledge written from memory, **not yet checked against a fetched source**. Verify before using as a test oracle. |
| **[?]** | Disputed, version-dependent, or implementation-specific. Needs a decision from the product owner.                              |

3. Each card ends with **Testable expectations**: statements a flow can assert (a formula, a bound, a direction).
   These feed the `A`, `I` and `G` marks in the flows catalogue.
4. Each card has **Simulator scope**: what the simulator is expected to model and what it deliberately
   simplifies. This column is filled from the written specs and the product owner, not from the code.

### Topic card template

```
### <Name>
What it is: one or two sentences.
How it works in real systems: mechanism, parameters, defaults seen in practice.
Math: formulas with every symbol defined, units, validity conditions.
Failure modes: what goes wrong and how it presents (latency, errors, saturation).
Trade-offs / when to use / when not to.
Testable expectations: bullets, each assertable.
Simulator scope: modelled / simplified / not modelled (owner-confirmed).
Sources: [P]/[S] links.
```

## Chapter map

Status: `done` = written and sourced; `partial` = written, some claims `[K]`; `todo` = not started.

| #   | Chapter                                                                           | What it covers                                                                                                                                                                                                                                                                                 | Status  |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 01  | [Queueing and performance math](01-queueing-and-performance.md)                   | Little's Law, utilization, M/M/1, M/M/c, Erlang B/C, M/M/c/K, M/D/1, Pollaczek-Khinchine, Kingman, percentiles, golden signals, saturation                                                                                                                                                     | partial |
| 02  | [Reliability and resilience patterns](02-reliability-patterns.md)                 | Circuit breaker, retry and backoff, jitter, timeouts, rate limiting (token/leaky bucket), bulkhead, load shedding, backpressure, health checks                                                                                                                                                 | partial |
| 03  | [Probability and distributions](03-probability-and-distributions.md)              | All 14 distributions in the simulator (constant, deterministic, normal, log-normal, exponential, uniform, Weibull, Poisson, binomial, gamma, beta, Pareto, empirical, mixture): pdf, mean, variance, CV, percentiles, when real latency looks like each, sampling and seeding, parameter map   | partial |
| 04  | [Discrete-event simulation](04-discrete-event-simulation.md)                      | Event list, clock, warmup and transient bias, replications and confidence intervals, batch means, common random numbers, determinism by seed, verification, fluid/analytic versus DES, stop conditions                                                                                         | partial |
| 05  | [Traffic and workload patterns](05-traffic-and-workload.md)                       | Constant, Poisson, bursty, diurnal, spike, sawtooth, replay; open vs closed vs partly open; coordinated omission; request mix and Zipf popularity; interactive response time law                                                                                                               | partial |
| 06  | [Compute nodes](06-compute-nodes.md)                                              | Every `ComputeType`: vCPU and instance families, concurrency and Little's Law, workers per vCPU, memory admission, Amdahl and USL scaling, serverless concurrency and cold starts, sidecar tax, instance parameter map                                                                         | partial |
| 07  | [Network nodes and routing](07-network-nodes-and-routing.md)                      | Every `NetworkType`: L4 vs L7, load-balancing algorithms and their math (power of two choices, consistent hashing), health checks, API gateway, CDN hit-ratio arithmetic, service mesh, NAT/VPN/transit, routing parameter map                                                                 | partial |
| 08  | [Edges, protocols and network physics](08-edges-protocols-and-network-physics.md) | Per-hop cost: propagation (fibre), transmission and bandwidth-delay product, TCP/TLS handshake round trips, packet loss and the Mathis bound, protocols, connection pools, batching, fan-out, path-type calibration, edge parameter map                                                        | partial |
| 09  | [Storage and databases](09-storage-and-databases.md)                              | Every `StorageType`: IOPS and throughput limits (EBS gp3/gp2), B-tree depth and WAL, LSM-tree and compaction, Bloom filters, object/block/file storage and S3 consistency, columnar and analytical stores, vector indexes (HNSW), backups and restore time, capacity arithmetic, parameter map | partial |
| 10  | [Caching](10-caching.md)                                                          | Effective latency, Zipf ceilings and the Che approximation for LRU, eviction policies, cache patterns and write policies, TTL math, stampede and request collapsing (XFetch, leases), down-cache load jump, parameter map                                                                      | partial |
| 11  | [Replication, consistency and consensus](11-replication-consistency-consensus.md) | Async/semi-sync/sync replication and lag, consistency models, CAP and PACELC, quorums (R+W>N) and quorum availability, Raft, leader election, leases and fencing tokens, conflict resolution, parameter map                                                                                    | partial |
| 12  | [Sharding and partitioning](12-sharding-and-partitioning.md)                      | Hash, range, consistent and directory schemes, shard-key choice, hot keys under Zipf and per-key limits, scatter-gather tail (E[max] = H_n x mean), rebalancing, cross-shard operations, parameter map                                                                                         | partial |
| 13  | [Messaging and streaming](13-messaging-and-streaming.md)                          | Queue, pub/sub, stream, event bus, event sourcing, broker, task queue; delivery guarantees, visibility timeout and DLQ, partitions, consumer groups and ordering, lag and backlog maths, replay and snapshots, windowing, parameter map                                                        | partial |
| 14  | [Orchestration and infrastructure](14-orchestration-and-infrastructure.md)        | Kubernetes (scheduling, bin packing), registries, config, secrets, cluster autoscaler, horizontal autoscaling math, CI/CD, IaC                                                                                                                                                                 | todo    |
| 15  | [Security and identity](15-security-and-identity.md)                              | IAM/RBAC, WAF, firewall, bastion, CA, KMS, DLP, IdP, SIEM, rate-limit/abuse, crypto cost, auth cost                                                                                                                                                                                            | todo    |
| 16  | [Observability](16-observability.md)                                              | Logging, tracing, metrics, alerting, dashboards, RUM, health checks, profiling, sampling, SLIs/SLOs/error budgets, burn rate                                                                                                                                                                   | todo    |
| 17  | [DevOps and delivery](17-devops-and-delivery.md)                                  | Artifact repo, build, feature flags, deployment strategies (rolling, blue-green, canary), chaos engineering, policy as code                                                                                                                                                                    | todo    |
| 18  | [Data infrastructure and AI](18-data-infrastructure-and-ai.md)                    | ETL, streaming analytics, windowing, feature store, memory fabric, model serving, LLM gateway, token cost, agent orchestration, vector search                                                                                                                                                  | todo    |
| 19  | [Real-time and media](19-real-time-and-media.md)                                  | WebSocket gateway, push notifications, transcoder, signalling, SFU/MCU, WebRTC mesh, persistent connection fan-out                                                                                                                                                                             | todo    |
| 20  | [Integration](20-integration.md)                                                  | Webhook gateway, third-party API, payment gateway (idempotency), third-party auth                                                                                                                                                                                                              | todo    |
| 21  | [DNS and certificates](21-dns-and-certificates.md)                                | Authoritative, internal DNS, weighted/geo/latency routing, TTL, certificate distribution                                                                                                                                                                                                       | todo    |
| 22  | [Failure semantics and chaos](22-failure-semantics-and-chaos.md)                  | Fail-stop, crash-restart, gray failure, blackhole, hang, degraded, cascade, retry storm, thundering herd, metastable failure, blast radius, AZ outage, DB failover, traffic spike, cache stampede                                                                                              | todo    |
| 23  | [Capacity planning and cost](23-capacity-planning-and-cost.md)                    | Headroom, N+1, utilization targets, instance sizing, reserved/spot pricing, cost per request, QuickCart arithmetic                                                                                                                                                                             | todo    |
| 24  | Architecture and system-design patterns                                           | Layered, microservices, CQRS, event-driven, saga, outbox, fan-out on write/read, strangler, cell-based, multi-region, active-active/passive; the standard interview-style systems (URL shortener, news feed, chat, etc.) as expected-shape references                                          | todo    |
| 25  | Architecture decisions                                                            | ADR format; the trade-off tables behind each choice (SQL vs NoSQL, sync vs async, push vs pull, cache placement, consistency level)                                                                                                                                                            | todo    |
| 26  | Configuration, JSON and types                                                     | Every field of `TopologyJSON`, node `config`, `EdgeDefinition`, workload, global, faults, question package: type, unit, range, default, real-world meaning                                                                                                                                     | todo    |
| 27  | Metrics and output glossary                                                       | Every output metric (percentiles, throughput, error rate, utilization, queue depth, saturation, L, W, lambda) with its exact definition and unit                                                                                                                                               | todo    |
| 28  | Glossary                                                                          | Every technical term used in the app UI, docs and code, one line each, linked to its chapter                                                                                                                                                                                                   | todo    |
| 29  | Question and grading concepts                                                     | Structural rules, metric rules, invariants, rubric, discrimination, misconceptions, classroom concepts, evaluation envelope                                                                                                                                                                    | todo    |

## The simulator's catalogue (what chapters 06 to 21 must cover)

Taken from `src/engine/core/types.ts`. 131 component types in 14 groups.

- **ComputeType** (12): `api-endpoint`, `microservice`, `sidecar`, `batch-worker`, `serverless-function`, `faas-background`, `container`, `vm-instance`, `edge-compute`, `gpu-node`, `auth-service`, `search-service`
- **NetworkType** (17): `load-balancer`, `load-balancer-l4`, `load-balancer-l7`, `global-traffic-manager`, `edge-router`, `nat-gateway`, `transit-gateway`, `vpn-gateway`, `cdn`, `api-gateway`, `service-mesh`, `ingress-controller`, `reverse-proxy`, `high-perf-nic`, `network-policy`, `routing-rule`, `routing-policy`
- **StorageType** (19): `relational-db`, `nosql-db`, `object-storage`, `block-storage`, `distributed-file-system`, `in-memory-cache`, `search-index`, `time-series-db`, `columnar-db`, `graph-db`, `vector-db`, `data-warehouse`, `data-lake`, `kv-store`, `archive-storage`, `schema-registry`, `cdc`, `backup-service`, `kms-storage`
- **MessagingType** (7): `queue`, `pub-sub`, `stream`, `event-bus`, `event-sourcing-store`, `message-broker`, `task-queue`
- **OrchestrationType** (13): `kubernetes-cluster`, `container-registry`, `service-registry`, `tool-registry`, `config-store`, `secrets-manager`, `cluster-autoscaler`, `agent-orchestrator`, `orchestrator-scheduler`, `ci-cd-runner`, `iac-engine`, `container-runtime`, `provisioner`
- **SecurityType** (11): `iam-rbac`, `waf`, `firewall`, `bastion-host`, `certificate-authority`, `secrets-rotation`, `kms-security`, `dlp-inspection`, `identity-provider`, `siem`, `privilege-escalation-control`
- **ObservabilityType** (9): `centralized-logging`, `distributed-tracing`, `metrics-store`, `alerting-hook`, `dashboard`, `rum-monitoring`, `health-check-manager`, `safety-observability-mesh`, `profiling-service`
- **DevopsType** (7): `artifact-repository`, `build-system`, `feature-flag-service`, `deployment-controller`, `chaos-engineering-framework`, `policy-as-code`, `pipeline-secrets`
- **DataInfraType** (5): `etl-pipeline`, `streaming-analytics`, `feature-store`, `memory-fabric`, `model-serving`
- **RealTimeType** (6): `websockets-gateway`, `push-notification-service`, `transcoder`, `signaling-server`, `sfu-mcu`, `webrtc-mesh`
- **IntegrationType** (5): `webhook-gateway`, `llm-gateway`, `third-party-api-connector`, `payment-gateway`, `third-party-auth`
- **ConsensusType** (4): `etcd-consul-kv`, `leader-election`, `distributed-lock`, `coordination-service`
- **AuxiliaryType** (13): `service-mesh-telemetry`, `policy-engine`, `sharding`, `hashing`, `shard-node`, `partition-node`, `rate-limiter`, `circuit-breaker-controller`, `idempotency-manager`, `reservation-store`, `request-tracking`, `backpressure-controller`, `throttler`
- **DnsType** (3): `dns-authoritative-server`, `internal-dns`, `certificate-distro`

### Behaviour traits (51 files in `src/engine/traits`)

Each is a real-world behaviour a node can carry. Chapters 06 to 22 own them as listed.

| Trait                                                                                                                 | Real-world concept                             | Chapter    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------- |
| `cache`                                                                                                               | Cache hit/miss, derived-LRU, declared hit rate | 10         |
| `circuitBreaker`                                                                                                      | Circuit breaker                                | 02         |
| `retryBackoff`                                                                                                        | Retries with backoff and jitter                | 02         |
| `rateLimiter`                                                                                                         | Token bucket / limiter                         | 02         |
| `bulkhead`                                                                                                            | Bulkhead isolation, partitioned capacity       | 02         |
| `loadShedding`                                                                                                        | Load shedding                                  | 02         |
| `autoscaler`                                                                                                          | Horizontal autoscaling                         | 14         |
| `coldStart`                                                                                                           | Serverless cold start                          | 06         |
| `capacityLimit`, `memoryPressure`, `storageCapacity`                                                                  | Capacity and memory ceilings                   | 06, 09     |
| `healthAwareRouting`, `healthProber`                                                                                  | Health checks, outlier removal                 | 02, 07     |
| `contentRouting`, `keyBasedRouting`, `dnsRoutingPolicy`                                                               | Content, key and DNS routing                   | 07, 12, 21 |
| `geoLatency`                                                                                                          | Region-pair latency                            | 08         |
| `readWriteSplit`, `readOnly`, `replication`, `consistencyModel`                                                       | Replication and consistency                    | 11         |
| `lockLease`, `reservationStore`, `idempotencyDedup`                                                                   | Locks, reservations, dedup                     | 11, 20     |
| `streamBroker`, `consumerLag`, `consumerGroupMembership`, `broadcastFanout`, `ackAndRelease`, `asyncOnly`, `batching` | Messaging semantics                            | 13         |
| `changeStream`, `logReplay`, `windowing`                                                                              | CDC, replay, windowing                         | 13, 18     |
| `persistentConnFanout`, `protocolSession`                                                                             | Connections, sessions                          | 08, 19     |
| `fanoutQuery`, `tieredRetrieval`, `deliveryPartnerPool`                                                               | Scatter-gather, tiered retrieval, pools        | 07, 18     |
| `telemetrySink`                                                                                                       | Observability drop under load                  | 16         |
| `authentication`, `cryptoCost`, `inspectionCost`                                                                      | Auth, TLS, WAF cost                            | 15         |
| `tokenCost`                                                                                                           | LLM token cost                                 | 18         |
| `externalLatency`                                                                                                     | Third-party latency                            | 20         |
| `scheduler`                                                                                                           | Kubernetes bin packing                         | 14         |
| `storageProfile`, `serviceTimeOverride`                                                                               | Read vs scan, per-request service time         | 09         |
| `capabilityModules`, `resolveTraits`, `types`                                                                         | Plumbing, no real-world concept                | n/a        |

## Sources and licensing

Fetched pages are summarised, not copied. Quotes are kept under 15 words and attributed.
