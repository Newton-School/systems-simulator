# Test-Case Catalog — Complete Authoring Reference

> **Standalone bundled snapshot.** Use this for exact row shapes and examples
> without access to the source repository. Any `src/` or `specs/` paths mentioned
> below are provenance and are not required to use the skill.
>
> **Precedence and compatibility.** The curated
> `grading-dsl-and-evaluation.md`, `component-and-metric-catalog.md`, and the
> target Studio's visible capabilities override this catalog when they differ.
> Runtime semantic kinds `stateTransition` and `stateSequence` are supported in
> addition to the static semantic kinds summarized near the start of this file.
> The current visual Studio uses structural rules for topology obligations; do
> not assume its advanced verdict selector exposes raw `topology.*` metrics.

> A complete reference for authoring **any** simulator question from Django rows: every
> row type, every rule / criterion / check kind (with what it does), every verdict
> metric, and the full `SIMULATOR_CONFIG` field surface (workload, constraints,
> scaffold, budget, environment profile) plus the component-type vocabulary. Each row
> gives the Django **`title`**, the **`input`** JSON, and **what it does**.
>
> `input` must be **pure JSON — no `// comments`**. Omitted fields auto-derive: `id`,
> `description`, and (for `SEMANTIC_CRITERION`) `points` default to 1 / a derived label.
> Everything here was validated through the Newton builder — the rows parse as-is.
>
> **Contents:** the four row types · **1** Topology (`structuralRules` +
> `placement`/`guardedPath`/`fanout`) · **2** Scale-fit semantics (`storageFit`) ·
> **3** Simulation (`rubric` over verdict metrics) · **4** Budget · **5** the full
> `SIMULATOR_CONFIG` field reference (5a scaffold · 5b constraints · 5c suite/workload ·
> 5d environment profile) · **6** component-type vocabulary.

---

## The four row types (there are no others)

Every test-case row's `input` is one JSON object discriminated by its **`type`**. The
platform recognizes exactly **four** types; a row with any other `type` is silently
ignored.

