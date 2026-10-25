# 26. Configuration, JSON and types

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

**[repo]** here means read from the type definitions and validator (`src/engine/core/types.ts`, `src/engine/validation/validator.ts`).
This chapter is the field reference for the document the engine runs: `TopologyJSON`. Unlike chapters 01 to 25 it
describes the simulator's own contract, so each row gives the type, unit, range and what the field stands for in a
real system, with the chapter that explains the real-world side. Fields the engine does not read are listed in section 9.

## 1. The document

```json
{
  "id": "…",
  "name": "…",
  "version": "1.0.0",
  "global": {
    "simulationDuration": 60000,
    "seed": "demo",
    "warmupDuration": 0,
    "timeResolution": "microsecond",
    "defaultTimeout": 5000,
    "traceSampleRate": 0.01
  },
  "nodes": [
    {
      "id": "api",
      "type": "microservice",
      "category": "compute",
      "label": "API",
      "position": { "x": 0, "y": 0 },
      "resources": { "instanceType": "m5.large", "instanceCount": 2, "workloadKind": "cpu-bound" },
      "processing": { "distribution": { "type": "constant", "value": 5 }, "timeout": 1000 },
      "config": {}
    }
  ],
  "edges": [
    {
      "id": "client->api",
      "source": "client",
      "target": "api",
      "mode": "synchronous",
      "protocol": "grpc",
      "latency": { "distribution": { "type": "constant", "value": 1 }, "pathType": "same-dc" },
      "bandwidth": 1000,
      "maxConcurrentRequests": 100000,
      "packetLossRate": 0,
      "errorRate": 0
    }
  ],
  "workload": {
    "sourceNodeId": "client",
    "pattern": "poisson",
    "baseRps": 100,
    "requestDistribution": []
  },
  "faults": [],
  "invariants": [],
  "locations": []
}
```

Top level: `id`, `name`, `version` (strings), `global`, `nodes`, `edges`; optional `workload`, `faults`, `invariants`, `scenarios`, `locations`, `networkModel`. [repo]

## 2. `global` (run settings)

| Field                | Type, unit                     | Range                | Meaning                                      | Real counterpart                      |
| -------------------- | ------------------------------ | -------------------- | -------------------------------------------- | ------------------------------------- |
| `simulationDuration` | ms                             | > 0                  | simulated time to run                        | length of the test                    |
| `seed`               | string                         | any                  | seeds every random draw; same seed, same run | reproducibility (chapter 04)          |
| `warmupDuration`     | ms                             | >= 0                 | metrics collected only after it              | discarding the transient (chapter 04) |
| `timeResolution`     | `microsecond` or `millisecond` |                      | clock granularity                            |                                       |
| `defaultTimeout`     | ms                             | > 0                  | request timeout when a node does not set one | client deadline (chapter 02)          |
| `traceSampleRate`    | fraction                       | 0 to 1, default 0.01 | share of requests traced                     | trace sampling (chapter 16)           |

## 3. `nodes[]` (components)

| Field         | Type                                               | Meaning                                                                                  |
| ------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`, `label` | string                                             | unique id, display name                                                                  |
| `type`        | one of the 131 component types (chapters 06 to 22) | decides the behaviour and default profile                                                |
| `category`    | one of the 14 categories                           | grouping; any of the 14 is accepted for any type, it is not checked against the type     |
| `role`        | `source`, `processor`, `storage`, `router`, `sink` | structural role (optional)                                                               |
| `position`    | {x, y}                                             | canvas position, no effect on a run                                                      |
| `provider`    | string                                             | vendor label, no effect on behaviour                                                     |
| `placement`   | {regionId, availabilityZoneId, subnetId}           | where it lives, for fault domains (chapter 22)                                           |
| `resources`   | see 3.1                                            | the instance model                                                                       |
| `queue`       | {workers, capacity, discipline, weights}           | a raw queue run as written (3.2)                                                         |
| `processing`  | {distribution, timeout}                            | service-time distribution and node timeout in ms                                         |
| `resilience`  | see 3.3                                            | breaker, retry, rate limiter, bulkhead                                                   |
| `slo`         | {latencyP99 ms, availabilityTarget, errorBudget}   | targets checked against the run (`errorBudget` feeds `sloStatus`)                        |
| `config`      | free map                                           | the per-type settings of chapters 06 to 22 (cache hit rate, shard key, lag, window, ...) |

### 3.1 `resources`

| Field             | Meaning                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instanceType`    | a catalogue SKU (`m5.large`, `c5.xlarge`, `r5.2xlarge`, ...): vCPU, RAM, price per hour and a perf factor come from the catalogue, never free-typed |
| `instanceCount`   | horizontal scale (default 1); `maxInstances` caps it at build time                                                                                  |
| `workloadKind`    | `cpu-bound` or `io-bound`: decides workers per vCPU (chapter 06)                                                                                    |
| `perRequestMemMb` | memory held by one in-flight request: divides RAM into the admission ceiling K                                                                      |
| `pricingModel`    | `on-demand` (1.0), `reserved` (0.6), `spot` (0.3): cost multiplier only (chapter 23)                                                                |

