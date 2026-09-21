# Evaluation Authoring - Reference Manual & DSL Guidebook (Domain-Specific Language)

> **Standalone bundled snapshot.** This manual is included so an LLM can perform
> deep DSL, node-sizing, environment-profile, and Django/Newton lookup without
> access to the source repository. File paths and companion-spec links below are
> provenance, not runtime dependencies.
>
> **Precedence and compatibility.** Read this after the skill's curated
> `simulator-feasibility.md`, `grading-dsl-and-evaluation.md`, and
> `question-studio-authoring.md`. Those files and controls visible in a newer
> target Studio override this snapshot. Notably: high-rate steady-state capacity
> questions may run through the analytic/fluid model at their real RPS, so the
> 2,000–5,000 RPS guidance below applies to tractable discrete-event runs, not
> every question. Runtime proxies and state/counter evidence also exist for
> reservations, locks, retries, rate limiting, replication, streams, protocol,
> and idempotency; they do not constitute formal proofs of real-world guarantees.

> **Scope.** The complete, authoritative reference for authoring **system-design
> evaluation questions** (`QuestionPackage`) for the ns-simulator: every
> configurable property, schema constraint, structural rule, semantic check,
> simulation metric, justification field, budget, and validation requirement
> needed to author **discriminatory** questions.
>
> **Source of truth.** `src/engine/analysis/{question,gradingCriteria,rubric,structural,semanticCriteria,justification,authoringValidator,environmentProfile}.ts`;
> the node-sizing model in `src/engine/catalog/{instanceCatalog,resourceDefaults,componentSpecs}.ts`
>
> - `src/engine/nodes/resourceDerivation.ts`; the Newton authoring bridge in
>   `src/engine/analysis/newtonGamePlayground.ts`.
>   Validated by `parseQuestionPackage` (schema) + `validateAuthoredQuestion`
>   (authoring contract). Companion specs: `question-simulation-alignment.md`,
>   `question-grading-model-and-anti-gaming.md`, `question-bank-initial-game-states.md`,
>   `resource-allocation-and-derived-concurrency.md`.
>
> **What's new (2026-08).** Node capacity is now derived from a discrete **instance
> model** (§9), not free-typed workers; every node has an **execution profile**
> (`cpu-bound` / `io-bound`) that decides how many concurrent workers its hardware
> yields (§9.3 - this is why a datastore shows 64-128 "workers/connections" while a
> compute service shows 2). Assignment behaviour (locked resources, connector edges,
> execution-profile lock) is governed by an **environment profile** (§10). Newton
> assignments are authored as **Django test-case rows**, not a raw `question.json`
> (§11).
>
> **What's new (2026-08, later).** Authoring the Django rows is now **forgiving**:
> `SIMULATOR_CONFIG` is optional and every field auto-derives (`id` / `description` /
> `points` / workload `weight`+`sizeBytes` / suite name+case ids / constraint booleans —
> §11.3a), so rows are **atomic** (`{ "type": "STRUCTURAL_RULE", "kind":
"requires_single_source" }`). The prompt always renders (preview mode + actionable
> errors on bad config; §11.1). New **contention** modeling: a `keyspace` on a workload
> class (§2.3) plus a `reservation-store` component surface **`reservations.oversells`**
> (no-double-book), and `locks.*` / `retries.*` run-wide metrics exist (§4.2). `budget`
> is authored inside the `SIMULATOR_CONFIG` row (§6.2, §11.4).

---

## Section 1 - Philosophy & The Authoring Recipe

### 1.1 Discriminatory authoring

A question is only "authored" (vs merely "written") when it **discriminates**: a
_good_ design passes and a _gamed_ design fails **on the intended axis**. Gaming
is any way to pass without the target competence - over-provisioning a single
node, tuning a metric, using the wrong-but-tolerated store, memorizing prose.
Discrimination comes from grading **≥3 orthogonal axes**:

| Axis                | Symbol | Graded by                                               | Measures                         |
| ------------------- | ------ | ------------------------------------------------------- | -------------------------------- |
| Topology            | **T**  | `structuralRules`, `placement`, `guardedPath`, `fanout` | shape of the graph               |
| Scale-fit semantics | **S**  | `storageFit`, scale-aware checks                        | right component for the workload |
| Simulation          | **Σ**  | `rubric` checks over verdict metrics                    | performance under injected load  |
| Justification       | **J**  | `justify` prompts (graph-consistent)                    | reasoning, tradeoffs             |
| Budget              | **$**  | `budget`                                                | cost / anti-kitchen-sink         |

Gaming one axis is caught by another. Correctness properties the sim cannot
measure (exactly-once, no-double-book) are carried by **T + J**.

### 1.2 The Dual-Topology Rule (mandatory validation loop)

Every question MUST be validated by grading **two** topologies through
`sim evaluate question`:

1. **Reference topology** - a correct solution → expect **PASS** (full score).
2. **Gamed topology** - a deliberately-wrong solution → expect **FAIL** on the
   _intended_ check (read the failing `detail`).

```bash
sim evaluate question <package.json> <reference-topology.json>   # exit 0, full score
sim evaluate question <package.json> <gamed-topology.json>       # non-zero, fails intended axis
```

If the gamed design passes, the question is **under-constrained** - tighten the
`semanticCriteria`/`rubric`. A question that has not been graded both ways is not
authored. (Every kind in this manual was validated this way - see
`question-bank-initial-game-states.md` §Validation status.)

### 1.3 Workload characterization

`workloadCategory` selects which axis dominates and what load is injected. It is
an **author-side selector**, optionally surfaced to the student as a hint - **not**
the teaching mechanism (the student should infer the character from the FRs +
scale numbers and be forced into the right design by the simulation).

| `workloadCategory`  | Injected load                                   | Dominant axis                 | Canonical hard problem                            |
| ------------------- | ----------------------------------------------- | ----------------------------- | ------------------------------------------------- |
| `read-heavy`        | high read `requestDistribution` (e.g. 99% read) | Σ + S                         | caching is mandatory (store saturates without it) |
| `write-heavy`       | high write mix                                  | S + Σ                         | storage-fit for write throughput (right DB)       |
| `connection-heavy`  | fan-out / shared-state traffic                  | T                             | broker fan-out, shared counters                   |
| `correctness-heavy` | modest load                                     | **T + J** (NOT Σ)             | exactly-once, no-double-book, ordering            |
| `batch-heavy`       | sustained throughput, latency-insensitive       | Σ (throughput) + T (pipeline) | ordered pipeline, dedup, aggregate throughput     |

> **"Equal"** read/write is authored as a `requestDistribution` with `read`/`write`
> weights ~0.5/0.5 and no single dominant axis; the grade then rests on structure +
> justification. There is no `equal` enum value - express it via the distribution.
>
> **CPU-bound / resource-allocation questions.** There is also **no**
> `workloadCategory: "compute"` enum in the shipped schema. Author those as an
> existing workload character (`batch-heavy` is the usual fit for sustained
> throughput work), then declare the lesson explicitly in `domains`
> (for example `["compute"]` or `["compute", "cost"]`).

---

## Section 2 - Workload & Scale Configuration

### 2.1 Where workload is authored (and where it is NOT)

- **Graded workload = question JSON** (`suite.cases[].workload`), injected over the
  student's topology at grade time via `mergeTopologyWithOverrides`. Question-owned
  (anti-gaming): the student cannot lower the load, reseed, or change the mix.
- **The request mix is JSON-only.** Neither the canvas scenario editor
  (`ScenarioState.workloadOverride`) nor a source node's `defaultWorkload` can carry
  a `requestDistribution` - both are typed `Omit<WorkloadProfile, 'sourceNodeId' | 'requestDistribution'>`.
  So read/write character is set **exclusively** in the question package.
- The student's on-canvas scenario (RPS/pattern/source/faults) affects only their
  own dry-runs and is **overridden** by the injected suite at grade time.

### 2.2 Tractable vs display scale

| Field                            | Purpose                                                                    | Value guidance                  |
| -------------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `prompt.scale.peakRps`           | **display** - the real-world target shown in the brief                     | the real number (e.g. `200000`) |
| `prompt.scale.readWriteRatio`    | **display** - shown as `99:1`; also the source the sim mix _should_ mirror | the real ratio                  |
| `suite.cases[].workload.baseRps` | **tractable simulation load** the browser can actually run                 | **~2,000-5,000** rps            |

The browser cannot run 200K rps × 30s (6M events). Author a **representative**
`baseRps` that still stresses the design, and size nodes + thresholds together.
`prompt.scale` numbers are display/derivation inputs; they do not run.

### 2.3 Traffic distributions (`requestDistribution`)

An array of typed traffic classes on the injected workload. Types are matched by
routing conditions (`request.type === "read"`) and GET/POST is inferred from the
type token.

```json
"workload": {
  "baseRps": 2000,
  "requestDistribution": [
    { "type": "read",  "weight": 0.99, "sizeBytes": 256 },
    { "type": "write", "weight": 0.01, "sizeBytes": 512 }
  ]
}
```

| Field       | Required           | Rule                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`      | ✅                 | free string; used in edge `condition` (`request.type === "read"`) and GET/POST inference                                                                                                                                                                                                                                        |
| `weight`    | ✅                 | fraction 0-1; weights across the array should sum to 1.0                                                                                                                                                                                                                                                                        |
| `sizeBytes` | ✅ (full topology) | payload bytes - drives bandwidth/serialization; **a full topology's entries require it** (the suite override tolerates its absence, and the Newton row builder defaults it to 256, but a merged full topology does not)                                                                                                         |
| `metadata`  | optional           | untyped `Record<string, unknown>` attached to each request (e.g. `idempotencyKey`); read by capability traits (idempotency/reservation), not by grading directly                                                                                                                                                                |
| `keyspace`  | optional           | `{ "field": string, "size": number }` - stamps each request a key drawn from `size` distinct keys, creating **contention** over a small keyspace. This is what drives reservation / no-double-book questions (a small `size` under high RPS makes many requests fight over the same key). Read as `reservations.oversells` etc. |

> **Why declare payload sizes.** `sizeBytes` feeds edge bandwidth and transfer
> time; omitting it on a full topology fails validation
> (`workload.requestDistribution.N.sizeBytes: expected number, received undefined`).

**The read/write mix only _matters_ when BOTH** (a) it is injected as typed
traffic **and** (b) the topology routes on type (`condition: request.type === "read"`).
A distribution with no type-conditional routing leaves reads and writes on the
same path, so the ratio has no effect (alignment §9).

### 2.4 Current topology-default semantics that affect authored questions

The question DSL owns the **suite workload**, but authored reference / gamed
topologies still inherit important simulator defaults. These are the ones that
matter today:

| Surface                                                                   | Current behavior                                                                                                                                                                                                                                                   | Authoring consequence                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suite.cases[].workload.pattern`                                          | If you author a full workload, `pattern` must be explicit. The product's interactive defaults now favor **`constant`** traffic for predictability.                                                                                                                 | For deterministic graded cases, prefer `constant` unless arrival jitter is part of the lesson. Use `poisson` only intentionally.                                                                                                               |
| Edge latency when no explicit edge latency is authored                    | The renderer/serializer now resolves a bare edge to a **path-type-derived constant median latency (no jitter)**. Log-normal latency only appears when the edge explicitly chooses the log-normal model or supplies `mu` / `sigma`.                                 | If the question depends on latency variance or burst bunching, author explicit log-normal edge latency in the topology. Do not assume omitted latency means jitter.                                                                            |
| Node capacity when `resources.instanceType` / `instanceCount` are present | The engine now treats the **instance model** as authoritative for effective concurrency on that node (derived from vCPU × count × execution profile - **§9**). Legacy nodes with no instance-model resources still run off raw `queue.workers` / `queue.capacity`. | For saturation / scaling questions, treat `resources` as part of the real topology DSL. Once you opt into instance-model resources, raw queue numbers are no longer the whole story - size via `instanceType` + `workloadKind`, not `workers`. |
| Cost in the live product vs cost in question grading                      | The app now has a richer instance-aware live cost model and resource displays, but **`budget.unit:"cost"` in question grading still uses the older v1 heuristic** from `budget.ts`.                                                                                | Do not assume the UI cost chip and the graded `$` axis are numerically identical. Use `budget.nodes` / `budget.edges` for hard anti-kitchen-sink caps; treat `budget.cost` as a heuristic grading axis until the grading DSL is upgraded.      |

For authored question packages, the safest practice is:

- always set `suite.cases[].workload.pattern` explicitly,
- author edge latency explicitly whenever edge jitter is part of the discriminator,
- and be deliberate about whether a reference topology is **legacy queue-authored**
  or **instance-model-authored**.

---

## Section 3 - Functional Requirements (FR) Engine

FRs are **prose in `prompt.functionalRequirements`**; the engine does not parse
them. Each FR must be backed by a structural/semantic **obligation** or explicitly
labeled context - no orphan FRs.

