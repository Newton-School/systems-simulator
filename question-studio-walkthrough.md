# QuickCart Flash Sale — Question Studio Walkthrough

Use this guide to author the **QuickCart Flash Sale** question in Question Studio.

> This is the author workflow. For the learner and canonical solution, see the
> [Builder Walkthrough](builder-walkthrough.md).

## Finished teaching and grading contract

- **Dominant lesson:** calculate and provision horizontal backend capacity while
  reserving 20% headroom.
- **Expected topology family:** one `api-endpoint` source routes through one
  `load-balancer` to one or more `microservice` backend nodes representing at
  least 13 identical server units.
- **Passing evidence:** the connected design serves `1000000` req/s with
  `summary.errorRate < 0.01`, `summary.throughput >= 1000000`, and no violation of
  `perNode.maxUtilization <= 0.8`.
- **Plausible wrong design:** 12 identical server units; it carries the full load
  but reaches 83.3% utilization and fails `within-headroom`.
- **Feasibility:** **Direct** analytic/fluid capacity evaluation, with explicit
  homogeneous-server and connector-edge simplifications.

### Shared authoring facts

| Fact                      | Contract                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Title                     | `QuickCart Flash Sale`                                                                 |
| Stable slug               | `quickcart-flash-sale`                                                                 |
| Question type / entry     | `scaling` / `blank-canvas`                                                             |
| Real and evaluation scale | `1000000` req/s; no scale compression                                                  |
| Server unit               | `microservice`, `m5.xlarge`, one instance, `io-bound`, constant `1.28` ms service time |
| Capacity per server unit  | `128 / 0.00128 = 100000` req/s                                                         |
| Passing fleet             | 13 server units; 1.3M req/s aggregate; 76.9% utilization                               |
| Near miss                 | 12 server units; 1.2M req/s aggregate; 83.3% utilization                               |
| Edge/routing model        | Connector edges; synchronous; even round-robin split                                   |
| Scenario                  | Constant GET traffic, 5 sec, no warmup, no faults                                      |
| Runtime invariant         | `perNode.maxUtilization <= 0.8`                                                        |
| Pass threshold            | `1` (all scored checks)                                                                |

### Modeling boundaries

| Concern                                                 | Treatment             | Reason                                                         |
| ------------------------------------------------------- | --------------------- | -------------------------------------------------------------- |
| Offered/served RPS, utilization, saturation, drops      | Modeled directly      | These are first-class analytic outputs.                        |
| Required components and directed connections            | Structurally graded   | Static graph rules are the authoritative topology evidence.    |
| Exactly 100K req/s per server unit                      | Derived configuration | Four vCPU × 32 IO workers divided by 1.28 ms gives 100K req/s. |
| Load-balancer internals                                 | Simplified proxy      | The balancer is an infinite-capacity even-split passthrough.   |
| Link latency, bandwidth, loss, and egress               | Not modeled           | Assignment edges are connectors.                               |
| Shopping, checkout, inventory, data stores, consistency | Deferred              | They are separate lessons absent from the source question.     |
| Autoscaling delay and machine failures                  | Explanation-only      | The baseline is steady-state healthy capacity planning.        |

## Before you start

1. Open Question Studio at `/question-studio`, `?studio=question`, or
   `?surface=question-studio`.
2. Click **New**.
3. Work through **Frame**, **Brief**, **Start**, **Scenarios**, **Grading**,
   **Preview**, and **Export**.
4. Use the final title before creating checks so the generated ID remains stable.
5. Click **Save draft** regularly.

Do not start from a legacy package that encodes topology requirements as raw
`topology.*` rubric metrics. The current visual Studio expresses these as
structural rules.

---

## Stage 1 — Frame

### Question identity

| Field                     | Value                  |
| ------------------------- | ---------------------- |
| **Question title**        | `QuickCart Flash Sale` |
| **Generated question ID** | `quickcart-flash-sale` |

If the generated ID differs, correct the title now rather than editing compiled
output later.

### Runtime question setup