| `type`                   | Runs a simulation?                 | What it is                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SIMULATOR_CONFIG`**   | —                                  | The **setup** row (one per question, listed first). | Boots the locked sandbox and carries everything that is _not_ a rule/criterion/check: the injected workload (`suite`), the cost/anti-kitchen-sink `budget`, hard `constraints` (e.g. max node count), the `scaffold`, `difficulty`, `workloadCategory`, and the environment/UI profile. It is not itself a graded check — it defines the exam. **Optional** now: omit it and every field defaults; add it to inject a workload, set a budget, or override a default. |
| **`STRUCTURAL_RULE`**    | No (reads the diagram)             | A **topology-shape** check.                         | Asserts the _shape_ of the graph: a component/category exists (or is capped), an edge or path connects two types, a node has enough replicas, the graph is connected, there's exactly one source. Answers **"did you build the right shape?"** Mostly pass/fail gates.                                                                                                                                                                                               |
| **`SEMANTIC_CRITERION`** | No (reads the diagram)             | A **component-meaning** check.                      | Asserts the _right kind_ of component in the right place — the correct store for the access pattern (`storageFit`), a component on the right path (`placement`), a write that can't bypass a guard (`guardedPath`), a broker that fans out (`fanout`). Carries `points`; `hardFail: true` zeroes the question when violated. Answers **"did you pick the right component?"**                                                                                         |
| **`RUBRIC_CHECK`**       | **Yes** (asserts a verdict metric) | A **behavior** check.                               | Runs the injected load through the engine and asserts a **verdict metric** `op` `value` — latency, error rate, throughput, utilization, invariants, capability counters — or a `topology.*` count (no sim). Answers **"does it perform / behave correctly under load?"** Needs a workload (from `SIMULATOR_CONFIG.suite`).                                                                                                                                           |

**Everything else is a field, not a row type.** `budget`, `constraints`, `scaffold`,
`domains`, `concepts`, `workloadCategory`, `justify`, and the `suite`/workload all live
**inside the `SIMULATOR_CONFIG` row** — there is no `BUDGET`, `CONSTRAINT`, or `JUSTIFY`
row type.

---

## The syntax — every field and its values

Read this first. A row is a flat JSON object of keys. Below is every key that can appear
in a `STRUCTURAL_RULE` / `SEMANTIC_CRITERION` / `RUBRIC_CHECK` row, with its meaning and
allowed values. (`SIMULATOR_CONFIG` keys are in §5.)

### Universal keys (any row)

- **`type`** — which row this is. One of: `"STRUCTURAL_RULE"` · `"SEMANTIC_CRITERION"` ·
  `"RUBRIC_CHECK"` · `"SIMULATOR_CONFIG"`. **Required.**
- **`id`** — a stable identifier for the check. String. _Optional_ — auto-derived from
  `kind`/`metric` if omitted (e.g. `requires-single-source`, `p99`).
- **`description`** — the human label shown to the student. String. _Optional_ —
  auto-derived from the kind if omitted.

### `kind` — the specific check (required, per `type`)

- On a **`STRUCTURAL_RULE`**, one of: `requires_single_source` · `requires_connected_graph`
  · `requires_component` · `requires_category` · `max_component_count` ·
  `forbids_component` · `requires_redundancy` · `requires_edge` · `requires_path` ·
  `min_node_count` · `max_node_count`.
- On a **`SEMANTIC_CRITERION`**, one of: `storageFit` · `placement` · `guardedPath` ·
  `fanout` · `componentPresence` · `componentProperty` · `stateTransition` ·
  `stateSequence` (plus `forbidUnjustified` where justification is supported).
- On a **`RUBRIC_CHECK`**, _optional_ and usually omitted (inferred from `metric`):
  `simulation` · `invariant` · `topology`. Set it explicitly only for `invariant`
  metrics (`invariantViolations.count`, `conservation.unbalanced`, …) or `topology.*`
  metrics.

### Keys that name a component (value = a component-`type` token from §6)

- **`componentType`** — the target node type. Used by `requires_component`,
  `max_component_count`, `forbids_component`, `requires_redundancy`, and `placement`.
  e.g. `"microservice"`, `"load-balancer"`, `"relational-db"`.
- **`fromType`** / **`toType`** — the endpoints of an edge/path. Used by `requires_edge`
  and `requires_path`.
- **`from`** / **`guard`** / **`to`** — origin / mandatory waypoint / destination of a
  `guardedPath`. (`to` is optional — omit to require only that the guard is reachable.)
- **`broker`** / **`forbiddenBroker`** — the correct / wrong broker type for `fanout`.
- **`accept`** / **`partial`** / **`antiPattern`** — arrays of component types for
  `storageFit`: full credit / partial credit / auto-fail. `accept` is required (≥1);
  the others are optional.
- **`between`** — a two-element array `[typeA, typeB]` for `placement`: the component
  must sit on a directed path from A to B.

> **Learner-_created_ nodes match these keys by their resolved `componentType`, never
> by label or builder contract.** A Service-Builder "URL Shortening Service" is a
> `microservice`; a Custom-Node "My Cache" is its backing type. Two consequences: (1)
> when the runtime is a free learner choice (service = `microservice` /
> `serverless-function` / `batch-worker`), prefer `category` or an `accept[]` set over a
> single `componentType` so a valid alternative isn't failed; (2) the builder's declared
> operations/dependencies are documentation-only and **never** graded — a `requires_edge`
> / `guardedPath` needs the learner's real edge, not a declared dependency.

### `category` — a component category (value from the category list in §6)

- **`category`** — used by `requires_category`. e.g. `"storage-and-data"`,
  `"compute"`, `"messaging-and-streaming"`.

### Count / number keys (value = a number)

- **`minCount`** — minimum nodes required (`requires_component`, `requires_category`).
  Integer ≥ 0; **defaults to 1** if omitted.
- **`maxCount`** — maximum nodes allowed (`max_component_count`). Integer.
- **`count`** — total node count bound (`min_node_count`, `max_node_count`). Integer.
- **`minReplicas`** — minimum instances on one node (`requires_redundancy`). Integer.
- **`minConsumers`** — minimum fan-out consumers (`fanout`). Integer ≥ 1.

### `storageFit` access pattern

- **`accessPattern`** — labels the workload for a `storageFit` check. One of:
  `point-lookup` · `time-series` · `append-only-ledger` · `transactional-relational` ·
  `search-index` · `blob`. (Cosmetic in grading — the `accept`/`antiPattern` lists
  decide the outcome.)

### `requires_edge` edge mode

- **`mode`** — optional edge kind the required edge must have. One of: `synchronous` ·
  `asynchronous` · `streaming` · `conditional`. Omit to match any edge.

### `RUBRIC_CHECK` assertion keys

- **`metric`** — the verdict path to assert on. e.g. `"summary.latency.p99"`,
  `"summary.errorRate"`, `"reservations.oversells"`. Full list in §3. **Required.**
- **`op`** — the comparison. One of: `<` · `<=` · `>` · `>=` · `==` · `!=`. **Required.**
- **`value`** — the threshold number to compare against. **Required.**

### Grading-weight keys

- **`points`** — how many points this check is worth. Integer ≥ 0. On
  `SEMANTIC_CRITERION` and `RUBRIC_CHECK`; **defaults to 1**. The rubric's
  `passThreshold` (a 0–1 fraction, §5) is applied to the total.
- **`hardFail`** — `true` means violating this `SEMANTIC_CRITERION` **zeroes the whole
  question** (not just loses its points). Boolean, default `false`. Use for the trap a
  student must not fall into (e.g. wrong store for the workload).

> **Rule of thumb:** `type` + `kind` pick the check; the _targeting_ keys (`componentType`
> / `fromType` / `accept` / …) say _what_ it looks at; the _number_ keys (`minCount` /
> `value` / …) say _how much_; `points` / `hardFail` say _how it scores_. Everything else
> auto-derives.

---

## 1. Topology

The shape and wiring of the graph. Graded on the diagram — no simulation runs.

### structuralRules — all 11 `STRUCTURAL_RULE` kinds

**`STRUCTURAL_RULE: single-source`** — passes when the graph has **exactly one**
traffic source (one faucet). Fails on zero or two-plus sources.

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_single_source"
}
```