### 3.1 Mapping FRs to DSL obligations

| FR intent                                      | DSL obligation                                        | Example                                       |
| ---------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| "A component must exist"                       | `requires_component`                                  | a load balancer fronts the system             |
| "Traffic must reach X"                         | `requires_path` (directed)                            | payment path reaches the SQL store            |
| "All traffic of a type must pass a guard"      | `guardedPath`                                         | rate-limit checks traverse the shared cache   |
| "Component sits in the right position / order" | `placement` (`between`/`notBefore`/`orderedPipeline`) | cache between service & DB, not before the LB |

```json
"structuralRules": [
  { "id": "pay-path", "kind": "requires_path", "fromType": "microservice", "toType": "relational-db",
    "description": "A payment path reaches the transactional store" }
]
```

### 3.2 Handling application-logic FRs (the "generate a unique code" problem)

The sim models **flow and capacity**, not application logic. FRs like _"generate a
unique short code"_, _"return 301"_, _"encode base62"_ are **not gradeable in the
simulation**. Convert them to:

1. a **structural proxy** - the component that _would_ do it must exist (a store
   for the code→URL mapping), and
2. a **`justify` prompt** carrying the nuance as context, and
3. a **context label** in the prompt text so the student knows it is narrative.

```json
"functionalRequirements": [
  "Create a short code for a long URL (write path to a store)",
  "Redirect a short code to its long URL (read path; a permanent redirect - see Justify)"
],
"justify": [
  { "id": "redirect-semantics",
    "decision": "Which HTTP status for a permanent redirect, and how is the code generated (e.g. base62)?",
    "requires": { "choice": true, "tradeoff": true } }
]
```

> See **Appendix A** for the full FR taxonomy and **Appendix B** for the
> per-archetype solution-nuance catalog (301/302, base62, idempotency keys, TTL
> locks, OCC, bloom filters, consistent hashing, …), each classified as
> _gradeable / justification-only / narrative_.

---

## Section 4 - Non-Functional Requirements (NFR) & Simulation Rules

### 4.1 Performance NFRs vs correctness NFRs - the hard boundary

| NFR flavour                                                                         | Simulatable? | Graded by                                                                 |
| ----------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| **Performance** - latency, throughput, availability, utilization                    | ✅           | `rubric` `simulation` check                                               |
| **Correctness** - consistency, exactly-once, ordering, immutability, no-double-book | ❌           | `storageFit` / `guardedPath` + `justify` - **NEVER** a `simulation` check |

The engine has no notion of contention, dedup, or transactional correctness. A
`simulation` check on a correctness property never resolves and silently mis-grades.

`prompt.nonFunctionalRequirements` entries are structured (`NFRTarget`) and each
should map to a rubric/semantic check (orphan NFRs are flagged by the validator):

```json
"nonFunctionalRequirements": [
  { "metric": "latency_p99", "operator": "<", "value": 100, "unit": "ms", "description": "p99 redirect latency under 100ms" }
]
```

`metric` ∈ `latency_p99 | latency_p50 | availability | error_rate | throughput`;
`operator` ∈ `< | <= | > | >=`; `unit` ∈ `ms | percent | req_per_sec | nines`.
(These are the _NFR display_ enums; the `rubric` check uses the _verdict metric
keys_ below.)

### 4.2 Simulation metric keys (verdict paths)

A `rubric` check's `kind` is inferred from the metric prefix
(`topology.*` → topology; `invariantViolations.*`/`conservation.*`/`littlesLaw.*`
→ invariant; else → simulation). Valid keys:

**Simulation (verdict summary):**
`summary.latency.p50` · `summary.latency.p90` · `summary.latency.p95` ·
`summary.latency.p99` · `summary.latency.min` · `summary.latency.max` ·
`summary.latency.mean` · `summary.errorRate` · `summary.throughput` ·
`summary.totalRequests` · `summary.successfulRequests` · `summary.failedRequests` ·
`perNode.maxUtilization` · `perNode.maxErrorRate` · `perNode.maxLatencyP99`

**Correctness / capability aggregates (run-wide, summed across all nodes):**
`reservations.oversells` · `reservations.commits` · `reservations.conflicts`
(reservation-store — a double-book is `reservations.oversells > 0`) ·
`locks.contentions` · `locks.acquires` · `locks.keyless` (distributed-lock) ·
`retries.attempts` · `retries.budgetExhausted` (retry-backoff callers) ·
`rateLimit.breaches` · `rateLimit.admitted` · `rateLimit.rejected` ·
`rateLimit.keyless` (rate-limiter — an over-admit is `rateLimit.breaches > 0`).
These are `kind: "simulation"` checks. Any single trait counter is also reachable
per node as `perNode.<nodeId>.traitCounters.<counter>`, but prefer the run-wide
aggregate so the check does not depend on a node id the student can rename.

**V2 distributed-systems trait counters (per-node only — no run-wide aggregate;
grade via `perNode.<nodeId>.traitCounters.<counter>` OR, preferred, a runtime
`stateTransition` criterion on the matching scope — see below):**

- replication (`storage.replication-boundary` on `relational-db` / `nosql-db`):
  `replicationQuorumWrites` · `replicationPrimaryAcks` · `replicationQuorumFailures` ·
  `replicationLeaderPromotions` · `replicationFailoverRejects` ·
  `replicationReplicaReads` · `replicationStaleReadsPossible`
- stream broker (`stream.partitioned-broker` on `stream`):
  `streamAppends` · `streamPartitionRoutes` · `streamGroupDeliveries` ·
  `streamOffsetCommits` · `streamRetentionExpired` · `streamReplayReads` ·
  `streamConsumerRebalances` · `streamBrokerFailures` · `streamBrokerRecoveries` ·
  `streamBrokerUnavailable`
- protocol/session (`protocol.session` on `load-balancer-l4` / `load-balancer-l7` /
  `api-gateway`): `protocolL7Rejects` · `protocolFlowControlled` ·
  `protocolSessionsOpened` · `protocolSessionsClosed` · `protocolHttpAcks`
- idempotency + commit-outcome (`idempotency-dedup`): `idempotencyDuplicateHits` ·
  `idempotencyUniqueKeys` · `idempotencyKeysMissing` · `idempotencyOutcomeUnknown` ·
  `idempotencyReconciliations` · `idempotencySafeRetries` · `externalReconciliationProbes`

**Runtime semantic criteria (`SEMANTIC_CRITERION`, kinds `stateTransition` /
`stateSequence`)** grade the per-request `stateTimeline` directly — the cleanest
way to check V2 distributed behavior. Scopes and their states:

- `request` · `delivery` · `broker` · `replication` · `protocol` · `idempotency` ·
  `commit-outcome` · `lock` · `reservation`
- e.g. `{ "kind": "stateTransition", "match": { "scope": "replication", "state": "quorum-unavailable" }, "maxCount": 0, "hardFail": true }` — the write path never loses quorum.

See `specs/runtime-semantic-criteria.md` for the full scope→state table and
matcher/filter syntax.

**Invariant:** `invariantViolations.count` · `sloBreaches.count` ·
`conservation.unbalanced` · `littlesLaw.violations`

**Topology (no simulation needed):** `topology.nodeCount` · `topology.edgeCount` ·
`topology.sourceCount` · `topology.totalWorkers` · `topology.totalReplicas` ·
`topology.componentCounts.<type>` · `topology.categoryCounts.<category>`

> **Anti-example - `summary.latencyP99Ms` is INVALID.** It does not resolve
> (`getByPath(verdict, 'summary.latencyP99Ms')` → undefined → the check silently
> fails at grade time). The correct key is **`summary.latency.p99`**. The authoring
> validator raises `metric.badLatencyKey` for this exact mistake.

```json
"rubric": {
  "id": "url-rubric", "passThreshold": 1,
  "checks": [
    { "id": "p99", "kind": "simulation", "description": "p99 under 100ms", "metric": "summary.latency.p99", "op": "<", "value": 100, "points": 3 },
    { "id": "no-invariants", "kind": "invariant", "description": "No invariant violations", "metric": "invariantViolations.count", "op": "==", "value": 0, "points": 1 }
  ]
}
```

`op` ∈ `< | <= | > | >= | == | !=`. `passThreshold` = fraction (0-1) of points
required for the rubric to pass (default 1 = every point).

### 4.3 Topology vs simulation obligations (the caching nuance)

Enforce "reads must be cached" with the **p99 simulation check**, NOT
`guardedPath(service→store)`. Under a read/write mix, writes legitimately bypass
the cache and hit the store directly; a topology `guardedPath` cannot distinguish
request types and would wrongly fail a correct design. The simulation is the
enforcement: without a cache the store saturates and p99 fails (proven, alignment
§9). Reserve `guardedPath` for **all-traffic guards** (rate-limiter→shared-cache,
payment→idempotency-store) where there is no legitimate bypass.

---

## Section 5 - Anti-Patterns, Hard Fails & Structural Checks

### 5.1 Hard-fail semantic checks

`"hardFail": true` on a semantic criterion **zeroes the whole question** when that
criterion fails, regardless of other credit - for _architecturally naive_ mistakes
(not merely suboptimal ones):

```json
{
  "id": "store-fit",
  "kind": "storageFit",
  "accessPattern": "time-series",
  "accept": ["time-series-db", "columnar-db"],
  "antiPattern": ["relational-db"],
  "points": 6,
  "hardFail": true
}
```

Canonical hard-fails: `storageFit` anti-pattern present (SQL at 200K time-series
writes); `fanout` via a `forbiddenBroker` queue (queue→N ≠ fan-out); `guardedPath`
bypass (write reaches the ledger without idempotency). A failed `hardFail` sets the
grade's `hardFailed` flag and drops the host contract's `allPassed`.

### 5.2 Short-circuit mechanics (evaluation order)

Grading runs in a strict order and **short-circuits**:

```
structuralRules  →  (if any fail, STOP: simulation + semantic skipped)
        ↓ pass
justification  →  semantic (forbidUnjustified reads justification results)  →  simulation (suite) + rubric
```

- A failing `structuralRule` **prevents** semantic/simulation from running - the
  design fails at the structural gate. If you want a _specific_ semantic check to
  be the failure point, ensure the gamed design **passes structural first**
  (e.g. include the required broker but fan out with a queue, so `fanout` - not a
  `requires_component` - is the failing check).
- `structuralRules` carry **no points** in the host contract; they are pass/fail
  gates. Points live on `rubric` checks and `semanticCriteria`.

### 5.3 Structural rule kinds (full)

Base fields on every rule: `kind` (required) plus `id` and `description` (both
**optional** in the Newton flow — auto-derived; §11.3a).

| `kind`                              | Extra fields                     | Passes when                                    |
| ----------------------------------- | -------------------------------- | ---------------------------------------------- |
| `requires_component`                | `componentType`, `minCount?`(=1) | ≥ minCount nodes of the type                   |
| `requires_category`                 | `category`, `minCount?`(=1)      | ≥ minCount nodes in the category               |
| `requires_edge`                     | `fromType`, `toType`, `mode?`    | an edge `fromType`→`toType` (of `mode`) exists |
| `requires_path`                     | `fromType`, `toType`             | a directed path exists (BFS)                   |
| `requires_redundancy`               | `componentType`, `minReplicas`   | total replicas of the type ≥ minReplicas       |
| `max_component_count`               | `componentType`, `maxCount`      | ≤ maxCount of the type                         |
| `min_node_count` / `max_node_count` | `count`                          | total nodes ≥ / ≤ count                        |
| `forbids_component`                 | `componentType`                  | zero of the type present                       |
| `requires_connected_graph`          | -                                | every node reachable (undirected BFS)          |
| `requires_single_source`            | -                                | exactly one source node (no inbound edge)      |

### 5.4 Learner-created components (Service Builder / Custom Node Builder)

Learners can now **compose** nodes with the Service Builder and Custom Node Builder
instead of only dragging palette items. This does **not** change the grading engine —
but it changes how you must author targeting. See the builder spec
`custom-node-and-service-definition-spec.md` §15.1 for the full contract.

**Creation is transparent to grading.** Every created node serializes to a real
`componentType` — a built _service_ becomes `microservice` / `serverless-function` /
`batch-worker`; a built _custom node_ becomes its backing type (`in-memory-cache`,
`relational-db`, `queue`, `api-endpoint`, …). All rules above match on that resolved
`componentType`, never on the learner's label or the builder's declared contract. So a
learner's "URL Shortening Service" satisfies a `requires_component: microservice` rule
automatically.

Four authoring rules follow:

1. **Target component-type _sets_, not a single type, when the runtime is a free
   choice.** The Service Builder lets a service run as `microservice`, `serverless-function`,
   or `batch-worker`. A rule pinning one type will fail a valid alternative. Prefer
   `requires_category`, or `storage_fit.accept[]`/`partial[]`, or a `requires_path`
   that does not over-constrain the exact node type. (Extends the multiple-valid-
   solutions guidance.)