| Field                                  | Value                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| **Question type**                      | **Scaling**                                                 |
| **Difficulty**                         | **Beginner**                                                |
| **Learner entry**                      | **Blank canvas**                                            |
| **Workload category**                  | **Read heavy**                                              |
| **Estimated time**                     | `10` min                                                    |
| **Pass threshold**                     | `1`                                                         |
| **Teaching domains**                   | **Compute**                                                 |
| **Concepts taught**                    | `horizontal-scaling`, `capacity-headroom`, `load-balancing` |
| **Grade a budget**                     | Off                                                         |
| **Let learners see grading scenarios** | Off                                                         |

`Pass threshold = 1` is a fraction and requires every scored rubric check to pass.
Structural rules remain independent gates.

### Catalogue metadata

| Field                 | Value                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Short description** | `Scale a stateless request tier behind a load balancer to serve a 1,000,000 req/s flash sale while keeping every server at or below 80% utilization.` |
| **Author**            | `Curriculum team` or the owning team name                                                                                                             |
| **Created date**      | `2026-09-21`                                                                                                                                          |
| **Tags**              | `scaling`, `load-balancing`, `capacity-planning`, `headroom`                                                                                          |

Click **Continue to Brief**.

## Stage 2 — Brief

### Problem statement

Paste this exact text into **Problem statement**:

```text
You are the backend architect for an e-commerce website called QuickCart.

QuickCart is running a major flash sale. During the sale, the website is expected to receive up to 1,000,000 requests per second.

Each backend server can handle a maximum of 100,000 requests per second. To keep the servers stable, use no more than 80% of each server's capacity.

The load balancer distributes incoming requests evenly across every backend server you add.

Build the backend architecture for QuickCart from Users, a Load Balancer, and Servers. Configure each server unit to the stated 100,000 req/s capacity, then add enough server units to serve the full load within the 80% headroom limit.
```

### Functional requirements

Click **Add requirement** three times and enter, in this order:

1. `Accept incoming user traffic through a load balancer.`
2. `Distribute traffic evenly across a pool of stateless backend servers.`
3. `Serve the full 1,000,000 req/s offered load without material drops.`

### Non-functional requirements

| Metric     | Operator |     Value | Unit            | Graded by                 |
| ---------- | -------- | --------: | --------------- | ------------------------- |
| Throughput | `>=`     | `1000000` | requests/second | `sustain-peak-throughput` |
| Error rate | `<`      |       `1` | percent         | `no-dropped-requests`     |

The 80% requirement is not one of the friendly NFR card metrics. Keep it in the
problem statement and enforce it through the scenario invariant plus
`within-headroom` rubric check.

### Scale and additional context

| Field            |           Value |
| ---------------- | --------------: |
| **Peak traffic** | `1000000` req/s |
| **Read share**   |          `100`% |
| **DAU**          |     Leave blank |
| **Stored data**  |     Leave blank |
| **Retention**    |     Leave blank |
| **Growth rate**  |     Leave blank |

Enter this in **Additional learner context**:

```text
Treat every backend server unit as identical and stateless. One unit provides 100,000 req/s full-load capacity. The load balancer uses an even round-robin split. At most 80% means utilization <= 0.8. Network-link tuning, databases, inventory correctness, and autoscaling delay are outside this question.
```

Click **Continue to Start**.

## Stage 3 — Start

Use a blank canvas.

1. Leave **Scaffold canvas** as **Blank**; do not create a starting topology.
2. Under **Allowed component types**, select only:
   - **Client App / Input Source** (`api-endpoint`);
   - **Load Balancer** (`load-balancer`);
   - **API Server** (`microservice`).
3. Leave **Forbidden component types** empty.
4. Leave **Maximum nodes**, **Maximum total workers**, and **Maximum runtime cost**
   empty. The visible canonical answer has 15 nodes, while the accepted compact
   form has one server-pool node with 13 service instances.
5. Keep **Can modify scaffold** and **Can remove scaffold nodes** enabled; the
   scaffold is empty.