**`STRUCTURAL_RULE: connected-graph`** — passes when **every node is reachable**
(no orphan/disconnected components).

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_connected_graph"
}
```

**`STRUCTURAL_RULE: requires-component`** — passes when there are **≥ `minCount`
nodes of `componentType`** (`minCount` defaults to 1). Use for "there must be a
cache / a load balancer / 3 servers".

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_component",
  "componentType": "microservice",
  "minCount": 3
}
```

**`STRUCTURAL_RULE: requires-category`** — passes when there are **≥ `minCount`
nodes in a category** (broader than a single type). Categories: `compute`,
`network-and-edge`, `storage-and-data`, `messaging-and-streaming`,
`orchestration-and-infra`, `security-and-identity`, `observability`,
`devops-and-delivery`, `data-infra-and-analytics`.

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_category",
  "category": "storage-and-data",
  "minCount": 1
}
```

**`STRUCTURAL_RULE: max-component-count`** — passes when there are **≤ `maxCount`
nodes of `componentType`**. Use to forbid over-provisioning ("at most one LB").

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "max_component_count",
  "componentType": "load-balancer",
  "maxCount": 1
}
```

**`STRUCTURAL_RULE: forbids-component`** — passes when the `componentType` is
**absent**. Use to ban a component ("no in-memory cache as the store").

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "forbids_component",
  "componentType": "in-memory-cache"
}
```

**`STRUCTURAL_RULE: requires-redundancy`** — passes when a node of `componentType`
is scaled to **≥ `minReplicas` instances** (checks the node's instance count, not the
number of nodes). Use for "run this service with ≥ 3 replicas".

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_redundancy",
  "componentType": "microservice",
  "minReplicas": 3
}
```

**`STRUCTURAL_RULE: requires-edge`** — passes when a **direct edge** exists from
`fromType` to `toType` (optionally with `mode`: `synchronous` / `asynchronous` / …).
Use for "the LB connects directly to a server".

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_edge",
  "fromType": "load-balancer",
  "toType": "microservice"
}
```

**`STRUCTURAL_RULE: requires-path`** — passes when **any directed path** (one or more
hops) connects `fromType` to `toType`. Use for "the write path reaches the store".

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "requires_path",
  "fromType": "microservice",
  "toType": "relational-db"
}
```

**`STRUCTURAL_RULE: min-node-count`** — passes when the graph has **≥ `count` total
nodes**. A coarse "build something non-trivial" floor.

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "min_node_count",
  "count": 4
}
```

**`STRUCTURAL_RULE: max-node-count`** — passes when the graph has **≤ `count` total
nodes**. A coarse anti-kitchen-sink ceiling (also settable as `constraints.maxNodeCount`).

```json
{
  "type": "STRUCTURAL_RULE",
  "kind": "max_node_count",
  "count": 12
}
```

### placement / guardedPath / fanout — wiring `SEMANTIC_CRITERION` kinds

**`SEMANTIC_CRITERION: placement`** — passes when `componentType` sits **on a directed
path between** the two `between` types. Use for "the cache is between the service and
the DB" (not dangling).

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "placement",
  "componentType": "in-memory-cache",
  "between": ["microservice", "relational-db"],
  "points": 2
}
```

**`SEMANTIC_CRITERION: guardedPath`** — passes when a path from `from` to `to` exists
**AND no path bypasses the `guard`**. The write must always go through the guard.
`hardFail: true` zeroes the whole question if bypassed.

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "guardedPath",
  "from": "api-endpoint",
  "guard": "idempotency-manager",
  "to": "relational-db",
  "points": 3,
  "hardFail": true
}
```

**`SEMANTIC_CRITERION: fanout`** — passes when the `broker` fans out to **≥
`minConsumers` independent consumers**; using the `forbiddenBroker` (queue semantics —
one consumer wins) is the wrong answer. Use for pub/sub vs. work-queue.

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "fanout",
  "broker": "message-broker",
  "minConsumers": 2,
  "forbiddenBroker": "message-queue",
  "points": 3
}
```

---

## 2. Scale-fit Semantics

The _right kind_ of component for the workload — graded on component choice, not shape.

**`SEMANTIC_CRITERION: storageFit`** — passes when the store present is in **`accept`**
(full credit), partial credit for **`partial`**, and **fails on `antiPattern`** (with
`hardFail: true` → zeroes the question). `accessPattern` labels the failure message and
must be one of: `point-lookup`, `time-series`, `append-only-ledger`,
`transactional-relational`, `search-index`, `blob`.

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "storageFit",
  "accessPattern": "point-lookup",
  "accept": ["kv-store", "nosql-db"],
  "partial": ["in-memory-cache"],
  "antiPattern": ["relational-db"],
  "points": 3,
  "hardFail": true
}
```

Same kind, different access patterns (the "scale-aware" variants — pick the pattern that
matches the workload the question injects):

**`SEMANTIC_CRITERION: transactional-store`** — money/contended state needs ACID.

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "storageFit",
  "accessPattern": "transactional-relational",
  "accept": ["relational-db"],
  "partial": ["nosql-db"],
  "antiPattern": ["in-memory-cache"],
  "points": 3,
  "hardFail": true
}
```