Workers and queue depth are **derived** from instance and workload kind; they are not authored. [repo]

### 3.2 `queue`

`workers` (c), `capacity` (K, total in system), `discipline` (`fifo`, `lifo`, `priority`, `wfq` with per-type `weights`). An authored `queue` with no `resources` runs as written; with neither, the node gets the palette profile for its type (chapter 06). [repo]

### 3.3 `resilience`

| Block            | Fields                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `circuitBreaker` | `failureThreshold` (0 to 1), `failureCount` (min requests), `recoveryTimeout` (ms), `halfOpenRequests`         |
| `retry`          | `maxAttempts`, `baseDelay` (ms), `maxDelay` (ms), `multiplier`, `jitter`                                       |
| `rateLimiter`    | `maxTokens`, `refillRate` (tokens/s)                                                                           |
| `bulkhead`       | `partitions` (per-compartment caps), `defaultMaxConcurrent`, `keyField`; legacy `maxConcurrent` for serverless |

Meaning of each: chapter 02. A node's retry policy governs calls **to** that node. [repo]

### 3.4 Distributions

`constant`, `deterministic` {value}, `log-normal` {mu, sigma>0}, `exponential` {lambda>0, per ms}, `normal` {mean, stdDev>0}, `uniform` {min, max}, `weibull` {shape, scale}, `poisson` {lambda}, `binomial` {n, p}, `gamma` {shape, scale}, `beta` {alpha, beta}, `pareto` {scale, shape}, `empirical` {samples, interpolation}, `mixture`. Units are milliseconds for latencies. Definitions, moments and when each is realistic: chapter 03.

## 4. `edges[]` (connections)

| Field                         | Type, unit                                                  | Meaning                                                                                  |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`, `source`, `target`      | string                                                      | endpoints                                                                                |
| `mode`                        | `synchronous`, `asynchronous`, `streaming`, `conditional`   | how the call is made (chapters 08, 13)                                                   |
| `condition`                   | JS expression                                               | for `conditional` edges, e.g. `request.type === "write"`                                 |
| `protocol`                    | `https`, `grpc`, `tcp`, `udp`, `websocket`, `amqp`, `kafka` | per-request protocol cost (chapter 08)                                                   |
| `latency`                     | {distribution, pathType, derivedFromPathType}               | propagation; path types `same-rack`, `same-dc`, `cross-zone`, `cross-region`, `internet` |
| `bandwidth`                   | Mbps                                                        | link rate: transmission time = size / bandwidth                                          |
| `maxConcurrentRequests`       | count                                                       | connection-pool style cap                                                                |
| `packetLossRate`, `errorRate` | 0 to 1                                                      | per-request loss (retransmission cost) and error probability                             |
| `weight`                      | number                                                      | relative weight for weighted routing (chapters 07, 21)                                   |
| `fanoutFactor`                | count                                                       | one delivery becomes N (fan-out on write, chapter 24)                                    |
| `connection`                  | {reuse, tls, ...}                                           | TLS and connection set-up (chapter 08)                                                   |
| `batching`                    | {...}                                                       | Kafka-style producer batching (chapter 08)                                               |
| `protocolOverheadMs`          | ms                                                          | replaces the protocol's default per-request cost                                         |

Edge physics apply only in the network edge model; the default connector model ignores latency, errors and loss (the importer says so). [repo]

## 5. `workload`

| Field                                                                                                 | Meaning                                                                                             |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sourceNodeId`                                                                                        | the node that generates requests                                                                    |
| `pattern`                                                                                             | `constant`, `poisson`, `bursty`, `diurnal`, `spike`, `sawtooth`, `replay` (chapter 05)              |
| `baseRps`                                                                                             | requests per second, > 0                                                                            |
| `spike` {spikeTime ms, spikeRps, spikeDuration ms}; `diurnal` {peakMultiplier, hourlyMultipliers[24]} | shape parameters                                                                                    |
| `requestDistribution[]`                                                                               | request types: `type`, `weight` (sum to 1), `sizeBytes`, `metadata`, `keyspace` {field, size, skew} |
| `sessions` {count}                                                                                    | stamps a session id for read-your-writes and sticky routing                                         |
| `origins[]`                                                                                           | weighted client populations by location                                                             |
| `stopCondition`                                                                                       | {mode `duration` or `requestBudget`, `maxRequests`, `haltOnSaturation` {utilization, errorRate}}    |