6. Use an **ASSIGNMENT** environment with connector edges and explicitly enable
   resource and execution-profile editing for this capacity lesson:

| Environment capability    | Value                                           |
| ------------------------- | ----------------------------------------------- |
| `edgeModel`               | `connector`                                     |
| `canEditEdges`            | `false`                                         |
| `canEditResources`        | `true`                                          |
| `canEditExecutionProfile` | `true`                                          |
| `canEditScaffoldNodes`    | `true`                                          |
| `canTriggerTestRuns`      | `true`                                          |
| `editPaletteList`         | `api-endpoint`, `load-balancer`, `microservice` |

The capacity readout must remain read-only. Learners change instance type/count,
execution profile, and service time; the simulator derives throughput capacity.

### Canonical node configuration

The learner guide gives the detailed clicks. The author contract is:

| Server field          | Exact value                                      |
| --------------------- | ------------------------------------------------ |
| Component             | **API Server** (`microservice`)                  |
| Instance type         | `m5.xlarge`                                      |
| Service instances     | `1` per visible node or `13` on the compact pool |
| Execution profile     | `io-bound`                                       |
| Distribution model    | `constant`                                       |
| Mean service time     | `1.28` ms                                        |
| Timeout               | `1000` ms                                        |
| Queue discipline      | `fifo`                                           |
| Derived unit capacity | `100000` req/s                                   |

Click **Continue to Scenarios**.

## Stage 4 — Scenarios

Click **Add baseline**. Give the scenario the ID `flash-sale-peak` and configure:

| Field                        | Value                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **What this scenario tests** | `Sustain the 1,000,000 req/s flash-sale peak while every backend server remains at or below 80% utilization.` |
| **Fixed seed**               | `quickcart-flash-sale-v1`                                                                                     |
| **Traffic pattern**          | **Constant**                                                                                                  |
| **Run duration**             | `5` sec                                                                                                       |
| **Warmup**                   | `0` sec                                                                                                       |
| **Base traffic**             | `1000000` req/s                                                                                               |
| **Read traffic**             | `100`%                                                                                                        |
| **Request size**             | `100` bytes                                                                                                   |
| **Source node ID**           | Leave blank                                                                                                   |
| **Time resolution**          | `millisecond`                                                                                                 |
| **Default timeout**          | `1000` ms                                                                                                     |
| **Stop condition**           | **Duration elapses**                                                                                          |

Under the custom request mix, use exactly one entry:

| Type  | Weight |        Size |
| ----- | -----: | ----------: |
| `GET` | `100%` | `100` bytes |

The weights total 100%. Leave keyspace, metadata, origins, faults, and saturation
early-stop controls unused. This is a steady-state healthy capacity case, not a
per-request or chaos lesson.

### Invariant

Under **Scenario invariants**, click **Add invariant**:

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| **ID**          | `headroom-80`                                                       |
| **Description** | `No backend server may exceed 80% of its capacity during the sale.` |
| **Condition**   | `perNode.maxUtilization <= 0.8`                                     |

Select `flash-sale-peak` as the **Learner-visible dry run**. The card footer must
show **Normalized runtime case**. This high-rate steady-state case intentionally
uses the real scale and resolves through the analytic/fluid evaluator.

Click **Continue to Grading**.

## Stage 5 — Grading

### Structural grading

Add these rules in order:

| ID                        | Studio rule                        | Exact configuration                               | Purpose                                            |
| ------------------------- | ---------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `single-source`           | Require exactly one traffic source | No additional fields                              | Prevents duplicate or missing Users sources.       |
| `requires-load-balancer`  | Require a component                | Component `load-balancer`; minimum `1`            | Requires the distribution tier.                    |
| `requires-server-pool`    | Require a component                | Component `microservice`; minimum `1`             | Requires a backend fleet representation.           |
| `users-to-load-balancer`  | Require a direct connection        | From `api-endpoint`; to `load-balancer`; any edge | Forces incoming traffic through the load balancer. |
| `load-balancer-to-server` | Require a direct connection        | From `load-balancer`; to `microservice`; any edge | Connects the load balancer to backend capacity.    |
| `connected-design`        | Require a connected design         | No additional fields                              | Rejects disconnected icon placement.               |