**`SEMANTIC_CRITERION: time-series-store`** — high-write append + range-by-time.

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "storageFit",
  "accessPattern": "time-series",
  "accept": ["time-series-db"],
  "antiPattern": ["relational-db"],
  "points": 2
}
```

**`SEMANTIC_CRITERION: ledger-store`** — immutable append-only (payments/audit).

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "storageFit",
  "accessPattern": "append-only-ledger",
  "accept": ["relational-db", "nosql-db"],
  "antiPattern": ["in-memory-cache"],
  "points": 2
}
```

**`SEMANTIC_CRITERION: search-store`** — full-text search.

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "storageFit",
  "accessPattern": "search-index",
  "accept": ["search-index"],
  "antiPattern": ["relational-db"],
  "points": 2
}
```

**`SEMANTIC_CRITERION: blob-store`** — large immutable objects (media).

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "storageFit",
  "accessPattern": "blob",
  "accept": ["object-storage"],
  "antiPattern": ["relational-db"],
  "points": 2
}
```

---

## 3. Simulation

Performance/correctness under the injected load. Each `RUBRIC_CHECK` asserts a **verdict
metric** `op` `value`. `kind` is inferred from the metric — omit it unless the metric is
invariant or topology. Operators: `<` `<=` `>` `>=` `==` `!=`. **Needs a workload** —
add a `suite` to the `SIMULATOR_CONFIG` (§5).

**`RUBRIC_CHECK: p99-latency`** — the tail latency must stay under the target.

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "summary.latency.p99",
  "op": "<",
  "value": 100,
  "points": 3
}
```

**`RUBRIC_CHECK: error-rate`** — the fraction of failed requests must stay low.

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "summary.errorRate",
  "op": "<",
  "value": 0.05,
  "points": 2
}
```

**`RUBRIC_CHECK: throughput`** — the design must sustain a minimum completions/sec.

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "summary.throughput",
  "op": ">=",
  "value": 150,
  "points": 2
}
```

**`RUBRIC_CHECK: max-utilization`** — no single node may be pinned at capacity (a
bottleneck). `perNode.maxUtilization` is the busiest node's utilization.

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "perNode.maxUtilization",
  "op": "<",
  "value": 0.9,
  "points": 1
}
```

**`RUBRIC_CHECK: no-invariants`** — no physically-impossible states occurred. Invariant
metric → set `kind: "invariant"`.

```json
{
  "type": "RUBRIC_CHECK",
  "kind": "invariant",
  "metric": "invariantViolations.count",
  "op": "==",
  "value": 0,
  "points": 1
}
```

**`RUBRIC_CHECK: conservation`** — requests-in equals requests-out+rejected at every
node (no requests vanish). Invariant metric.

```json
{
  "type": "RUBRIC_CHECK",
  "kind": "invariant",
  "metric": "conservation.unbalanced",
  "op": "==",
  "value": 0,
  "points": 1
}
```

**`RUBRIC_CHECK: no-double-book`** — correctness: a contended key was never committed by
two reservation authorities (the reservation-store model).

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "reservations.oversells",
  "op": "==",
  "value": 0,
  "points": 5
}
```

**`RUBRIC_CHECK: retry-budget`** — retries didn't amplify into give-ups (retry storms).

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "retries.budgetExhausted",
  "op": "==",
  "value": 0,
  "points": 2
}
```

**`RUBRIC_CHECK: lock-contention`** — distributed-lock contention stayed bounded.

```json
{
  "type": "RUBRIC_CHECK",
  "metric": "locks.contentions",
  "op": "<",
  "value": 500,
  "points": 2
}
```

**`RUBRIC_CHECK: topology-count`** — a graph-count assertion graded as a rubric check
(no sim). Topology metric → set `kind: "topology"`; metric must start with `topology.`.

```json
{
  "type": "RUBRIC_CHECK",
  "kind": "topology",
  "metric": "topology.componentCounts.microservice",
  "op": ">=",
  "value": 3,
  "points": 1
}
```

**Every addressable verdict metric** (same `metric`/`op`/`value` pattern):

