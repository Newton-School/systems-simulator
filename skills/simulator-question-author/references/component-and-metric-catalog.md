# Component and Metric Catalog

This is the standalone mapping snapshot for walkthrough authoring. Use serialized
type tokens in grading rules, never palette labels.

## Component label to type

| Category       | Palette label               | Type token                   |
| -------------- | --------------------------- | ---------------------------- |
| Compute        | Client App / Input Source   | `api-endpoint`               |
| Compute        | API Server / custom service | `microservice`               |
| Compute        | Serverless Function         | `serverless-function`        |
| Compute        | Job Worker / Cron Job       | `batch-worker`               |
| Compute        | Auth Service                | `auth-service`               |
| Compute        | Search Service              | `search-service`             |
| Compute        | Sidecar Proxy               | `sidecar`                    |
| Storage        | SQL DB / Read Replica       | `relational-db`              |
| Storage        | NoSQL DB                    | `nosql-db`                   |
| Storage        | Distributed Cache           | `in-memory-cache`            |
| Storage        | Object Storage              | `object-storage`             |
| Storage        | Search Index                | `search-index`               |
| Storage        | Time-series DB              | `time-series-db`             |
| Storage        | Graph DB                    | `graph-db`                   |
| Storage        | Vector DB                   | `vector-db`                  |
| Storage        | Data Warehouse              | `data-warehouse`             |
| Storage        | Data Lake                   | `data-lake`                  |
| Storage        | KV Store                    | `kv-store`                   |
| Network        | Load Balancer               | `load-balancer`              |
| Network        | Load Balancer L4            | `load-balancer-l4`           |
| Network        | Load Balancer L7            | `load-balancer-l7`           |
| Network        | Ingress Controller          | `ingress-controller`         |
| Network        | Reverse Proxy               | `reverse-proxy`              |
| Network        | Service Mesh                | `service-mesh`               |
| Network        | API Gateway                 | `api-gateway`                |
| Network        | CDN                         | `cdn`                        |
| Network        | Edge Router                 | `edge-router`                |
| Network        | NAT Gateway                 | `nat-gateway`                |
| Network        | VPN Gateway                 | `vpn-gateway`                |
| Messaging      | Message Queue               | `queue`                      |
| Messaging      | Event Broker                | `message-broker`             |
| Messaging      | Pub/Sub                     | `pub-sub`                    |
| Messaging      | Event Stream                | `stream`                     |
| Coordination   | Rate Limiter                | `rate-limiter`               |
| Coordination   | Circuit Breaker             | `circuit-breaker-controller` |
| Coordination   | Distributed Lock            | `distributed-lock`           |
| Coordination   | Idempotency Guard           | `idempotency-manager`        |
| Coordination   | Reservation Store           | `reservation-store`          |
| Coordination   | Sharding                    | `sharding`                   |
| Coordination   | Hashing                     | `hashing`                    |
| Coordination   | Shard Node                  | `shard-node`                 |
| Coordination   | Partition Node              | `partition-node`             |
| Infrastructure | Discovery Service           | `service-registry`           |
| Infrastructure | Config Store                | `config-store`               |
| Infrastructure | Secrets Manager             | `secrets-manager`            |
| Infrastructure | Feature Flag Service        | `feature-flag-service`       |
| Observability  | Metrics Collector           | `metrics-store`              |
| Observability  | Log Collector               | `centralized-logging`        |
| Observability  | Tracing Collector           | `distributed-tracing`        |
| Observability  | Alerting Engine             | `alerting-hook`              |
| Observability  | Health Check Manager        | `health-check-manager`       |

When a requested palette item is absent, do not guess its type token. Use a
documented broader category, choose a listed proxy, or mark target-version
validation as required.

## Categories

Valid common category tokens:

- `compute`
- `network-and-edge`
- `storage-and-data`
- `messaging-and-streaming`
- `orchestration-and-infra`
- `security-and-identity`
- `observability`
- `devops-and-delivery`
- `data-infra-and-analytics`
- `real-time-and-media`
- `external-and-integration`
- `dns-and-certs`
- `consensus-and-coordination`
- `auxiliary`

## Common rubric metrics

### Summary

- `summary.latency.p50`
- `summary.latency.p90`
- `summary.latency.p95`
- `summary.latency.p99`
- `summary.latency.min`
- `summary.latency.max`
- `summary.latency.mean`
- `summary.throughput`
- `summary.totalRequests`
- `summary.successfulRequests`
- `summary.failedRequests`
- `summary.rejectedRequests`
- `summary.timedOutRequests`
- `summary.connectionResetRequests`
- `summary.errorRate`

### Worst-node aggregates

- `perNode.maxUtilization`
- `perNode.maxErrorRate`
- `perNode.maxLatencyP99`

### Invariants and consistency

- `invariantViolations.count`
- `sloBreaches.count`
- `conservation.unbalanced`
- `littlesLaw.violations`

The runtime may expose additional reservation, lock, retry, rate-limit, broker,
replication, protocol, and idempotency counters. Use those only when newer target
documentation or the Studio selector confirms the exact path. Unknown metric
paths fail; never improvise one.

## Units

| Value                            | Raw unit                      |
| -------------------------------- | ----------------------------- |
| Latency                          | milliseconds                  |
| Throughput                       | requests/second               |
| Utilization                      | fraction `0..1`               |
| Error rate                       | fraction `0..1`               |
| Pass threshold                   | fraction `0..1`               |
| Studio friendly error-rate input | percent; `1` means raw `0.01` |

## Capability-bearing components

- `stream`: partitions, consumer groups, offsets, retention, replay,
  rebalancing, and broker-availability evidence.
- replicated `relational-db` / `nosql-db`: ack policy, replica members,
  deterministic promotion, staleness, and failover-window proxies.
- `load-balancer-l4`, `load-balancer-l7`, `api-gateway`: protocol/session and
  L4/L7 behavior within guided network boundaries.
- `rate-limiter` / `api-gateway`: configured admission behavior and counters.
- `idempotency-manager`: duplicate suppression, commit-outcome journal, and
  modeled reconciliation evidence.
- `distributed-lock`: lock acquisition, lease, and contention proxies.
- `reservation-store`: reservation-state and guard-store behavior.

Presence alone does not enable every behavior; configuration and discrete
execution may be required.