Do not add topology rubric metrics for the same obligations. Structural rules are
the current visual-Studio surface and short-circuit invalid graphs before runtime.

### Semantic grading

Leave semantic grading empty. No `componentProperty`, `placement`, storage-fit,
guarded-path, fan-out, or runtime state criterion is needed. Capacity is verified
by the analytic outcome, not by inventing a property path.

### Runtime metric grading

Click **Add metric test**:

| Metric     | Comparison        | Human value | Compiled check             |
| ---------- | ----------------- | ----------: | -------------------------- |
| Error rate | **must be below** |        `1`% | `summary.errorRate < 0.01` |

Name the compiled check `no-dropped-requests` and assign `1` point. The Studio
input is a human percentage; the raw rubric value is the fraction `0.01`.

### Verdict-metric grading

Add these checks:

| ID                        | Metric                      | Comparison |     Value | Points |
| ------------------------- | --------------------------- | ---------- | --------: | -----: |
| `sustain-peak-throughput` | `summary.throughput`        | `>=`       | `1000000` |    `1` |
| `within-headroom`         | `invariantViolations.count` | `==`       |       `0` |    `2` |

Set `within-headroom` to invariant kind if the Studio does not infer it from the
metric family. The extra point weight highlights the central lesson, although
`passThreshold = 1` means all three runtime checks must pass.

### Justification

Leave justification unused. It is not required for this beginner capacity
exercise, and some hosted assignment flows do not collect it.

## Requirement traceability and compiled row plan

### Requirement traceability

| Source statement or learner obligation  | Primary disposition                    | Studio control                                             | Compiled row/check                                               | Evidence                                      |
| --------------------------------------- | -------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Use Users as the traffic source         | Structurally graded                    | **Grading → Structural**                                   | `STRUCTURAL_RULE requires_single_source`                         | Static topology                               |
| Place the load balancer                 | Structurally graded                    | **Grading → Structural**                                   | `STRUCTURAL_RULE requires_component(load-balancer)`              | Static topology                               |
| Add backend servers                     | Structurally graded + runtime          | **Grading → Structural** and scenario                      | `STRUCTURAL_RULE requires_component(microservice)`               | Static presence plus modeled capacity         |
| Route Users through the load balancer   | Structurally graded                    | **Grading → Structural**                                   | `STRUCTURAL_RULE requires_edge(api-endpoint, load-balancer)`     | Static directed edge                          |
| Distribute to the backend pool          | Structurally graded + inferred routing | **Grading → Structural**                                   | `STRUCTURAL_RULE requires_edge(load-balancer, microservice)`     | Static edge; even split from LB configuration |
| Keep the graph connected                | Structurally graded                    | **Grading → Structural**                                   | `STRUCTURAL_RULE requires_connected_graph`                       | Static topology                               |
| Peak is 1,000,000 req/s                 | Runtime scenario                       | **Scenarios**                                              | `SIMULATOR_CONFIG suite.cases[flash-sale-peak].workload.baseRps` | Question-owned analytic load                  |
| Each server unit is 100,000 req/s       | Modeled configuration                  | **Start / learner node inspector**                         | Derived from 128 workers / 1.28 ms                               | Read-only capacity output                     |
| Serve the full load                     | Runtime graded                         | **Grading → Verdict metric**                               | `RUBRIC_CHECK summary.throughput >= 1000000`                     | Analytic summary                              |
| Avoid material drops                    | Runtime graded                         | **Grading → Runtime metric**                               | `RUBRIC_CHECK summary.errorRate < 0.01`                          | Analytic summary                              |
| Use at most 80% per server              | Invariant graded                       | **Scenarios → Invariant** and **Grading → Verdict metric** | `headroom-80` + `RUBRIC_CHECK invariantViolations.count == 0`    | Analytic per-node utilization                 |
| Shopping/inventory/autoscaling concerns | Deferred or explanation-only           | Brief boundary wording                                     | No row                                                           | Explicitly outside the lesson                 |