- **Latency:** `summary.latency.p50` · `.p90` · `.p95` · `.p99` · `.min` · `.max` · `.mean`
- **Throughput / volume:** `summary.throughput` · `summary.totalRequests` · `summary.successfulRequests` · `summary.failedRequests`
- **Errors:** `summary.errorRate`
- **Per-node worst case:** `perNode.maxUtilization` · `perNode.maxErrorRate` · `perNode.maxLatencyP99`
- **Invariant (`kind: "invariant"`):** `invariantViolations.count` · `sloBreaches.count` · `conservation.unbalanced` · `littlesLaw.violations`
- **Topology (`kind: "topology"`):** `topology.nodeCount` · `topology.edgeCount` · `topology.sourceCount` · `topology.totalWorkers` · `topology.totalReplicas` · `topology.componentCounts.<type>` · `topology.categoryCounts.<category>`
- **Capability counters (run-wide):** `reservations.oversells` · `reservations.commits` · `reservations.conflicts` · `locks.acquires` · `locks.contentions` · `locks.keyless` · `retries.attempts` · `retries.budgetExhausted` · `rateLimit.breaches` · `rateLimit.admitted` · `rateLimit.rejected` · `rateLimit.keyless`
- **V2 distributed-systems counters (per-node only — `perNode.<nodeId>.traitCounters.<counter>`, or grade via a runtime `stateTransition` criterion, below):**
  - replication: `replicationQuorumWrites` · `replicationPrimaryAcks` · `replicationQuorumFailures` · `replicationLeaderPromotions` · `replicationFailoverRejects` · `replicationReplicaReads` · `replicationStaleReadsPossible`
  - stream: `streamAppends` · `streamPartitionRoutes` · `streamGroupDeliveries` · `streamOffsetCommits` · `streamRetentionExpired` · `streamReplayReads` · `streamConsumerRebalances` · `streamBrokerFailures` · `streamBrokerRecoveries` · `streamBrokerUnavailable`
  - protocol: `protocolL7Rejects` · `protocolFlowControlled` · `protocolSessionsOpened` · `protocolSessionsClosed` · `protocolHttpAcks`
  - idempotency/commit-outcome: `idempotencyDuplicateHits` · `idempotencyUniqueKeys` · `idempotencyKeysMissing` · `idempotencyOutcomeUnknown` · `idempotencyReconciliations` · `idempotencySafeRetries` · `externalReconciliationProbes`

### Runtime semantic criteria (`stateTransition` / `stateSequence`)

`SEMANTIC_CRITERION` kinds that read the per-request `stateTimeline` instead of the graph — the preferred way to grade V2 behavior. Scopes → states:

| scope            | states                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `request`        | generated · admitted · queued · processing · forwarded · retry-scheduled · completed · timed-out · rejected · in-flight |
| `delivery`       | producer-acked · released-to-consumer · redelivery-scheduled · dlq-routed                                               |
| `broker`         | partition-assigned · group-delivered · offset-committed · retention-expired · broker-unavailable · broker-recovered     |
| `replication`    | quorum-committed · quorum-unavailable · replica-read · stale-read-possible · leader-promoted · failover-in-progress     |
| `protocol`       | session-open · session-closed · http-acknowledged · l7-rejected · flow-controlled                                       |
| `idempotency`    | recorded · deduped · key-missing                                                                                        |
| `commit-outcome` | intent-recorded · commit-confirmed · outcome-unknown · replay-blocked                                                   |
| `lock`           | attempting · acquired · contended · held · released · key-missing                                                       |
| `reservation`    | committed · sold-out · oversold · key-missing                                                                           |

```json
{
  "type": "SEMANTIC_CRITERION",
  "kind": "stateTransition",
  "match": {
    "scope": "replication",
    "state": "quorum-unavailable"
  },
  "maxCount": 0,
  "hardFail": true,
  "points": 4
}
```

Full matcher/filter syntax: `specs/runtime-semantic-criteria.md`.

---

## 4. Budget

Cost / anti-kitchen-sink. **Not a standalone row** — it's a `budget` field inside the
`SIMULATOR_CONFIG` row. A design over the cap fails the budget check. `unit` is `cost`
(USD/hr), `nodes`, or `edges`.

**Cost cap** — total provisioned $/hr must stay within the cap.

```json
{
  "type": "SIMULATOR_CONFIG",
  "budget": {
    "unit": "cost",
    "cap": 5
  },
  "suite": {
    "cases": [
      {
        "workload": {
          "baseRps": 100,
          "requestDistribution": [
            {
              "type": "GET"
            }
          ]
        }
      }
    ]
  }
}
```

**Node cap** — at most N nodes may be used.

```json
{
  "type": "SIMULATOR_CONFIG",
  "budget": {
    "unit": "nodes",
    "cap": 8
  }
}
```

**Edge cap** — at most N edges may be used.

```json
{
  "type": "SIMULATOR_CONFIG",
  "budget": {
    "unit": "edges",
    "cap": 10
  }
}
```

---

## 5. The `SIMULATOR_CONFIG` row — every field as a row

Optional wrapper. Add it to inject a workload (needed for any Simulation check), set a
`budget`/`constraints`, seed a `scaffold`, or override a default. Everything except
`type` defaults. Each row below shows one field populated.

**`SIMULATOR_CONFIG: minimal`** — the whole thing, when you only need structural/semantic checks.

```json
{
  "type": "SIMULATOR_CONFIG"
}
```

**`SIMULATOR_CONFIG: identity`** — `questionId` (defaults to a slug of the title); `questionType` is the task archetype — one of `open-build` · `fix` · `optimize` · `scaling` · `ha-chaos` · `tradeoff` · `build-budget` (default `open-build`); `difficulty` is `beginner` · `intermediate` · `advanced` · `expert`.