## 6. `faults[]`, `invariants[]`, `locations[]`

| Block     | Fields                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fault     | `targetId` (node or location id), `faultType` (`node-failure`, `chaos`, `cache-flush`), `timing`, `duration` (`fixed`, `until`, `permanent`), `params` {atMs, durationMs, mode, inFlightPolicy, recoveryPolicy, degradation} (chapter 22) |
| invariant | `id`, `description`, `condition` like `perNode.maxUtilization <= 0.8`                                                                                                                                                                     |
| location  | `id`, `kind` (`region`, `availability-zone`, `subnet`, `edge-pop`), `label`, `parentId`                                                                                                                                                   |

## 7. Request metadata and keys

Requests carry `metadata`: `sessionId`, the keyspace field, `clientIp`, `origin`, `host`, plus per-type static metadata. Traits read named fields: `shardKey`, `partitionKey`, `idempotencyKey`, `authToken`/`authStatus`/`authScopes`. [repo]

## 8. Question package (for reference)

`QuestionPackage` wraps a scaffold topology, constraints, a suite of cases (overrides of `global`, `workload`, `faults`, `invariants`), structural rules, a rubric, budget and optional classroom settings; see chapter 29.

## 9. Fields declared but not read

| Field                                                 | Status                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failureModes` (mtbf, mttr, trigger)                  | **read**: a `critical` mode with `mtbf` and `mttr` injects random failures (exponential up and down times, a stream of its own per node and mode); other severities and `trigger` are not read |
| `scaling` (horizontal/vertical, thresholds, cooldown) | policy fields not read (the import warns that the node does not scale); only `scaling.coldStartPenalty` is read; the autoscaler reads `config.autoscale*` (chapter 14)                         |
| `resources.workersPerInstance`, `queueSlots`          | accepted for compatibility, **not read**; the validator warns                                                                                                                                  |
| `resources.replicas`, `cpu`, `memory`, `maxReplicas`  | deprecated aliases (`replicas` is read as `instanceCount`)                                                                                                                                     |
| `dependencies` (critical, optional)                   | used by grading rules, not by the run                                                                                                                                                          |
| `presentation`, `position`, `provider`                | authoring only                                                                                                                                                                                 |

## 10. Testable expectations (summary)

- A document that violates a range in this chapter is rejected with the field named; an unknown component type or an unknown category value is rejected.
- The same document and seed produce the same output.
- A field marked "not read" has no effect on any output.
- Weights, probabilities and fractions outside their ranges are rejected.

## 11. Open items

- Decided: `failureModes` is implemented as random failure injection, the `scaling` policy fields are flagged at import, and the other unread fields keep their warnings.
- Cite: the JSON schema generated from the validator, once exported, as the machine-readable version of this chapter.