The invariant and rubric check are not duplicate grades: the scenario invariant
defines the condition, while the rubric row makes any violation affect the pass
contract.

### Ordered row inventory

The expected compiled inventory uses only the four supported row types:

|   # | Row title                                  | Exact row intent                                                                                                                                                                                                                                                                                                                                     |
| --: | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `SIMULATOR_CONFIG: quickcart-flash-sale`   | `questionType=scaling`; `entryFormat=blank-canvas`; `difficulty=beginner`; `domains=[compute]`; concepts as above; allowed types `[api-endpoint, load-balancer, microservice]`; `flash-sale-peak` workload, seed, timing, request mix, and `headroom-80`; `passThreshold=1`; ASSIGNMENT connector environment with resource/profile editing enabled. |
|   2 | `STRUCTURAL_RULE: single-source`           | `kind=requires_single_source`                                                                                                                                                                                                                                                                                                                        |
|   3 | `STRUCTURAL_RULE: requires-load-balancer`  | `kind=requires_component`; `componentType=load-balancer`; `minCount=1`                                                                                                                                                                                                                                                                               |
|   4 | `STRUCTURAL_RULE: requires-server-pool`    | `kind=requires_component`; `componentType=microservice`; `minCount=1`                                                                                                                                                                                                                                                                                |
|   5 | `STRUCTURAL_RULE: users-to-load-balancer`  | `kind=requires_edge`; `fromType=api-endpoint`; `toType=load-balancer`                                                                                                                                                                                                                                                                                |
|   6 | `STRUCTURAL_RULE: load-balancer-to-server` | `kind=requires_edge`; `fromType=load-balancer`; `toType=microservice`                                                                                                                                                                                                                                                                                |
|   7 | `STRUCTURAL_RULE: connected-design`        | `kind=requires_connected_graph`                                                                                                                                                                                                                                                                                                                      |
|   8 | `RUBRIC_CHECK: no-dropped-requests`        | `kind=simulation`; `metric=summary.errorRate`; `op="<"`; `value=0.01`; `points=1`                                                                                                                                                                                                                                                                    |
|   9 | `RUBRIC_CHECK: sustain-peak-throughput`    | `kind=simulation`; `metric=summary.throughput`; `op=">="`; `value=1000000`; `points=1`                                                                                                                                                                                                                                                               |
|  10 | `RUBRIC_CHECK: within-headroom`            | `kind=invariant`; `metric=invariantViolations.count`; `op="=="`; `value=0`; `points=2`                                                                                                                                                                                                                                                               |

There are no `SEMANTIC_CRITERION` rows. Workload, invariant, constraints, rubric
header, and environment profile remain fields inside the `SIMULATOR_CONFIG` row;
do not invent separate workload or constraint row types.

## Stage 6 — Preview

Verify the learner preview shows:

- title **QuickCart Flash Sale** and generated ID `quickcart-flash-sale`;
- the full prompt, three FRs, two NFR cards, and the 80% boundary wording;
- a blank canvas;
- only Client App / Input Source, Load Balancer, and API Server components;
- resource, execution-profile, and performance controls required to reproduce a
  100K-RPS server unit;
- the `flash-sale-peak` learner dry run but not hidden grading internals;
- the connector-edge and out-of-scope modeling disclaimer.

Reproduce the canonical design from the
[Builder Walkthrough](builder-walkthrough.md). Confirm the server capacity readout
is `100000` req/s per unit before judging the 12-versus-13 split.

## Stage 7 — Export

Proceed only when the compiler shows **Generated output is current**. Inspect:

1. **Question package** — ID `quickcart-flash-sale`; real-scale constant workload;
   seed `quickcart-flash-sale-v1`; five-second duration; `headroom-80`; allowed
   component types; pass threshold `1`.
2. **Newton rows** — exactly one config row, six structural rows, no semantic
   rows, and three rubric rows in the order above.