```json
{
  "type": "SIMULATOR_CONFIG",
  "questionId": "url-shortener",
  "questionType": "open-build",
  "difficulty": "advanced"
}
```

**`SIMULATOR_CONFIG: lesson-metadata`** — `workloadCategory` (author-side hint for the dominant axis; not shown as the answer) is `read-heavy` · `write-heavy` · `connection-heavy` · `correctness-heavy` · `batch-heavy`; `entryFormat` (learner-entry shell) is `blank-canvas` · `requirements-first` · `partial-scaffold` · `broken-scaffold` · `baseline-optimize` · `locked-lab`; `domains` declares the lesson and **drives edit policy** (`network` unlocks edge editing, `cost` unlocks resource editing) — any of `compute` · `storage` · `network` · `resilience` · `correctness` · `cost`; `concepts` is free-form tags.

```json
{
  "type": "SIMULATOR_CONFIG",
  "workloadCategory": "read-heavy",
  "entryFormat": "requirements-first",
  "domains": ["storage", "compute"],
  "concepts": ["read-cache", "store-fit"]
}
```

**`SIMULATOR_CONFIG: pass-threshold`** — `rubric.passThreshold` is a **fraction 0–1** (e.g. `0.71` = earn 71% of rubric points to pass); `rubric.id` is an optional label.

```json
{
  "type": "SIMULATOR_CONFIG",
  "rubric": {
    "id": "my-rubric",
    "passThreshold": 0.71
  }
}
```

### 5a. `scaffold` — the starting canvas

`type` is `empty` (blank) · `partial` (pre-seeded design) · `complete` (full design, e.g.
an optimize/fix task). `topology` holds the pre-placed nodes/edges; `lockedNodeIds` /
`lockedEdgeIds` are pieces the student can't edit; `baselineVerdict` is the "beat this"
target for `baseline-optimize`.

**`SIMULATOR_CONFIG: scaffold-empty`** — blank canvas (the default).

```json
{
  "type": "SIMULATOR_CONFIG",
  "scaffold": {
    "type": "empty"
  }
}
```

**`SIMULATOR_CONFIG: scaffold-partial`** — seed a design; here the source node is locked.

```json
{
  "type": "SIMULATOR_CONFIG",
  "scaffold": {
    "type": "partial",
    "lockedNodeIds": ["client"],
    "topology": {
      "id": "seed",
      "name": "seed",
      "version": "1.0.0",
      "global": {
        "seed": "s",
        "simulationDuration": 30000,
        "warmupDuration": 5000,
        "timeResolution": "millisecond",
        "defaultTimeout": 5000
      },
      "nodes": [
        {
          "id": "client",
          "type": "api-endpoint",
          "category": "compute",
          "role": "source",
          "label": "Client",
          "position": {
            "x": 0,
            "y": 0
          }
        }
      ],
      "edges": []
    }
  }
}
```

### 5b. `constraints` — hard limits

`canModifyScaffold` / `canRemoveScaffoldNodes` are booleans (default `true`, auto-filled);
`maxNodeCount` / `maxTotalWorkers` are int caps (graded); `maxBudget` is a $/hr cap;
`allowedNodeTypes` is a whitelist and `forbiddenNodeTypes` a blacklist of component types.

> **Applies to learner-created nodes too.** Nodes built with the Service Builder /
> Custom Node Builder serialize to a real component type (a service → `microservice` /
> `serverless-function` / `batch-worker`; a custom node → its backing type), so
> `allowedNodeTypes` / `forbiddenNodeTypes` gate them exactly like palette-placed nodes.
> This is the _only_ per-question lever over creation today — there is no builder-level
> policy yet. Use it so a learner can't simply _build_ the exact node the question tests
> (e.g. forbid the anti-pattern store on a "pick the right storage" question).

**`SIMULATOR_CONFIG: constraints`** — cap the node count and ban a component.

```json
{
  "type": "SIMULATOR_CONFIG",
  "constraints": {
    "canModifyScaffold": true,
    "canRemoveScaffoldNodes": true,
    "maxNodeCount": 12,
    "maxTotalWorkers": 64,
    "forbiddenNodeTypes": ["in-memory-cache"]
  }
}
```

**`SIMULATOR_CONFIG: constraints-whitelist`** — only these component types may be placed.

```json
{
  "type": "SIMULATOR_CONFIG",
  "constraints": {
    "canModifyScaffold": true,
    "canRemoveScaffoldNodes": true,
    "allowedNodeTypes": ["api-endpoint", "microservice", "relational-db", "in-memory-cache"]
  }
}
```

### 5c. `suite` — the injected graded workload

`suite.cases[]` is the load fired at the student's design at grade time (question-owned —
the student can't lower it). `name` / `visibleToStudent` default; each case has an optional
`id`/`description`, a `workload`, and optional `global` (override duration/seed/warmup) and
`faults` (chaos). The `workload`: `baseRps` (requests/sec), `pattern` (`constant` ·
`poisson` · `bursty` · `diurnal` · `spike` · `sawtooth` · `replay`, default `constant`),
and `requestDistribution[]`. Each distribution entry: `type` (traffic class, matched in
edge conditions like `request.type === "read"`), `weight` (0–1, defaults to `1/n`),
`sizeBytes` (default 256), optional `metadata` (attached to each request), and optional
`keyspace` (`{ field, size }` → per-request key from `size` distinct keys = contention).