2. **Gate creation with `allowedNodeTypes` / `forbiddenNodeTypes`** (SIMULATOR*CONFIG,
   §11.4). These operate on the **resolved componentType**, so they already apply to
   created nodes — use them so a learner can't simply \_conjure* the exact node the
   question is testing (e.g. forbid the anti-pattern store types).
3. **Never grade the declared contract.** The builder's operations, capabilities, and
   per-operation dependencies are documentation-only and invisible to grading. A
   `requires_edge` / `requires_path` / guarded-path check needs the learner's **actual
   edge**, not a _declared_ dependency. (A renderer-side advisory lint flags declared-
   but-unwired dependencies as feedback — it never touches grading.)
4. **Label-independence is a feature.** A `microservice` mislabeled "Redis Cache" still
   fails `requires_component: in-memory-cache`. No need to defend rules against naming.

**Current limitation.** There is no per-question _builder_ policy yet (allow/deny each
builder, cap runtime templates or node classes). You can only gate at the
`componentType` level via `allowedNodeTypes` / `forbiddenNodeTypes`.

---

## Section 6 - Justifications, Tradeoffs & Cost Constraints

### 6.1 Justification schema (`justify`)

```json
"justify": [
  { "id": "why-store",
    "decision": "Why this store type for lookups at this scale?",
    "boundTo": { "componentType": "kv-store" },
    "requires": { "choice": true, "number": true, "tradeoff": true },
    "acceptTradeoffTokens": ["but", "however", "at the cost", "we lose"] }
]
```

| Field                  | Required | Rule                                                                                       |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `id`                   | ✅       | unique; referenced by `forbidUnjustified.justifyId`                                        |
| `decision`             | ✅       | the decision the student must defend                                                       |
| `boundTo`              | optional | `{ nodeId?, componentType? }` - ties the answer to a real graph element                    |
| `requires.choice`      | ✅       | graph-consistency gate: answer must name the component **actually placed** (anti-stuffing) |
| `requires.number`      | optional | answer must cite a **scale/NFR number** this question defines                              |
| `requires.tradeoff`    | ✅       | answer must state what is given up                                                         |
| `acceptTradeoffTokens` | optional | author-provided tradeoff keywords (else a default list)                                    |