3. **Django handoff** — `question_type=GAME`, the final title and learner prompt,
   `initial_game_state={}`, pure-JSON row inputs, and the explicit ASSIGNMENT
   environment capabilities.

Confirm all compiled units:

- Studio `1%` error rate became raw `0.01`;
- 80% utilization became raw `0.8` with operator `<=`;
- pass threshold remains fraction `1`;
- durations compile in the runtime's expected unit;
- request weights total `1`.

Save the editable draft separately, then download the deployable Django bundle.
Do not hand-edit generated JSON to repair a Studio mismatch.

## Acceptance and discrimination checks

Run these candidates in the target environment:

| Candidate design                             | Expected evidence                                    | Expected outcome | Exact failing obligation                                                |
| -------------------------------------------- | ---------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| Correct icons, no edges                      | Structural gate fails before simulation              | Fail             | `users-to-load-balancer`, `load-balancer-to-server`, `connected-design` |
| 8 server units at 100K each                  | ~800K throughput, ~20% error, 125% max utilization   | Fail             | `no-dropped-requests`, `sustain-peak-throughput`, `within-headroom`     |
| 12 server units at 100K each                 | ~1M throughput, ~0% error, 83.3% max utilization     | Fail             | `within-headroom`                                                       |
| **13 server units at 100K each**             | **~1M throughput, ~0% error, 76.9% max utilization** | **Pass**         | All obligations pass                                                    |
| 14 server units at 100K each                 | ~1M throughput, ~0% error, 71.4% max utilization     | Pass             | All obligations pass; higher resource use                               |
| One server-pool node, 13 identical instances | Same rate and utilization as 13 visible nodes        | Pass             | Accepted equivalent fleet representation                                |

Also test these anti-gaming cases:

- **Lowered learner workload:** must still grade against the question-owned
  `1000000` req/s case.
- **Two Users nodes:** must fail `single-source`.
- **Disconnected extra servers:** must fail `connected-design` and must not add
  serving capacity.
- **Uneven routing:** must fail `within-headroom` if the busiest server exceeds
  `0.8`, even when aggregate capacity is sufficient.
- **Raw fake `capacityRps`:** a learner value without the author-only trust flag
  must be ignored; capacity must remain derived.

## Validation levels

| Level                       | Status                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offline consistency         | Complete: titles, slug, topology tokens, scenario, weights, units, thresholds, and cross-links agree across both walkthroughs.                                                               |
| Question Studio compilation | Not performed in this authoring session; required before deployment.                                                                                                                         |
| Behavioral simulation       | Target-engine QuickCart tests confirm 13 passes, 12 fails headroom, 8 fails drop and headroom checks, and the million-RPS case selects analytic evaluation. Re-run after Studio compilation. |

## Troubleshooting

- **Wrong generated ID:** return to **Frame** and use the exact title
  `QuickCart Flash Sale`.
- **Scenario incomplete:** populate every required number, keep warmup below
  duration, and ensure the request weights total 100%.
- **Server capacity is not 100K:** verify `m5.xlarge`, one instance,
  `io-bound`, constant `1.28` ms service time, and the read-only capacity
  provenance. Do not compensate with a raw capacity field.
- **Resource or profile controls are locked:** correct the ASSIGNMENT environment
  capabilities; this question explicitly requires both controls.
- **Eight server units pass:** confirm `baseRps=1000000`, the server-unit capacity,
  and both throughput/error rubric checks.
- **Twelve server units pass:** confirm the invariant is
  `perNode.maxUtilization <= 0.8` and `within-headroom` checks
  `invariantViolations.count == 0`.
- **Metric never resolves:** use only catalog metrics and confirm the case resolves
  analytically; do not invent a metric path.
- **Expected runtime evidence is missing:** fix structural failures first because
  structural grading short-circuits simulation.
- **Good design cannot be built:** confirm the three allowed component types and
  remove accidental node, worker, or cost caps.
- **Named control is absent:** record a target-version compatibility mismatch and
  refresh the package; do not fabricate navigation or patch generated JSON.