**`SIMULATOR_CONFIG: workload-constant`** — steady read-heavy mix.

```json
{
  "type": "SIMULATOR_CONFIG",
  "suite": {
    "cases": [
      {
        "workload": {
          "baseRps": 2000,
          "pattern": "constant",
          "requestDistribution": [
            {
              "type": "read",
              "weight": 0.99,
              "sizeBytes": 256
            },
            {
              "type": "write",
              "weight": 0.01,
              "sizeBytes": 512
            }
          ]
        }
      }
    ]
  }
}
```

**`SIMULATOR_CONFIG: workload-spike`** — a traffic spike partway through the run.

```json
{
  "type": "SIMULATOR_CONFIG",
  "suite": {
    "cases": [
      {
        "id": "peak-spike",
        "workload": {
          "baseRps": 1000,
          "pattern": "spike",
          "spike": {
            "spikeTime": 10000,
            "spikeRps": 5000,
            "spikeDuration": 3000
          },
          "requestDistribution": [
            {
              "type": "GET"
            }
          ]
        }
      }
    ]
  }
}
```

**`SIMULATOR_CONFIG: workload-contended`** — a contended keyspace (reservation / no-double-book).

```json
{
  "type": "SIMULATOR_CONFIG",
  "workloadCategory": "correctness-heavy",
  "suite": {
    "cases": [
      {
        "id": "on-sale-burst",
        "workload": {
          "baseRps": 1500,
          "requestDistribution": [
            {
              "type": "book",
              "weight": 1,
              "keyspace": {
                "field": "seatId",
                "size": 40
              }
            }
          ]
        }
      }
    ]
  }
}
```

**`SIMULATOR_CONFIG: workload-idempotency`** — request `metadata` (e.g. an idempotency key).