Grading is **deterministic, no LLM**: (1) graph-consistency (mentions the placed
component's alias), (2) number-citation (within 0.5%), (3) tradeoff token. Outcome
∈ `passed | partial | failed | missing`.

### 6.2 Budget (`budget`) - anti-kitchen-sink _(graded - `budget.ts`)_

```json
"budget": { "unit": "cost", "cap": 600 }
```

`unit` ∈ `cost | nodes | edges`; `cap` = positive number. In the Newton flow, author
it **inside the `SIMULATOR_CONFIG` row** (`"budget": { … }`); the row builder threads it
into the package (§11.4). Evaluated by
`evaluateBudget(topology, budget)` after the structural gate; the result surfaces
as a **`topology.budget`** check row that **fails the contract when
`actual > cap`** (drops `allPassed`), so an over-provisioned "kitchen-sink" design
fails the **$** axis rather than being explicitly forbidden.

- **`nodes` / `edges`** - `actual` = node / edge **count**. The primary
  anti-kitchen-sink lever; exact and price-model-free.
- **`cost`** - `actual` = a **v1 capacity-cost heuristic** (no real price sheet
  yet): per node `1 + replicas + ceil(workers / 50)`, plus `1` per edge. This
  penalizes over-provisioned capacity (high replicas/workers). Swap in a real cost
  model later without changing the DSL - the heuristic is clearly labeled in the
  failure `detail` (`"… (v1 capacity-cost heuristic)"`).

The row shows as **pending** before grading and passes/fails after. Note
`constraints.maxBudget`/`maxNodeCount` are **not** enforced at grade time (see §8.3);
`budget` is the graded axis.

### 6.3 CLI vs in-app behavior (`forbidUnjustified`)

`forbidUnjustified` requires a component to be **absent, OR present and defended by
a valid justification** (`justificationPassed(justifyId) === true`).

- **CLI (`sim evaluate question`)** captures **no** justification answers → a
  present component is **always undefended → fails** (`"justification was not
evaluated"`). Test the _absent_ case for a clean CLI pass.
- **In-app** threads the student's answers into `gradeAttempt` → a **defended**
  present component **passes**. This is the graph-consistent justification linchpin.

```json
"semanticCriteria": [
  { "id": "cdn-justified", "kind": "forbidUnjustified", "componentType": "cdn",
    "justifyId": "why-cdn", "points": 4 }
]
```

`justifyId` MUST reference an existing `justify[].id` (dangling ⇒ validator error
`justify.dangling`).

---

## Section 7 - Master Property & DSL Reference Table

Every customizable property across the DSL. **Scope** names the containing object.

| Property Name / Key                                                                                                | Scope / Context                            | Data Type / Enum Values                                                                                        | Required / Optional               | Description & Usage Rules                                                                                                                                          | Gotchas & Validation Errors                                                                                                                                                                                                             |
| :----------------------------------------------------------------------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                                                                                                          | QuestionPackage                            | `"1.0"` (literal)                                                                                              | Required                          | Package schema version.                                                                                                                                            | Must equal `"1.0"`.                                                                                                                                                                                                                     |
| `id`                                                                                                               | QuestionPackage                            | string                                                                                                         | Required                          | Stable question id.                                                                                                                                                | -                                                                                                                                                                                                                                       |
| `title`                                                                                                            | QuestionPackage                            | string                                                                                                         | Required                          | Human title.                                                                                                                                                       | -                                                                                                                                                                                                                                       |
| `description`                                                                                                      | QuestionPackage                            | string                                                                                                         | Optional                          | Long description.                                                                                                                                                  | -                                                                                                                                                                                                                                       |
| `difficulty`                                                                                                       | QuestionPackage                            | `beginner \| intermediate \| advanced \| expert`                                                               | Required                          | Difficulty tier.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `tags`                                                                                                             | QuestionPackage                            | string[]                                                                                                       | Optional                          | Free tags.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `estimatedTimeMinutes`                                                                                             | QuestionPackage                            | number                                                                                                         | Optional                          | Est. solve time.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `type`                                                                                                             | QuestionPackage                            | `fix \| build-budget \| optimize \| open-build \| scaling \| ha-chaos \| tradeoff`                             | Required                          | Question archetype.                                                                                                                                                | -                                                                                                                                                                                                                                       |
| `entryFormat`                                                                                                      | QuestionPackage                            | `blank-canvas \| requirements-first \| partial-scaffold \| broken-scaffold \| baseline-optimize \| locked-lab` | Optional                          | Learner starting surface and wrapper style. Orthogonal to `type`: `type` says how the question grades, `entryFormat` says how the learner enters it.               | Omitted fields stay backward-compatible via inference. Explicit mismatches trigger authoring-validator diagnostics such as `entryFormat.blankCanvasMismatch`, `entryFormat.baselineVerdictMissing`, or `entryFormat.lockedLabUnlocked`. |
| `workloadCategory`                                                                                                 | QuestionPackage                            | `read-heavy \| write-heavy \| connection-heavy \| correctness-heavy \| batch-heavy`                            | Optional                          | Primary evaluation axis selector.                                                                                                                                  | No `compute`/`equal` enum - `batch-worker` node is category `compute`; "equal" = a 0.5/0.5 `requestDistribution`.                                                                                                                       |
| `domains`                                                                                                          | QuestionPackage                            | `QuestionDomain[]` (`compute \| storage \| network \| resilience \| correctness \| cost`)                      | Optional but strongly recommended | Declares the bottleneck domain(s) the question is teaching. Drives authoring-validator consistency checks and platform behavior such as edge/resource edit policy. | Missing ⇒ validator `domains.missing`; `network` / `resilience` / `cost` currently warn as V2 domains.                                                                                                                                  |
| `concepts`                                                                                                         | QuestionPackage                            | `string[]` (non-empty kebab-case slugs by convention)                                                          | Optional                          | Fine-grained lesson tags, narrower than `domains` (for example `read-cache`, `store-fit`, `async-decoupling`).                                                     | Free-form metadata today; schema enforces only non-empty strings.                                                                                                                                                                       |
| `author`                                                                                                           | QuestionPackage                            | string                                                                                                         | Optional                          | Author id.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `createdAt`                                                                                                        | QuestionPackage                            | ISO string                                                                                                     | Optional                          | Timestamp.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `prompt.text`                                                                                                      | prompt                                     | string (markdown)                                                                                              | Required                          | Problem statement.                                                                                                                                                 | Frame as "design the architecture, not code".                                                                                                                                                                                           |
| `prompt.functionalRequirements`                                                                                    | prompt                                     | string[]                                                                                                       | Required                          | FRs (prose).                                                                                                                                                       | Not parsed - each must map to an obligation (§3) or be labeled context.                                                                                                                                                                 |
| `prompt.nonFunctionalRequirements`                                                                                 | prompt                                     | `NFRTarget[]`                                                                                                  | Required                          | Structured NFRs.                                                                                                                                                   | Orphan NFR (no matching rubric check) ⇒ validator `nfr.orphan`.                                                                                                                                                                         |
| `prompt.scale`                                                                                                     | prompt                                     | `ScaleParameters`                                                                                              | Required                          | Display + derivation numbers.                                                                                                                                      | Feeds grade-time workload derivation when a suite case omits `workload.baseRps` / `requestDistribution`; explicit case overrides still win.                                                                                             |
| `prompt.additionalContext`                                                                                         | prompt                                     | string                                                                                                         | Optional                          | Extra context.                                                                                                                                                     | -                                                                                                                                                                                                                                       |
| `NFRTarget.metric`                                                                                                 | NFR                                        | `latency_p99 \| latency_p50 \| availability \| error_rate \| throughput`                                       | Required                          | NFR metric.                                                                                                                                                        | Distinct from verdict metric keys.                                                                                                                                                                                                      |
| `NFRTarget.operator`                                                                                               | NFR                                        | `< \| <= \| > \| >=`                                                                                           | Required                          | Comparison.                                                                                                                                                        | -                                                                                                                                                                                                                                       |
| `NFRTarget.value`                                                                                                  | NFR                                        | number                                                                                                         | Required                          | Target value.                                                                                                                                                      | -                                                                                                                                                                                                                                       |
| `NFRTarget.unit`                                                                                                   | NFR                                        | `ms \| percent \| req_per_sec \| nines`                                                                        | Required                          | Unit.                                                                                                                                                              | -                                                                                                                                                                                                                                       |
| `NFRTarget.description`                                                                                            | NFR                                        | string                                                                                                         | Required                          | Student-facing label.                                                                                                                                              | -                                                                                                                                                                                                                                       |
| `scale.dau`                                                                                                        | scale                                      | number ≥ 0                                                                                                     | Optional                          | Daily active users (display).                                                                                                                                      | -                                                                                                                                                                                                                                       |
| `scale.peakRps`                                                                                                    | scale                                      | number ≥ 0                                                                                                     | Optional                          | Real-world peak (display + derivation).                                                                                                                            | Grade-time workload derivation uses this when a case omits `workload.baseRps`; keep explicit case `baseRps` only for scenario-specific overrides.                                                                                       |
| `scale.readWriteRatio`                                                                                             | scale                                      | number 0-100                                                                                                   | Optional                          | Reads % (display + derivation).                                                                                                                                    | Grade-time workload derivation synthesizes a typed `read`/`write` `requestDistribution` when a case omits one, reusing the source workload's request sizes.                                                                             |
| `scale.storageGb`                                                                                                  | scale                                      | number ≥ 0                                                                                                     | Optional                          | Storage size (display).                                                                                                                                            | -                                                                                                                                                                                                                                       |
| `scale.retentionDays`                                                                                              | scale                                      | number ≥ 0                                                                                                     | Optional                          | Retention (display).                                                                                                                                               | -                                                                                                                                                                                                                                       |
| `scale.growthRatePercent`                                                                                          | scale                                      | number ≥ 0                                                                                                     | Optional                          | Growth (display).                                                                                                                                                  | -                                                                                                                                                                                                                                       |
| `scaffold.type`                                                                                                    | scaffold                                   | `empty \| partial \| complete`                                                                                 | Required                          | Starting canvas.                                                                                                                                                   | `partial`/`complete` require a `topology`.                                                                                                                                                                                              |
| `scaffold.topology`                                                                                                | scaffold                                   | `TopologyJSON`                                                                                                 | Conditional                       | Given nodes/edges.                                                                                                                                                 | Required unless `type: "empty"`.                                                                                                                                                                                                        |
| `scaffold.lockedNodeIds`                                                                                           | scaffold                                   | string[]                                                                                                       | Optional                          | Immutable nodes.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `scaffold.lockedEdgeIds`                                                                                           | scaffold                                   | string[]                                                                                                       | Optional                          | Immutable edges.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `scaffold.baselineVerdict`                                                                                         | scaffold                                   | `SimulationVerdict`                                                                                            | Optional                          | Baseline to beat (`optimize`).                                                                                                                                     | Must be a versioned verdict.                                                                                                                                                                                                            |
| `constraints.canModifyScaffold`                                                                                    | constraints                                | boolean                                                                                                        | Required                          | May edit scaffold nodes.                                                                                                                                           | -                                                                                                                                                                                                                                       |
| `constraints.canRemoveScaffoldNodes`                                                                               | constraints                                | boolean                                                                                                        | Required                          | May delete scaffold nodes.                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `constraints.allowedNodeTypes`                                                                                     | constraints                                | string[]                                                                                                       | Optional                          | Palette allowlist.                                                                                                                                                 | -                                                                                                                                                                                                                                       |
| `constraints.forbiddenNodeTypes`                                                                                   | constraints                                | string[]                                                                                                       | Optional                          | Palette denylist.                                                                                                                                                  | -                                                                                                                                                                                                                                       |
| `constraints.maxNodeCount`                                                                                         | constraints                                | number                                                                                                         | Optional                          | Hard node ceiling.                                                                                                                                                 | -                                                                                                                                                                                                                                       |
| `constraints.maxBudget`                                                                                            | constraints                                | number                                                                                                         | Optional                          | Hard cost ceiling.                                                                                                                                                 | Distinct from graded `budget`.                                                                                                                                                                                                          |
| `constraints.maxTotalWorkers`                                                                                      | constraints                                | number                                                                                                         | Optional                          | Hard worker ceiling.                                                                                                                                               | -                                                                                                                                                                                                                                       |
| `structuralRules[].id`                                                                                             | structuralRule                             | string                                                                                                         | Required                          | Unique id.                                                                                                                                                         | Duplicate ids rejected.                                                                                                                                                                                                                 |
| `structuralRules[].description`                                                                                    | structuralRule                             | string                                                                                                         | Required                          | Row label + failure text prefix.                                                                                                                                   | Never parsed; only echoed.                                                                                                                                                                                                              |
| `structuralRules[].kind`                                                                                           | structuralRule                             | see §5.3                                                                                                       | Required                          | Rule kind.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `…componentType` / `category` / `fromType` / `toType` / `mode` / `minCount` / `maxCount` / `minReplicas` / `count` | structuralRule                             | per kind (§5.3)                                                                                                | per kind                          | Kind-specific fields.                                                                                                                                              | `componentType` = a valid `ComponentType` string; `category` = a `ComponentCategory`.                                                                                                                                                   |
| `semanticCriteria[].id`                                                                                            | semanticCriterion                          | string                                                                                                         | Required                          | Unique id.                                                                                                                                                         | Duplicate ids rejected.                                                                                                                                                                                                                 |
| `semanticCriteria[].description`                                                                                   | semanticCriterion                          | string                                                                                                         | Optional                          | Row label + `detail`.                                                                                                                                              | -                                                                                                                                                                                                                                       |
| `semanticCriteria[].points`                                                                                        | semanticCriterion                          | number                                                                                                         | Required                          | Points (full/partial→floor(½)/0).                                                                                                                                  | -                                                                                                                                                                                                                                       |
| `semanticCriteria[].hardFail`                                                                                      | semanticCriterion                          | boolean                                                                                                        | Optional                          | Failing zeroes the question.                                                                                                                                       | Use for architecturally-naive mistakes only.                                                                                                                                                                                            |
| `semanticCriteria[].kind`                                                                                          | semanticCriterion                          | `placement \| guardedPath \| fanout \| storageFit \| forbidUnjustified`                                        | Required                          | Check kind.                                                                                                                                                        | -                                                                                                                                                                                                                                       |
| `placement.componentType`                                                                                          | placement                                  | `ComponentType`                                                                                                | Required                          | The placed component.                                                                                                                                              | -                                                                                                                                                                                                                                       |
| `placement.between`                                                                                                | placement                                  | `[ComponentType, ComponentType]`                                                                               | Optional                          | On a directed A→…→B path.                                                                                                                                          | -                                                                                                                                                                                                                                       |
| `placement.notBefore`                                                                                              | placement                                  | `ComponentType`                                                                                                | Optional                          | Not upstream of X.                                                                                                                                                 | -                                                                                                                                                                                                                                       |
| `placement.orderedPipeline`                                                                                        | placement                                  | `ComponentType[]`                                                                                              | Optional                          | Types appear in order along a path.                                                                                                                                | -                                                                                                                                                                                                                                       |
| `guardedPath.from`                                                                                                 | guardedPath                                | `ComponentType`                                                                                                | Required                          | Path origin.                                                                                                                                                       | -                                                                                                                                                                                                                                       |
| `guardedPath.guard`                                                                                                | guardedPath                                | `ComponentType`                                                                                                | Required                          | Mandatory guard node.                                                                                                                                              | -                                                                                                                                                                                                                                       |
| `guardedPath.to`                                                                                                   | guardedPath                                | `ComponentType`                                                                                                | Optional                          | Path destination.                                                                                                                                                  | With a read/write mix, a `to` guardedPath can wrongly fail correct designs (writes bypass) ⇒ validator `guardedPath.readWriteMix`.                                                                                                      |
| `fanout.broker`                                                                                                    | fanout                                     | `ComponentType`                                                                                                | Required                          | Fan-out broker.                                                                                                                                                    | -                                                                                                                                                                                                                                       |
| `fanout.minConsumers`                                                                                              | fanout                                     | number                                                                                                         | Required                          | Distinct downstream consumers required.                                                                                                                            | -                                                                                                                                                                                                                                       |
| `fanout.forbiddenBroker`                                                                                           | fanout                                     | `ComponentType`                                                                                                | Optional                          | Wrong primitive (queue) feeding N ⇒ hard-fail case.                                                                                                                | -                                                                                                                                                                                                                                       |
| `storageFit.accessPattern`                                                                                         | storageFit                                 | `point-lookup \| time-series \| append-only-ledger \| transactional-relational \| search-index \| blob`        | Required                          | The access pattern.                                                                                                                                                | See Appendix C.                                                                                                                                                                                                                         |
| `storageFit.accept`                                                                                                | storageFit                                 | `ComponentType[]`                                                                                              | Required                          | Full-credit store types.                                                                                                                                           | -                                                                                                                                                                                                                                       |
| `storageFit.partial`                                                                                               | storageFit                                 | `ComponentType[]`                                                                                              | Optional                          | Half-credit (defensible).                                                                                                                                          | -                                                                                                                                                                                                                                       |
| `storageFit.antiPattern`                                                                                           | storageFit                                 | `ComponentType[]`                                                                                              | Optional                          | Anti-pattern types (hard-fail-worthy).                                                                                                                             | Present anti-pattern ⇒ fail (hard-fail if flagged).                                                                                                                                                                                     |
| `forbidUnjustified.componentType`                                                                                  | forbidUnjustified                          | `ComponentType`                                                                                                | Required                          | Component to guard.                                                                                                                                                | -                                                                                                                                                                                                                                       |
| `forbidUnjustified.justifyId`                                                                                      | forbidUnjustified                          | string                                                                                                         | Optional                          | Bound justify prompt id.                                                                                                                                           | Dangling ⇒ validator `justify.dangling`; missing ⇒ present component always fails.                                                                                                                                                      |
| `justify[].id`                                                                                                     | justify                                    | string                                                                                                         | Required                          | Unique id.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `justify[].decision`                                                                                               | justify                                    | string                                                                                                         | Required                          | Decision to defend.                                                                                                                                                | -                                                                                                                                                                                                                                       |
| `justify[].boundTo`                                                                                                | justify                                    | `{ nodeId?, componentType? }`                                                                                  | Optional                          | Graph binding.                                                                                                                                                     | -                                                                                                                                                                                                                                       |
| `justify[].requires.choice`                                                                                        | justify                                    | boolean                                                                                                        | Required                          | Graph-consistency gate.                                                                                                                                            | -                                                                                                                                                                                                                                       |
| `justify[].requires.number`                                                                                        | justify                                    | boolean                                                                                                        | Optional                          | Must cite a scale number.                                                                                                                                          | -                                                                                                                                                                                                                                       |
| `justify[].requires.tradeoff`                                                                                      | justify                                    | boolean                                                                                                        | Required                          | Must state a tradeoff.                                                                                                                                             | -                                                                                                                                                                                                                                       |
| `justify[].acceptTradeoffTokens`                                                                                   | justify                                    | string[]                                                                                                       | Optional                          | Tradeoff keywords.                                                                                                                                                 | -                                                                                                                                                                                                                                       |
| `budget.unit`                                                                                                      | budget                                     | `cost \| nodes \| edges`                                                                                       | Required                          | Budget dimension.                                                                                                                                                  | -                                                                                                                                                                                                                                       |
| `budget.cap`                                                                                                       | budget                                     | number > 0                                                                                                     | Required                          | Ceiling.                                                                                                                                                           | -                                                                                                                                                                                                                                       |
| `suite.name`                                                                                                       | suite                                      | string                                                                                                         | Required                          | Suite name.                                                                                                                                                        | -                                                                                                                                                                                                                                       |
| `suite.visibleToStudent`                                                                                           | suite                                      | boolean                                                                                                        | Required                          | Show scenarios to student.                                                                                                                                         | `false` = hidden contest suite.                                                                                                                                                                                                         |
| `suite.dryRunCase`                                                                                                 | suite                                      | `QuestionSuiteCase`                                                                                            | Optional                          | Case the student may dry-run.                                                                                                                                      | -                                                                                                                                                                                                                                       |
| `suite.cases[].id`                                                                                                 | suite case                                 | string                                                                                                         | Required                          | Case id.                                                                                                                                                           | Empty `cases` ⇒ validator `suite.empty` (error).                                                                                                                                                                                        |
| `suite.cases[].description`                                                                                        | suite case                                 | string                                                                                                         | Optional                          | Case label.                                                                                                                                                        | -                                                                                                                                                                                                                                       |
| `suite.cases[].global`                                                                                             | suite case                                 | `Partial<GlobalConfig>`                                                                                        | Optional                          | Global override (seed/duration).                                                                                                                                   | Question-owned - fixes seed to kill seed-farming.                                                                                                                                                                                       |
| `suite.cases[].workload`                                                                                           | suite case                                 | `Partial<WorkloadProfile>`                                                                                     | Optional                          | Injected load (RPS + mix).                                                                                                                                         | The read/write mix lives here (`requestDistribution`).                                                                                                                                                                                  |
| `suite.cases[].faults`                                                                                             | suite case                                 | `FaultSpec[]`                                                                                                  | Optional                          | Injected chaos faults.                                                                                                                                             | Question-owned HA scenario.                                                                                                                                                                                                             |
| `workload.baseRps`                                                                                                 | workload                                   | number > 0                                                                                                     | Required (in a workload)          | Tractable RPS (~2-5K).                                                                                                                                             | Not the display scale.                                                                                                                                                                                                                  |
| `workload.pattern`                                                                                                 | workload                                   | `constant \| poisson \| bursty \| diurnal \| spike \| sawtooth \| replay`                                      | Required (in a full workload)     | Arrival pattern.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `workload.requestDistribution[].type`                                                                              | requestDistribution                        | string                                                                                                         | Required                          | Traffic class (`read`/`write`/`GET`…).                                                                                                                             | Used in edge `condition`.                                                                                                                                                                                                               |
| `workload.requestDistribution[].weight`                                                                            | requestDistribution                        | number 0-1                                                                                                     | Required                          | Fraction of traffic.                                                                                                                                               | Weights should sum to 1.0.                                                                                                                                                                                                              |
| `workload.requestDistribution[].sizeBytes`                                                                         | requestDistribution                        | number                                                                                                         | Required (full topology)          | Payload size.                                                                                                                                                      | Missing on a full topology ⇒ validation error.                                                                                                                                                                                          |
| `workload.requestDistribution[].metadata`                                                                          | requestDistribution                        | object                                                                                                         | Optional                          | Untyped escape hatch.                                                                                                                                              | Not consumed by grading.                                                                                                                                                                                                                |
| `global.seed`                                                                                                      | global                                     | string                                                                                                         | Required (full)                   | RNG seed.                                                                                                                                                          | Question-fixed to prevent seed-farming.                                                                                                                                                                                                 |
| `global.simulationDuration`                                                                                        | global                                     | number > 0 (ms)                                                                                                | Required (full)                   | Sim length.                                                                                                                                                        | Keep short for the browser.                                                                                                                                                                                                             |
| `global.warmupDuration`                                                                                            | global                                     | number ≥ 0 (ms)                                                                                                | Required (full)                   | Pre-metrics warmup.                                                                                                                                                | -                                                                                                                                                                                                                                       |
| `global.timeResolution`                                                                                            | global                                     | `microsecond \| millisecond`                                                                                   | Required (full)                   | Tick resolution.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `global.defaultTimeout`                                                                                            | global                                     | number > 0 (ms)                                                                                                | Required (full)                   | Request timeout.                                                                                                                                                   | -                                                                                                                                                                                                                                       |
| `global.traceSampleRate`                                                                                           | global                                     | number 0-1                                                                                                     | Optional                          | Trace sampling.                                                                                                                                                    | -                                                                                                                                                                                                                                       |
| `resources.instanceType`                                                                                           | node resources                             | `InstanceType` (catalog key, §9.2)                                                                             | Optional                          | Hardware SKU; resolves vCPU/RAM/price/perf. Opts the node into the instance model.                                                                                 | Not free-typed - must be a catalog key.                                                                                                                                                                                                 |
| `resources.instanceCount`                                                                                          | node resources                             | number ≥ 1                                                                                                     | Optional (=1)                     | Horizontal scale.                                                                                                                                                  | Supersedes `replicas`.                                                                                                                                                                                                                  |
| `resources.workloadKind`                                                                                           | node resources                             | `cpu-bound \| io-bound`                                                                                        | Optional (per-type default)       | Execution profile → workers-per-vCPU (1 vs 32, §9.3).                                                                                                              | This is why stores show 64-128 and services show 2.                                                                                                                                                                                     |
| `resources.maxInstances`                                                                                           | node resources                             | number                                                                                                         | Optional                          | Per-node `instanceCount` quota.                                                                                                                                    | Build-time validation.                                                                                                                                                                                                                  |
| `resources.perRequestMemMb`                                                                                        | node resources                             | number (MB)                                                                                                    | Optional                          | Per-request memory → admission ceiling `K`.                                                                                                                        | Small value ⇒ RAM never binds (pure queueing).                                                                                                                                                                                          |
| `resources.pricingModel`                                                                                           | node resources                             | `on-demand \| reserved \| spot`                                                                                | Optional (=on-demand)             | Price multiplier 1.0 / 0.6 / 0.3.                                                                                                                                  | Provisioned cost only; not the graded `$` axis (§9.5).                                                                                                                                                                                  |
| `resources.workersPerInstance` / `queueSlots`                                                                      | node resources                             | number                                                                                                         | Optional                          | **Derived, read-only** once instance model is set.                                                                                                                 | Do not tune to size a node - ignored by derivation.                                                                                                                                                                                     |
| `resources.cpu` / `memory` / `replicas`                                                                            | node resources                             | number                                                                                                         | Optional                          | **@deprecated** legacy free-typed fields.                                                                                                                          | Read for back-compat only.                                                                                                                                                                                                              |
| `environmentProfile`                                                                                               | Newton `SIMULATOR_CONFIG` / launch payload | `EnvironmentProfileInput` (§10)                                                                                | Optional                          | Mode + visibility + capabilities lens.                                                                                                                             | Not part of `question.json`; authored in the Newton row or launch payload.                                                                                                                                                              |
| `rubric.id`                                                                                                        | rubric                                     | string                                                                                                         | Required                          | Rubric id.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `rubric.passThreshold`                                                                                             | rubric                                     | number 0-1                                                                                                     | Optional (=1)                     | Fraction of points to pass.                                                                                                                                        | -                                                                                                                                                                                                                                       |
| `rubric.checks[].id`                                                                                               | rubric check                               | string                                                                                                         | Required                          | Check id.                                                                                                                                                          | -                                                                                                                                                                                                                                       |
| `rubric.checks[].description`                                                                                      | rubric check                               | string                                                                                                         | Required                          | Row label.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `rubric.checks[].kind`                                                                                             | rubric check                               | `topology \| simulation \| invariant`                                                                          | Optional                          | Inferred from metric prefix if omitted.                                                                                                                            | Mismatch (simulation check on `topology.*`) ⇒ validator `metric.kindMismatch`.                                                                                                                                                          |
| `rubric.checks[].metric`                                                                                           | rubric check                               | verdict path (§4.2)                                                                                            | Required                          | Metric to compare.                                                                                                                                                 | `summary.latencyP99Ms` ⇒ validator `metric.badLatencyKey`.                                                                                                                                                                              |
| `rubric.checks[].op`                                                                                               | rubric check                               | `< \| <= \| > \| >= \| == \| !=`                                                                               | Required                          | Comparison.                                                                                                                                                        | -                                                                                                                                                                                                                                       |
| `rubric.checks[].value`                                                                                            | rubric check                               | number                                                                                                         | Required                          | Threshold.                                                                                                                                                         | -                                                                                                                                                                                                                                       |
| `rubric.checks[].points`                                                                                           | rubric check                               | number                                                                                                         | Optional (=1)                     | Points.                                                                                                                                                            | -                                                                                                                                                                                                                                       |

---

## Section 8 - Schema Validation & Engine Gotchas Index

### 8.1 The two-stage validation pipeline

1. **`parseQuestionPackage(raw)`** - Zod schema validation. Enforces types, enums,
   required fields, and unique ids (`structuralRules`, `semanticCriteria`,
   `justify`). Throws on any schema violation. This is what the Django admin
   `clean()` / the Node `/validate` runs; a malformed package cannot be saved.
2. **`validateAuthoredQuestion(pkg)`** - the authoring-contract lint (semantic, not
   schema). Returns `error`/`warning` diagnostics: wrong metric keys, un-injected
   scale numbers, missing `sizeBytes`, orphan NFRs, correctness-on-simulation,
   dangling justify bindings, read/write `guardedPath` misuse, and explicit
   `entryFormat`/scaffold/type mismatches. `error`s should block a save;
   `warning`s are advisory.

### 8.2 Gotcha index

- **Metric key resolution** - use the exact verdict paths (`summary.latency.p99`).
  `summary.latencyP99Ms` never resolves. Topology metrics need `kind: "topology"`.
- **String keys vs enum values** - `componentType`/`category` must be valid
  `ComponentType`/`ComponentCategory` strings. **`batch-worker` is a _type_; its
  _category_ is `compute`** (a category is a fixed enum, not the type name).
- **`sizeBytes` is mandatory** on a full topology's `requestDistribution` entries
  (the suite override is a partial and tolerates its absence).
- **Read/write mix is JSON-only** - not settable on the canvas or a source node
  (both `Omit` `requestDistribution`); and it only affects the sim when the topology
  routes on `request.type`.
- **Learner-created nodes grade by resolved `componentType`, not by their builder
  contract** - a built service is a `microservice`/`serverless-function`/`batch-worker`;
  a built custom node is its backing type. Target component-type _sets_ when the runtime
  is a free choice, gate creation with `allowedNodeTypes`/`forbiddenNodeTypes`, and never
  grade the declared operations/capabilities/dependencies (§5.4).
- **Omitted edge latency is now deterministic by default** - a bare edge resolves to
  a path-type-derived **constant** median latency, not an implicit log-normal. If a
  question needs network jitter, author it explicitly.
- **Instance-model resources change the meaning of capacity** - once a node carries
  `resources.instanceType` / `instanceCount`, effective concurrency is derived from
  the instance model (§9). Legacy `queue.workers`-only intuition no longer applies
  unchanged to that node.
- **Execution profile decides worker count** - `io-bound` yields 32 servers/vCPU,
  `cpu-bound` yields 1. A datastore/cache/LB reading "64/128 workers/connections" is
  correct (io-bound); a service reading "2 workers" is correct (cpu-bound). To make a
  store a bottleneck, author it `cpu-bound` on a small instance (§9.3).
- **`connector` edges carry no physics** - under a connector `edgeModel` (the
  deployed/practice default and ASSIGNMENT default), edges add no latency, bandwidth,
  or egress cost. Author reference/gamed sizing so the discriminator lives in nodes,
  or set the profile/`domains` to get `network` edges when the lesson _is_ the edge
  (§10.3-10.4).
- **Two authoring shapes must agree** - a Newton assignment ships as Django rows
  (§11), not the `question.json` the harness grades. Keep the rows byte-equal to the
  package or students get a different question than you validated.
- **Short-circuit** - a failing `structuralRule` skips semantic + simulation. Design
  gamed topologies to pass structural if you want a specific semantic check to fail.
- **CLI vs in-app** - `forbidUnjustified` fails a present component in the CLI (no
  answer capture) but passes a defended one in-app.
- **hardFail zeroes the question** - reserve for architecturally-naive mistakes.
- **Correctness ≠ simulation** - never author a `simulation` check for exactly-once,
  ordering, immutability, or no-double-book.
- **Tractable RPS** - `baseRps` ~2-5K; the real number goes in `prompt.scale`.
- **Graded cost is still heuristic** - the live app may show richer instance-aware
  cost numbers, but question-package `budget.unit:"cost"` still grades via
  `estimateNodeCost` in `budget.ts`.

### 8.3 Implementation status - graded vs schema-only

Not every schema field drives grading. Author accordingly.

| Feature                                                                                                                   | Schema                   | Graded / behavioral?                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structuralRules` (all kinds)                                                                                             | ✅                       | ✅ graded                                                                                                                                                                                                                                                                                                |
| `rubric` (`simulation`/`topology`/`invariant`)                                                                            | ✅                       | ✅ graded                                                                                                                                                                                                                                                                                                |
| `semanticCriteria` (placement/guardedPath/fanout/storageFit/forbidUnjustified)                                            | ✅                       | ✅ graded (evaluators + hardFail)                                                                                                                                                                                                                                                                        |
| `justify` (graph-consistent)                                                                                              | ✅                       | ✅ graded; feeds `forbidUnjustified` in-app                                                                                                                                                                                                                                                              |
| **`budget`**                                                                                                              | ✅                       | ✅ **graded** (`budget.ts` - nodes/edges exact, cost = v1 heuristic)                                                                                                                                                                                                                                     |
| `suite.cases[].workload` / `global` / `faults`                                                                            | ✅                       | ✅ injected at grade time                                                                                                                                                                                                                                                                                |
| `resources.*` (instance model - `instanceType`/`instanceCount`/`workloadKind`/`perRequestMemMb`)                          | ✅                       | ✅ **behavioral** - drives derived concurrency `c`/`K`, service speed, and cost on that node (§9)                                                                                                                                                                                                        |
| `resources.pricingModel`                                                                                                  | ✅                       | ⚠️ affects the **live** cost chip / `cost.ts` only; graded `budget.unit:"cost"` still uses the v1 heuristic (§6.2)                                                                                                                                                                                       |
| `environmentProfile` (mode / visibility / `capabilities`)                                                                 | ✅ (Newton row / launch) | ⚠️ **platform-facing** - governs edit locks, `edgeModel`, visibility; not a scored axis. Overlaid by `domains` (§10.4)                                                                                                                                                                                   |
| `edgeModel` (`network` / `connector`)                                                                                     | ✅                       | ⚠️ behavioral - `connector` edges carry no sim physics or egress cost (§10.3)                                                                                                                                                                                                                            |
| `constraints.*` (`maxNodeCount`, `maxBudget`, `maxTotalWorkers`, `allowed/forbiddenNodeTypes`)                            | ✅                       | ✅ **graded + behavioral** - palette filtering still applies, and grade time now enforces node caps, spend caps, worker caps, and allowed/forbidden component types                                                                                                                                      |
| `workloadCategory`                                                                                                        | ✅                       | ❌ label only (author-side axis selector; not read by grading)                                                                                                                                                                                                                                           |
| `domains`                                                                                                                 | ✅                       | ⚠️ **advisory + platform-facing** - checked by the authoring validator and consumed by environment-profile / edit-policy logic, but not scored as a rubric axis by themselves                                                                                                                            |
| `concepts`                                                                                                                | ✅                       | ❌ metadata only (taxonomy / indexing aid; not graded)                                                                                                                                                                                                                                                   |
| `type` (`fix`/`build-budget`/`optimize`/`open-build`/`scaling`/`ha-chaos`/`tradeoff`)                                     | ✅                       | ❌ **all are labels** - none drives behavior. `optimize` does **not** grade against `scaffold.baselineVerdict`; `build-budget` does not auto-enforce `budget`; `ha-chaos` "works" only via `suite.faults`.                                                                                               |
| `entryFormat` (`blank-canvas`/`requirements-first`/`partial-scaffold`/`broken-scaffold`/`baseline-optimize`/`locked-lab`) | ✅                       | ⚠️ **platform-facing** - explicit authoring/presentation metadata. Backward-compatible inference exists for legacy questions; `locked-lab` drives the Lab wrapper, `baseline-optimize` drives the comparison shell, and the other formats now feed the live workflow tracker / question shell selection. |
| `scaffold.baselineVerdict`                                                                                                | ✅                       | ✅ graded for baseline-comparison questions - the primary case must improve at least one comparison metric without regressing the others                                                                                                                                                                 |
| `requestDistribution[].metadata`                                                                                          | ✅                       | ❌ not consumed                                                                                                                                                                                                                                                                                          |
| `readWriteRatio → requestDistribution` auto-derivation                                                                    | -                        | ✅ built - when a case omits `requestDistribution`, grading derives a typed `read`/`write` mix from `prompt.scale.readWriteRatio` and the source workload's request sizes                                                                                                                                |

> To enforce a node cap, use `budget:{unit:"nodes",cap:N}` or a
> `max_node_count`/`max_component_count` structural rule - `constraints.maxNodeCount`
> alone does nothing at grade time.

---

## Section 9 - Resource, Instance & Execution-Profile Model (node sizing DSL)

Node capacity is no longer a free-typed `queue.workers`. A node's `resources`
block picks a **discrete instance** from a frozen catalog and an **execution
profile**; the engine _derives_ effective concurrency, admission, service speed,
and cost from those. This is the physical, un-gameable half of the DSL: you
cannot ask for 6.5 vCPU or 10²⁰ workers, and more of one axis costs money.

> Source: `ResourceConfig` in `core/types.ts`; `INSTANCE_CATALOG` in
> `catalog/instanceCatalog.ts`; per-type defaults in `catalog/resourceDefaults.ts`;
> derivation in `nodes/resourceDerivation.ts`.

### 9.1 The `resources` block

```json
"resources": {
  "instanceType": "m5.xlarge",
  "instanceCount": 2,
  "workloadKind": "io-bound",
  "pricingModel": "on-demand",
  "perRequestMemMb": 8
}
```

| Field                               | Type / Enum                        | Meaning                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `instanceType`                      | `InstanceType` (catalog key, §9.2) | Hardware SKU → resolves `{ vcpu, ramGb, pricePerHour, perfFactor }`. Never free-typed.                                                                                   |
| `instanceCount`                     | number ≥ 1                         | Horizontal scale (replaces legacy `replicas`).                                                                                                                           |
| `maxInstances`                      | number                             | Per-node quota; `instanceCount` may not exceed it (build-time validation error).                                                                                         |
| `workloadKind`                      | `cpu-bound \| io-bound`            | The **execution profile** - decides workers-per-vCPU (§9.3).                                                                                                             |
| `perRequestMemMb`                   | number (MB)                        | Memory footprint of one in-flight request; divides RAM into the admission ceiling `K`.                                                                                   |
| `pricingModel`                      | `on-demand \| reserved \| spot`    | Purchasing model → price multiplier (§9.5). Absent = `on-demand`.                                                                                                        |
| `workersPerInstance` / `queueSlots` | number                             | **Derived defaults, shown read-only.** Authored values are ignored by the derivation once `instanceType`/`instanceCount` are present - do not tune these to size a node. |
| `cpu` / `memory` / `replicas`       | number                             | **@deprecated** legacy free-typed fields, read only for back-compat (`replicas`→`instanceCount` via `getInstanceCount`).                                                 |

**Legacy vs instance-model nodes.** A node with **no** `instanceType`/`instanceCount`
falls back to raw `queue.workers` / `queue.capacity` (pass-through concurrency).
A node **with** them is instance-derived. A reference topology may mix the two,
but for any node whose sizing matters to the discriminator, prefer the instance
model so the fixture matches what a student builds from the palette.

### 9.2 The instance catalog (frozen SKU menu)

Curated (not the full AWS list): three CPU:RAM ratio tiers plus a burstable floor
and a memory-extreme ceiling, at 2 / 4 / 8-vCPU sizes. Prices are AWS-proportional
on-demand `$/hr`.

| `instanceType` | Family            | vCPU | RAM (GB) | `$/hr` | `perfFactor` |
| -------------- | ----------------- | ---- | -------- | ------ | ------------ |
| `t3.small`     | burstable         | 2    | 2        | 0.021  | 0.8          |
| `t3.medium`    | burstable         | 2    | 4        | 0.042  | 0.8          |
| `m5.large`     | general           | 2    | 8        | 0.096  | 1.0          |
| `m5.xlarge`    | general           | 4    | 16       | 0.192  | 1.0          |
| `m5.2xlarge`   | general           | 8    | 32       | 0.384  | 1.0          |
| `c5.large`     | compute-optimized | 2    | 4        | 0.085  | 1.3          |
| `c5.xlarge`    | compute-optimized | 4    | 8        | 0.170  | 1.3          |
| `c5.2xlarge`   | compute-optimized | 8    | 16       | 0.340  | 1.3          |
| `r5.large`     | memory-optimized  | 2    | 16       | 0.126  | 1.0          |
| `r5.xlarge`    | memory-optimized  | 4    | 32       | 0.252  | 1.0          |
| `r5.2xlarge`   | memory-optimized  | 8    | 64       | 0.504  | 1.0          |
| `x1e.xlarge`   | memory-extreme    | 4    | 122      | 0.834  | 1.0          |

`perfFactor` is relative single-thread speed (compute-optimized `c5` faster,
burstable `t3` slower). Burstable-credit exhaustion is deliberately **not**
modelled - `t3` is a flat derate representing sustained/baseline speed.

### 9.3 Derived concurrency - why a datastore shows 64-128 "workers" and a service shows 2

This is the single most common authoring surprise. **Not every node is
`cpu-bound`.** The execution profile sets workers-per-vCPU:

```
effectiveC (parallel servers) = vCPU × instanceCount × workersPerVcpu
  workersPerVcpu = 1   when workloadKind = "cpu-bound"   (CPU_WORKERS_PER_VCPU)
  workersPerVcpu = 32  when workloadKind = "io-bound"    (IO_WORKERS_PER_VCPU)

effectiveK (admission ceiling) = max(effectiveC, memCeiling)
  memCeiling = floor(totalRAM_MB / perRequestMemMb)      // RAM-bound
```

- **`cpu-bound`** - a compute service actually _occupies_ the core, so true
  parallelism ≈ #cores → **1 worker / vCPU**. A `c5.large` (2 vCPU) service = **2
  workers**.
- **`io-bound`** - a datastore, cache, load balancer, broker, or queue mostly
  _waits_ on disk/network, so one core legitimately multiplexes many concurrent
  in-flight requests → **32 / vCPU**. An `m5.xlarge` (4 vCPU) DB = **128**; a
  `r5.large` (2 vCPU) cache = **64**.

**Per-type default execution profile** (`resourceDefaults.ts`):

| Tier               | Example types                                                                                                                               | Default `workloadKind` | Derived `c` (per vCPU) |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- |
| Compute processors | `microservice`, `batch-worker`                                                                                                              | **cpu-bound**          | 1                      |
| Everything else    | `relational-db`, `nosql-db`, `kv-store`, `in-memory-cache`, `load-balancer`, `api-endpoint`, `queue`, `message-broker`, `object-storage`, … | **io-bound**           | 32                     |

The canvas shows the same derived `c` under **per-type vocabulary** - "workers"
(services/stores), "connections" (DB/LB), "consumers" (broker/queue), "ops"
(cache). They are all the one number `effectiveC`. So a NoSQL DB reading "128
connections" or a broker reading "64 consumers" is **correct and by design**, not
a bug.

> **Authoring lever.** To make a store a _tight bottleneck_ (few servers), author it
> `cpu-bound` on a small instance - e.g. `t3.small` (2 vCPU) `cpu-bound` = 2
> servers. This is how a reference fixture forces a saturation lesson (a
> read-heavy DB that collapses without a cache). Flipping a store to `cpu-bound`
> is a modelling choice, not a default.

> **Deep dive.** The canonical explainer for the execution-profile model - the
> per-tier defaults, the reasoning, the "one number, many labels" vocabulary, and
> the `canEditExecutionProfile` lock - is `execution-profile-and-node-concurrency.md`.

### 9.4 Service speed (`perfFactor` → `serviceTimeMultiplier`)

A node's authored base service time is multiplied by
`serviceTimeMultiplier = 1 / effectivePerf`:

```
effectivePerf = cpu-bound ? perfFactor : 1 + (perfFactor − 1) × 0.25   // IO_PERF_SENSITIVITY
```

CPU-bound work gets the full hardware speed-up; io-bound work is damped toward 1.0
(a faster core barely helps a request blocked on I/O). So a cpu-bound `c5.large`
(perfFactor 1.3) serves each request `≈0.77×` the base time.

### 9.5 Cost model (what the graded `$` axis and the live chip use)

`nodeCostPerHour = pricePerHour × instanceCount × pricingMultiplier(pricingModel)`
for **provisioned** nodes. Pricing multipliers: `on-demand = 1.0`, `reserved = 0.6`,
`spot = 0.3`.

Per **component type**, a `costModel` (in `resourceDefaults.ts`) decides the basis:

| `costModel`   | Basis                                  | Types                                                                          |
| ------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| `provisioned` | instance-hours (above)                 | most compute + stores                                                          |
| `consumption` | `pricePerMillionRequests × throughput` | `serverless-function` (per-request)                                            |
| `volume`      | `pricePerGb × egress`                  | `cdn`, `object-storage` (traffic-priced; estimated pre-run, measured post-run) |
| `none`        | not billable                           | traffic sources (`api-endpoint` client)                                        |

Inter-region **egress** is also charged per edge, keyed off `edge.latency.pathType`
(`cross-zone` `$0.01/GB`, `cross-region` `$0.02`, `internet` `$0.09`; same-rack /
same-dc free). Note the **graded question `budget.unit:"cost"` still uses the older
v1 heuristic** (§6.2) - the instance-aware model above powers the live cost chip and
`cost.ts`, not yet the graded `$` axis.

---

## Section 10 - Environment Profiles & Capabilities (assignment vs practice vs author)

An **EnvironmentProfile** is a visibility + capability lens layered over one
question. The same package runs unchanged in three modes; the profile decides what
the student sees and may edit - it never changes _what_ the question is or _how_ it
grades.

> Source: `environmentProfile.ts` (`EnvironmentProfile`, `EnvironmentCapabilities`,
> `resolveEnvironmentProfile`, `resolveEdgeModel`, `canEditEdgesForQuestion`,
> `canEditResourcesForQuestion`).

### 10.1 Modes and the deployed default

| Mode         | `graded` | Edges       | Resources editable | Use                                      |
| ------------ | -------- | ----------- | ------------------ | ---------------------------------------- |
| `AUTHOR`     | true     | `network`   | yes                | Full authoring / dev UI                  |
| `ASSIGNMENT` | true     | `connector` | no                 | Graded student attempt (locked scaffold) |
| `PRACTICE`   | false    | `connector` | yes                | Free self-paced sandbox                  |

`DEFAULT_ENVIRONMENT_PROFILE` (standalone / online-deployed default, no host
payload) is **`PRACTICE` with connector edges** - a learner lands focused on the
high-level design, not edge physics. The Newton assignment host forces `ASSIGNMENT`
on its own path, so the default never downgrades a graded launch.

### 10.2 Capabilities (`environmentProfile.capabilities`)

| Field                     | Type                         | Meaning                                                     |
| ------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `editPaletteList`         | `string[] \| null`           | Allowed palette types (`null` = all, `[]` = none).          |
| `canEditScaffoldNodes`    | boolean                      | Whether scaffold nodes can be edited.                       |
| `canTriggerTestRuns`      | boolean                      | Whether the student may dry-run before submit.              |
| `edgeModel`               | `network \| connector`       | Whether edges are a modelled layer or dumb wires (§10.3).   |
| `canEditEdges`            | boolean                      | Edit edge _properties_ - only meaningful in `network` mode. |
| `canEditResources`        | boolean                      | Change a node's instance type / count / execution profile.  |
| `canEditExecutionProfile` | boolean                      | Change a node's `workloadKind` (cpu/io) specifically.       |
| `maxTestRuns`             | number?                      | Cap on dry runs (absent = unlimited).                       |
| `resourceBudget`          | `{ totalVcpu, totalRamGb }`? | Hardware quota wall (absent = unbounded).                   |
| `costBudget`              | `{ maxPerHour }`?            | Money wall, independent of quota (absent = unbounded).      |

Cost/resource totals are **always displayed** regardless of caps; the caps only
gate. `resourceBudget` and `costBudget` are independent - a design can pass the
vCPU/RAM quota yet exceed the money cap, and vice versa.

### 10.3 `edgeModel` - network edges vs dumb connectors

- **`network`** - edges carry latency / bandwidth into the sim, expose a
  properties panel, and project the edge metric lenses. Editability then follows
  `canEditEdges`.
- **`connector`** - edges are dumb wires that only express topology: **zero sim
  physics, no egress bill, no properties, no edge lenses**. Placing/removing them
  still defines the graph, but they cost and delay nothing. This is the "focus on
  the HLD, don't get tangled in edges" mode.

The ladder: `connector` (no edit, no calc) < `network` + locked (no edit, affects
calc) < `network` + editable.

### 10.4 Domain overrides - how `domains` unlock edits

The question's `domains` (§7) layer over the profile so a lesson that _is_ about a
locked axis unlocks it (`resolveEdgeModel` / `canEditEdgesForQuestion` /
`canEditResourcesForQuestion`):

- `domains` includes **`network`** → edges upgrade to `network` and edge editing
  unlocks, even under a connector profile (sizing the network _is_ the lesson).
- `domains` includes **`cost`** → resource editing unlocks under ASSIGNMENT (the
  allocation-within-budget lesson needs the instance knobs).

So a `compute`/`storage` assignment keeps edges as connectors and resources locked;
a `network` assignment gets editable network edges; a `cost` assignment gets
editable resources. Choose `domains` deliberately - they drive platform edit policy,
not just metadata.

---

## Section 11 - Writing Test Cases: the Newton Django-Admin Authoring Format

There are **two authoring shapes** for the same question:

1. **Standalone `question.json`** (this manual's Sections 1-9) - used for
   local/standalone authoring and the `validate-question-dir` harness.
2. **Newton Django test-case rows** - how an assignment is actually authored in the
   Newton admin when the simulator is embedded via the GAME iframe
   (`?host=newton`). Each question folder ships a `django-admin-assignment.md` that
   spells the rows out.

They encode the **same** package; the Newton translator (`newtonGamePlayground.ts`,
`parseNewtonSeed` / `buildQuestionPackageFromRows`) rebuilds the immutable config
from the **rows**, not from `initial_game_state`.

> **Companion reference:** [`test-case-catalog.md`](./test-case-catalog.md) is a
> copy-paste catalog of every row type, rule/criterion/check kind, verdict metric, and
> `SIMULATOR_CONFIG` field — with a field-by-field syntax breakdown. Use it as the
> "what can I write" index; use this manual for the "why / how it grades".

Each question folder ships a **`django-admin-assignment.md`** that spells the rows
out verbatim; it is the copy-paste source for the Newton admin. It opens with a
standing note: **this shape is Newton-assignment-only** - standalone/local authoring
at `systems-simulator.newtonschool.co` keeps topology Open/Save and is authored from
`question.json`, not these rows.

### 11.1 The frontend contract (assignment mode)

- GAME iframe: `https://systems-simulator.newtonschool.co/?host=newton`.
- `question_text` renders as **raw Django HTML** (`presentationMode: "raw-html"`).
- The translator rebuilds config from the **test-case rows**, not `initial_game_state`.
- `initial_game_state` stays **mutable-only** learner state - paste `{}`, never the
  full `question.json`.
- Assignment mode **hides** topology Open/Save (and disables `Ctrl/Cmd+O` / `S`),
  hides the header settings entry point, **locks scaffold nodes**, keeps edges in
  **`connector`** mode, and **locks node resource + execution-profile editing** -
  unless a domain overlay unlocks it (§10.4: `network` → edges, `cost` → resources).
- **Because edges are connectors, grading must depend on topology + node choices, not
  on edge-property tuning** (latency / bandwidth / per-edge concurrency). Say so in
  the prompt and never author an edge-tuning expectation in a connector assignment.
- Justification prompts are hidden and ungraded in Newton assignment mode today -
  do **not** include `justify` rows in this flow.
- **The prompt always renders.** As long as `question_text` (or `question_title`) is set,
  the brief loads even before any rows exist or when a row is malformed. If the grading
  config can't be built, the question loads in **preview mode** (prompt visible) with a
  non-blocking _"grading not configured yet"_ notice, and validation failures surface as
  **author-actionable messages** (e.g. _"passThreshold must be a fraction between 0 and
  1"_) rather than a cryptic zod error. Only a seed with neither a prompt nor any grading
  row fails outright.
- **Row `input` must be pure JSON — no comments.** A trailing `// note` makes the row
  invalid JSON, so it is silently dropped; write the object only.

### 11.2 Django question fields

| Django field         | Value                                                     |
| -------------------- | --------------------------------------------------------- |
| `question_type`      | `GAME`                                                    |
| `question_title`     | the question title (e.g. `Design a URL shortener`)        |
| `question_text`      | **raw HTML** (see skeleton below) - rendered as-is        |
| `initial_game_state` | `{}` (mutable-only learner state; never the full package) |

The `question_text` HTML follows a fixed skeleton - prose prompt paragraphs, then
three `<h3>` blocks (Functional Requirements / Non-Functional Targets / Scale):

```html
<p>… scenario framing: "design the architecture, not code" …</p>
<p>… the core write/read paths and the target …</p>
<p>Target: redirect (read-path) p99 latency under 100 ms at peak.</p>
<p>
  In this assignment, links are simple connectors. Focus on which components should connect, not on
  tuning per-link network properties.
</p>
<p>Traffic: 200,000 peak RPS at a 99:1 read-to-write ratio. …</p>
<h3>Functional Requirements</h3>
<ul>
  <li>Write path: …</li>
  <li>Read path: …</li>
</ul>
<h3>Non-Functional Targets</h3>
<ul>
  <li>Redirect (read-path) p99 latency under 100 ms at peak load.</li>
</ul>
<h3>Scale</h3>
<ul>
  <li><strong>DAU:</strong> 50,000,000</li>
  <li><strong>Peak RPS:</strong> 200,000</li>
  <li><strong>Read / Write:</strong> 99:1</li>
</ul>
```

### 11.3 Test-case row conventions (the Django columns)

Each row is one Django test case. Create the rows **in the exact order** below. For
**every** row:

| Django column | Value                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `title`       | `"<ROW_TYPE>: <id>"` - e.g. `SIMULATOR_CONFIG: url-shortener`, `STRUCTURAL_RULE: single-source`, `RUBRIC_CHECK: p99` |
| `input`       | the JSON block for that row, pasted **verbatim**                                                                     |
| `hidden`      | `false`                                                                                                              |
| `output`      | `""` (empty)                                                                                                         |
| `output_file` | empty                                                                                                                |

Every `input` object is discriminated by its **`type`** key. `SIMULATOR_CONFIG` is
**optional** — a question authored from only `STRUCTURAL_RULE` / `SEMANTIC_CRITERION` /
`RUBRIC_CHECK` rows builds fine (every config field defaults). Add a `SIMULATOR_CONFIG`
row only to inject a workload (for Simulation checks), set a `budget`/`constraints`, or
override a default; when present, keep it first.

### 11.3a Minimal rows - write only the essence

The Newton translator (`buildQuestionPackageFromRows`) **fills every derivable
field**, so an authored row only needs the parts that carry meaning. A structural
rule is one line:

```json
{ "type": "STRUCTURAL_RULE", "kind": "requires_single_source" }
```

and a rubric check is:

```json
{ "type": "RUBRIC_CHECK", "metric": "summary.latency.p99", "op": "<", "value": 100 }
```

**Auto-filled when omitted** (set a field only to override; your value always wins):

| Omitted field                                              | Filled with                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rule / check `id`                                          | a unique slug from the kind/metric (`requires-single-source`, `p99`); collisions get `-2`, `-3`                                                                                                                                                       |
| rule / check `description`                                 | a human sentence derived from the kind                                                                                                                                                                                                                |
| `SEMANTIC_CRITERION.points`                                | `1`                                                                                                                                                                                                                                                   |
| `RUBRIC_CHECK.kind`                                        | inferred from the metric (`topology.*`→topology, invariant metric→invariant, else simulation)                                                                                                                                                         |
| `SIMULATOR_CONFIG.questionId`                              | slug of the title                                                                                                                                                                                                                                     |
| `questionType` / `difficulty`                              | `open-build` / `intermediate`                                                                                                                                                                                                                         |
| `scaffold`                                                 | `{ "type": "empty" }`                                                                                                                                                                                                                                 |
| `constraints.canModifyScaffold` / `canRemoveScaffoldNodes` | `true` (a partial `constraints` is completed; `maxNodeCount` etc. are yours)                                                                                                                                                                          |
| `suite.name` / `suite.visibleToStudent`                    | `<questionId>-suite` / `false`                                                                                                                                                                                                                        |
| `cases[].id` / `cases[].description`                       | `peak`, then `case-2`… / none                                                                                                                                                                                                                         |
| `requestDistribution[].weight`                             | `1` (or `1/n` split across classes)                                                                                                                                                                                                                   |
| `requestDistribution[].sizeBytes`                          | `256`                                                                                                                                                                                                                                                 |
| a `RUBRIC_CHECK` row, when you have none yet               | a harmless always-passing placeholder check so a structural-only draft still satisfies the "≥1 check" schema rule. It is **hidden from the authoring Tests list** (and excluded from the pass/total badge) — authors only ever see checks they wrote. |

**Keep a field only when it differs from the default** — e.g. `points` above 1,
`sizeBytes` ≠ 256, a non-default `weight`, a hard-fail (`"hardFail": true`), the
`accept`/`antiPattern` lists, an explicit `passThreshold` (0-1 fraction), or an
`environmentProfile` with non-default capabilities. The shipped
`django-admin-assignment.md` files are stripped to exactly this minimal shape.

> **Existing questions keep their authored `id`s.** When an authored id differs from
> what would be derived (e.g. `single-source` vs. `requires-single-source`), leave it
> — dropping it changes the check's result identifier. New questions can omit it.

### 11.4 Row 1 - `SIMULATOR_CONFIG` (the master row)

> The **whole row is optional** (§11.3), and every key below except `type` is optional
> (§11.3a). The full form is shown for reference; author only the keys whose value is not
> the default. `configVersion` and `promptSource` are not read at all; `questionVersion`
> and `presentationMode` default to `"1.0"` / `"raw-html"` — so in the common case all
> four are dropped.

Carries everything that is not a rule/criterion/check. Top-level keys:

| Key                               | Value / notes                                                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                            | `"SIMULATOR_CONFIG"`                                                                                                                                                 |
| `configVersion`                   | `"1.0"` (row schema version)                                                                                                                                         |
| `questionId` / `questionVersion`  | question identity                                                                                                                                                    |
| `questionType`                    | the archetype (`open-build`, …) - mirrors `type` in `question.json`                                                                                                  |
| `entryFormat`                     | Optional learner-entry shell (`requirements-first`, `partial-scaffold`, `locked-lab`, …) - mirrors `entryFormat` in `question.json`                                  |
| `domains` / `concepts`            | as in `question.json` §7 - **`domains` drive edit policy** (§10.4)                                                                                                   |
| `difficulty` / `workloadCategory` | as in `question.json`                                                                                                                                                |
| `presentationMode`                | `"raw-html"` (renders `question_text` as HTML)                                                                                                                       |
| `promptSource`                    | `"question_text"` (prompt comes from the Django field, not a `prompt.text`)                                                                                          |
| `scaffold`                        | `{ "type": "empty" }` or a `partial`/`complete` topology                                                                                                             |
| `constraints`                     | `canModifyScaffold` / `canRemoveScaffoldNodes` / `maxNodeCount`                                                                                                      |
| `suite`                           | the injected workload (`name`, `visibleToStudent`, `cases[]`) - §2                                                                                                   |
| `budget`                          | `{ "unit": "cost"\|"nodes"\|"edges", "cap": number }` - the anti-kitchen-sink cap (§6.2). Authored **in this row** (the Newton builder threads it into the package). |
| `rubric`                          | **header only** here: `{ id, passThreshold }`. The checks are their own rows.                                                                                        |
| `environmentProfile`              | the mode + visibility + capabilities lens - §10                                                                                                                      |

```json
{
  "type": "SIMULATOR_CONFIG",
  "configVersion": "1.0",
  "questionId": "url-shortener",
  "questionVersion": "1.0",
  "questionType": "open-build",
  "entryFormat": "requirements-first",
  "domains": ["compute", "storage"],
  "concepts": ["read-cache", "store-fit"],
  "difficulty": "intermediate",
  "workloadCategory": "read-heavy",
  "presentationMode": "raw-html",
  "promptSource": "question_text",
  "scaffold": { "type": "empty" },
  "constraints": { "canModifyScaffold": true, "canRemoveScaffoldNodes": true, "maxNodeCount": 12 },
  "suite": {
    "name": "url-shortener-suite",
    "visibleToStudent": false,
    "cases": [
      {
        "id": "peak",
        "description": "Read-heavy peak (injected 99:1)",
        "workload": {
          "baseRps": 2000,
          "requestDistribution": [
            { "type": "read", "weight": 0.99, "sizeBytes": 256 },
            { "type": "write", "weight": 0.01, "sizeBytes": 512 }
          ]
        }
      }
    ]
  },
  "rubric": { "id": "url-rubric", "passThreshold": 1 },
  "environmentProfile": {
    "mode": "ASSIGNMENT",
    "visibility": {
      "prompt": true,
      "scaffoldSourceNodes": true,
      "gradingSuiteDetails": false,
      "liveMetrics": true,
      "rubricChecks": "LIVE_DURING_BUILD"
    },
    "capabilities": {
      "editPaletteList": null,
      "canEditScaffoldNodes": false,
      "canTriggerTestRuns": true,
      "edgeModel": "connector",
      "canEditEdges": false,
      "canEditResources": false,
      "canEditExecutionProfile": false
    },
    "graded": true,
    "chromeDensity": "minimal"
  }
}
```

### 11.5 Rows 2…N - one row per rule / criterion / check

Each is a stringified object of the matching `question.json` sub-schema plus a
`type` discriminator. The body (minus `type`) must be **byte-equal** to the
corresponding array element in `question.json`.

| Row `type`           | Body = one element of      | Kinds                                                                       |
| -------------------- | -------------------------- | --------------------------------------------------------------------------- |
| `STRUCTURAL_RULE`    | `structuralRules[]` (§5.3) | `requires_component`, `requires_single_source`, …                           |
| `SEMANTIC_CRITERION` | `semanticCriteria[]` (§5)  | `placement` / `guardedPath` / `fanout` / `storageFit` / `forbidUnjustified` |
| `RUBRIC_CHECK`       | `rubric.checks[]` (§4.2)   | `simulation` / `topology` / `invariant`                                     |

Worked example - the remaining url-shortener rows. The Django `title` is the label; the
`input` is the JSON only (**no comments — a `//` line makes the input invalid JSON**):

`title`: `STRUCTURAL_RULE: single-source`

```json
{
  "type": "STRUCTURAL_RULE",
  "id": "single-source",
  "kind": "requires_single_source",
  "description": "Exactly one traffic source"
}
```

`title`: `SEMANTIC_CRITERION: store-fits-point-lookup`

```json
{
  "type": "SEMANTIC_CRITERION",
  "id": "store-fits-point-lookup",
  "kind": "storageFit",
  "description": "Short-code lookup is a direct lookup by key",
  "accessPattern": "point-lookup",
  "accept": ["kv-store", "nosql-db"],
  "partial": ["in-memory-cache"],
  "antiPattern": ["relational-db"],
  "points": 3,
  "hardFail": true
}
```

`title`: `RUBRIC_CHECK: p99`

```json
{
  "type": "RUBRIC_CHECK",
  "id": "p99",
  "kind": "simulation",
  "description": "p99 under 100 ms",
  "metric": "summary.latency.p99",
  "op": "<",
  "value": 100,
  "points": 3
}
```

`title`: `RUBRIC_CHECK: no-invariants`

```json
{
  "type": "RUBRIC_CHECK",
  "id": "no-invariants",
  "kind": "invariant",
  "description": "No invariant violations",
  "metric": "invariantViolations.count",
  "op": "==",
  "value": 0,
  "points": 1
}
```

That five-row set (1 `SIMULATOR_CONFIG` + 1 `STRUCTURAL_RULE` + 1 `SEMANTIC_CRITERION`

- 2 `RUBRIC_CHECK`) is a complete, gradeable Newton assignment. Add more
  `STRUCTURAL_RULE` / `SEMANTIC_CRITERION` / `RUBRIC_CHECK` rows one-per-obligation as
  the question grows.

> **Keep the two shapes in lock-step.** `validate-question-dir` grades the
> `question.json`; the django rows are what actually ships to students. A drift
> between them means the student sees a different question than the one you
> validated - §11.6 is the guard.

### 11.6 Per-question authoring checklist (alignment)

- [ ] Every `componentType` referenced (structural + semantic) exists in the current
      palette (`PALETTE_TEMPLATES`).
- [ ] `SIMULATOR_CONFIG.entryFormat` / `scaffold` / `constraints` / `suite` /
      `domains` / `concepts` match `question.json` exactly.
- [ ] Each `STRUCTURAL_RULE` / `SEMANTIC_CRITERION` / `RUBRIC_CHECK` row equals its
      `question.json` array element (minus `type`).
- [ ] `question_text` HTML says the same thing as `prompt.text` (+ FR/NFR/scale).
- [ ] `environmentProfile.capabilities` carries the current field set
      (`edgeModel`, `canEditEdges`, `canEditResources`, `canEditExecutionProfile`,
      `canEditScaffoldNodes`).
- [ ] Reference passes and gamed fails via `validate-question-dir` (§1.2).

---

## Appendix A - The Functional-Requirement Taxonomy (all FR classes)

Every FR reduces to one of these classes. Each maps to a DSL obligation (T/S) or
is **narrative** (app-logic the sim can't grade → structural proxy + `justify`).

| FR class                           | Example verbs / phrasings                                                   | Obligation                                                                                    | Gradeable? |
| ---------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| **Create / write a record**        | "create a short code", "post an item", "place an order", "ingest a reading" | `requires_path`(source→store); `storageFit`                                                   | T/S        |
| **Read / look up**                 | "redirect a code", "load a feed", "get order status", "range-query recent"  | `requires_path`(source→store); cache via Σ p99                                                | T/Σ        |
| **Match / assign**                 | "match rider→driver", "assign a worker"                                     | `requires_path` + `placement` (hot path off the txn DB)                                       | T          |
| **Track / stream**                 | "track live location", "stream updates"                                     | `requires_component`(stream/websockets-gateway)                                               | T          |
| **Pay / transact (consistent)**    | "process payment", "strongly-consistent"                                    | `storageFit`(transactional-relational) + `guardedPath`(→lock/idempotency) + `justify`         | S/T/J      |
| **Search**                         | "search events/products"                                                    | `requires_component`(search-index); `storageFit`(search-index)                                | T/S        |
| **Enqueue / decouple (async)**     | "accept jobs quickly", "process within SLA"                                 | `requires_component`(queue)+`requires_component`(worker); `guardedPath`(→queue→worker); Σ SLA | T/Σ        |
| **Fan-out / broadcast**            | "each of N consumers receives every event"                                  | `fanout`(broker, N, forbiddenBroker=queue)                                                    | T          |
| **Dedup / idempotency**            | "enqueue only new URLs", "exactly-once"                                     | `guardedPath`(→dedup index / idempotency store) + `justify`                                   | T/J        |
| **Rate-limit / throttle**          | "limit requests", "shared counters"                                         | `requires_component`(rate-limiter)+`requires_edge`(rl→shared cache)+`guardedPath` + `justify` | T/J        |
| **Serialize / lock (contention)**  | "no double-booking", "hold a seat once"                                     | `guardedPath`(→distributed-lock) + `justify` (TTL/OCC)                                        | T/J        |
| **Aggregate / batch (throughput)** | "crawl billions", "aggregate 23K/s"                                         | `placement` orderedPipeline + Σ throughput                                                    | T/Σ        |
| **Audit / immutability**           | "auditable trail", "append-only"                                            | `storageFit`(append-only-ledger); `forbids_component`(mutable store on that path) + `justify` | S/T/J      |
| **Omit / avoid waste**             | "don't add a wasteful CDN"                                                  | `forbidUnjustified` + `justify`                                                               | T/J        |
| **Cache / accelerate reads**       | "keep redirects fast"                                                       | Σ p99 under injected read-heavy load (NOT guardedPath)                                        | Σ          |
| **Generate an id / encode**        | "generate a unique code", "base62"                                          | **narrative** - structural proxy (a store) + `justify` context                                | J only     |
| **Return a protocol response**     | "return 301/302", "HTTP status"                                             | **narrative** - `justify` context; not modeled                                                | J only     |

---

## Appendix B - Per-Archetype Solution-Nuance Catalog (the "nitty-gritties")

Nuances an expert answer includes. Classified: **[G]** gradeable in the sim/DSL;
**[J]** justification-only (deterministic text check); **[N]** narrative/context
(surface in prompt or `justify`, not gradeable).

**URL Shortener** - base62 code encoding **[N/J]**; 301 (permanent) vs 302
(temporary) redirect **[N/J]**; key = short code, point-lookup **[G storageFit]**;
counter/ZooKeeper-range vs hash for id generation **[J]**; cache the hot reads
**[G Σ p99]**; write path persists (not cache-served) **[N/J]**.

**News Feed** - fan-out-on-write vs on-read given the read ratio **[J]**; timeline
store is point-lookup **[G]**; broker fans to timeline builders **[G fanout]**;
celebrity/hot-key handling **[J]**.

**Sensor / time-series** - wide-column/TSDB, NOT relational **[G storageFit hardFail]**;
partition key = sensor_id, clustering = timestamp **[J]**; downsampling/retention
**[N]**; write throughput **[G Σ throughput]**.

**Cache placement** - cache between service & DB, not before the LB **[G placement]**;
cache-aside vs write-through **[J]**; TTL / invalidation **[J]**.

**Messaging fan-out** - pub/sub broker not a work-queue (queue→N is wrong) **[G fanout hardFail]**;
at-least-once vs exactly-once delivery **[J]**; consumer groups **[J]**.

**Cargo-cult CDN** - CDN wasteful for dynamic per-user responses; omit or defend
**[G forbidUnjustified + J]**; static vs dynamic cacheability **[J]**.

**Ride-hailing** - geospatial hot path (geohash/quadtree) off the txn DB
**[G placement]**; payment path = SQL, strongly consistent **[G storageFit]**;
match latency < 3s **[G Σ]**; location updates high-frequency stream **[T]**;
surge pricing **[N]**.

**Rate limiter** - counters in a **shared** store, not per-instance **[G requires_edge + guardedPath hardFail]**;
token-bucket vs sliding-window algorithm **[J]**; cache not DB for counters (latency)
**[J number]**; atomic increments / Lua **[N]**.

**Async SLA** - queue + scalable workers; sync fails the SLA at load **[G Σ + structural]**;
autoscaling policy **[J + $ budget]**; back-pressure / DLQ **[J]**; idempotent workers **[J]**.

**Ticketmaster** - distributed lock (with TTL) serializes seat holds; no double-book
**[G guardedPath hardFail + J]**; virtual waiting queue absorbs surge **[G requires_component + Σ]**;
bookings transactional-relational **[G storageFit]**; search-index for events **[G]**;
OCC vs pessimistic locking **[J]**.

**Web Crawler** - frontier→fetch→process ordered pipeline **[G placement orderedPipeline]**;
URL dedup before enqueue (bloom filter / index) **[G guardedPath + J]**; per-domain
politeness / rate-limit **[J]**; content dedup (simhash) **[J]**; aggregate throughput
**[G Σ]**; DLQ for failures **[J]**; content in blob/object-storage **[G storageFit blob]**.

**Payment** - idempotency key guards every write; exactly-once **[G guardedPath hardFail + J]**;
immutable append-only double-entry ledger **[G storageFit append-only-ledger hardFail]**;
reconciliation job **[N]**; 2-phase / saga for cross-service **[J]**; durable, HA
ledger **[G Σ availability / errorRate]**.

---

## Appendix C - Access-Pattern Catalog (`storageFit.accessPattern`)

The full enum + recommended `accept` / `antiPattern` store types. Access pattern
is an **authored grading concept** (inferred by the student from the FRs); it is
NOT a canvas/node property. The student chooses a store type; `storageFit` grades
the fit.

| `accessPattern`            | Meaning                                        | `accept` (full credit)                      | `partial`                 | `antiPattern` (hard-fail-worthy)  |
| -------------------------- | ---------------------------------------------- | ------------------------------------------- | ------------------------- | --------------------------------- |
| `point-lookup`             | get-by-key (URL→long)                          | `kv-store`, `nosql-db`                      | `in-memory-cache`         | `relational-db` (at scale)        |
| `time-series`              | append + range-by-time (sensors)               | `time-series-db`, `columnar-db`, `nosql-db` | -                         | `relational-db`                   |
| `append-only-ledger`       | immutable double-entry (payments)              | `event-sourcing-store`                      | -                         | `in-memory-cache`, mutable stores |
| `transactional-relational` | ACID, joins, money (bookings)                  | `relational-db`                             | -                         | `in-memory-cache`, `kv-store`     |
| `search-index`             | full-text / faceted (events, products)         | `search-index`                              | `nosql-db`                | `relational-db` (for full-text)   |
| `blob`                     | large immutable objects (media, crawl content) | `object-storage`, `block-storage`           | `distributed-file-system` | `relational-db`, `kv-store`       |

> **Candidate additions** (not yet in the enum - future work): `wide-column`
> (distinct from time-series), `graph-traversal` (`graph-db`), `vector-similarity`
> (`vector-db`), `geospatial` (geohash/quadtree over a KV/index), `counter`
> (atomic increment - cache), `stream` (`stream`/`event-bus`). Until added, model
> these via `accept`/`antiPattern` type lists on the nearest pattern + a `justify`.