```json
{
  "type": "SIMULATOR_CONFIG",
  "suite": {
    "cases": [
      {
        "workload": {
          "baseRps": 500,
          "requestDistribution": [
            {
              "type": "create-payment",
              "metadata": {
                "idempotencyKey": "pay-001"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### 5d. `environmentProfile` — the mode + visibility + capabilities lens

Controls what the student sees and may edit (defaults to `ASSIGNMENT`). `mode` is `AUTHOR`
(full UI) · `ASSIGNMENT` (graded exam) · `PRACTICE` (self-paced); `graded` toggles graded
Submit; `chromeDensity` is `full` · `minimal`. `visibility.*` are booleans except
`rubricChecks` = `HIDDEN` · `LIVE_DURING_BUILD` · `POST_SUBMIT_ONLY`. `capabilities.edgeModel`
is `network` (modeled edges) · `connector` (dumb wires); the other capabilities
(`canEditEdges`, `canEditScaffoldNodes`, `canEditResources`, `canEditExecutionProfile`,
`canTriggerTestRuns`) are booleans; `editPaletteList` restricts the palette (or `null`).

**`SIMULATOR_CONFIG: environment-assignment`** — the standard locked assignment lens.

```json
{
  "type": "SIMULATOR_CONFIG",
  "environmentProfile": {
    "mode": "ASSIGNMENT",
    "graded": true,
    "chromeDensity": "minimal",
    "visibility": {
      "prompt": true,
      "scaffoldSourceNodes": true,
      "gradingSuiteDetails": false,
      "liveMetrics": true,
      "rubricChecks": "LIVE_DURING_BUILD"
    },
    "capabilities": {
      "edgeModel": "connector",
      "canEditEdges": false,
      "canEditResources": false,
      "canEditExecutionProfile": false,
      "canTriggerTestRuns": true
    }
  }
}
```

### 5e. Full example — everything in one row

```json
{
  "type": "SIMULATOR_CONFIG",
  "questionId": "flash-sale-booking",
  "questionType": "open-build",
  "difficulty": "advanced",
  "workloadCategory": "correctness-heavy",
  "domains": ["storage", "correctness"],
  "concepts": ["atomic-reservation", "no-double-book"],
  "scaffold": {
    "type": "empty"
  },
  "constraints": {
    "canModifyScaffold": true,
    "canRemoveScaffoldNodes": true,
    "maxNodeCount": 12
  },
  "budget": {
    "unit": "cost",
    "cap": 5
  },
  "suite": {
    "cases": [
      {
        "id": "on-sale-burst",
        "workload": {
          "baseRps": 1500,
          "requestDistribution": [
            {
              "type": "book",
              "weight": 1,
              "keyspace": {
                "field": "seatId",
                "size": 40
              }
            }
          ]
        }
      }
    ]
  },
  "rubric": {
    "id": "flash-sale-rubric",
    "passThreshold": 0.71
  },
  "environmentProfile": {
    "mode": "ASSIGNMENT",
    "graded": true,
    "chromeDensity": "minimal"
  }
}
```

---

## 6. Component-type vocabulary

The tokens you reference in `componentType` / `fromType` / `toType` / `accept` /
`antiPattern` are node **`type`s**. Palette label → `type`, by category:

**Compute** — API Server → `microservice` · Serverless Fn → `serverless-function` ·
Job Worker / Cron Job → `batch-worker` · Auth Service → `auth-service` ·
Search Service → `search-service` · Sidecar Proxy → `sidecar` ·
Client App / Input Source → `api-endpoint`

**Storage & Data** — Primary DB / Read Replica → `relational-db` ·
Redis Cache → `in-memory-cache` · NoSQL DB → `nosql-db` ·
Object Storage → `object-storage` · Search Index → `search-index` ·
Time-series DB → `time-series-db` · Graph DB → `graph-db` · Vector DB → `vector-db` ·
Data Warehouse → `data-warehouse` · Data Lake → `data-lake` · KV Store → `kv-store`

**Network & Edge** — Load Balancer → `load-balancer` (L4 → `load-balancer-l4`,
L7 → `load-balancer-l7`) · Ingress Controller → `ingress-controller` ·
Reverse Proxy → `reverse-proxy` · Service Mesh → `service-mesh` ·
API Gateway → `api-gateway` · CDN → `cdn` · Edge Router → `edge-router` ·
NAT Gateway → `nat-gateway` · VPN Gateway → `vpn-gateway`

**Messaging & Streaming** — Message Queue → `queue` · Event Broker → `message-broker` ·
Pub/Sub → `pub-sub` · Event Stream → `stream`

**Coordination / Auxiliary** — Rate Limiter → `rate-limiter` ·
Circuit Breaker → `circuit-breaker-controller` · Distributed Lock → `distributed-lock` ·
Idempotency Guard → `idempotency-manager` · Reservation Store → `reservation-store` ·
Sharding → `sharding` · Hashing → `hashing` · Shard Node → `shard-node` ·
Partition Node → `partition-node`

**Orchestration / Infra** — Discovery Service → `service-registry` ·
Config Store → `config-store` · Secrets Manager → `secrets-manager` ·
Feature Flag Service → `feature-flag-service`

### 6a. Capability-carrying types (V2 distributed-systems traits)

Placing these types (and enabling their config) turns on runtime state machines
that emit the counters and `stateTimeline` scopes in §3:

- **`stream`** → partitioned-broker: partition assignment, one-delivery-per-group,
  offset commits, retention, replay, rebalancing, availability (`broker` scope).
- **`relational-db` / `nosql-db`** with `replicationEnabled: true` → replication:
  primary/quorum ack, leader promotion, replica-read staleness, failover window
  (`replication` scope). Config: `writeAckPolicy` (`primary`|`quorum`),
  `replicaMembers`, `consensusProtocol` (`raft`|`none`), `replicationLagMs`,
  `failoverUntilMs`, `replicationRole`.
- **`load-balancer-l4` / `load-balancer-l7` / `api-gateway`** → protocol/session:
  connection lifecycle, HTTP ack mode, L4-vs-L7 policy, WebSocket flow control
  (`protocol` scope). Config: `sessionProtocol` (`http`|`http2`|`tcp`|`websocket`).
- **`rate-limiter` / `api-gateway` / `throttler`** → rate limiter: token-bucket /
  fixed-window / sliding-window admission, keyed per client, with a cross-node
  breach oracle (`rateLimit.breaches`). Config: `algorithm`, `limit`, `windowMs`,
  `rateLimitKeyField`. See `specs/rate-limiter-admission-and-breach-model.md`.
- **`idempotency-manager`** → dedup + commit-outcome journal + external
  reconciliation (`idempotency` and `commit-outcome` scopes).

**Observability** — Metrics Collector → `metrics-store` ·
Log Collector / Centralized Logging → `centralized-logging` ·
Tracing Collector → `distributed-tracing` · Alerting Engine → `alerting-hook` ·
Health Check Manager → `health-check-manager`

**Categories** (for `requires_category` / `topology.categoryCounts.<category>`):
`compute` · `network-and-edge` · `storage-and-data` · `messaging-and-streaming` ·
`orchestration-and-infra` · `security-and-identity` · `observability` ·
`devops-and-delivery` · `data-infra-and-analytics`.

---

## Notes

- **A note on `forbidUnjustified`.** There is a fifth `SEMANTIC_CRITERION` kind,
  `forbidUnjustified` (forbids a component unless the student justifies it). It pairs
  with the justification feature, which is **disabled in the Newton assignment flow
  today** — don't author it there.
- The same `SEMANTIC_CRITERION` type spans two axes by `kind`:
  `placement`/`guardedPath`/`fanout` grade **Topology**; `storageFit` grades
  **Scale-fit semantics**.
- Component-type tokens are node `type`s; the palette label maps to one (e.g.
  **API Server → `microservice`**, **Load Balancer → `load-balancer`**,
  **Primary DB → `relational-db`**, **KV Store → `kv-store`**,
  **Redis Cache → `in-memory-cache`**, **Object Storage → `object-storage`**).
- All rows above were validated through the Newton builder — they parse as-is.
