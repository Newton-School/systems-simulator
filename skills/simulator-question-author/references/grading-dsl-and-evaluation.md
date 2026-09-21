# Grading DSL and Evaluation

Use this reference to map the question into implementable checks and to describe
the compiled row plan in the Question Studio walkthrough. Component tokens and
stable metric paths are listed in
[component-and-metric-catalog.md](component-and-metric-catalog.md).

## 1. The four row types

The Newton/Django row contract recognizes exactly four row types:

| Row type             | Purpose                                                                                                               |               Runs simulation? |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | -----------------------------: |
| `SIMULATOR_CONFIG`   | Question identity, entry shape, scaffold, constraints, suite, budget, rubric setup, environment.                      |                             No |
| `STRUCTURAL_RULE`    | Static graph shape: components, categories, edges, paths, counts, redundancy, connectivity, source count.             |                             No |
| `SEMANTIC_CRITERION` | Component meaning, configuration, placement, guarded paths, fan-out, store fit, and supported runtime state evidence. |                      Sometimes |
| `RUBRIC_CHECK`       | Numeric assertion over topology, simulation, or invariant verdict data.                                               | Simulation/invariant checks do |

Everything else is a field inside one of these rows. There is no standalone
workload, constraint, budget, or justification row.

In the Question Studio walkthrough, include a compact compiled-row plan even
though the author works through visual controls.

## 2. Evaluation order

The current question evaluator broadly performs:

1. schema and constraints;
2. structural evaluation;
3. short-circuit if structural gates fail;
4. justification, when enabled;
5. semantic criteria;
6. suite execution;
7. rubric checks and final host contract.

Consequences:

- A missing required component should be structural, not a simulation check.
- A structural failure can prevent runtime evidence from being produced.
- `passThreshold` applies to rubric points; structural and hard-fail semantic
  obligations remain separate gates in the final contract.
- A reference topology is an author validation asset, not an exact graph used to
  grade learners.

## 3. Requirement mapping

| Requirement form                        | Preferred mechanism                                             |
| --------------------------------------- | --------------------------------------------------------------- |
| Must include/omit a component           | `requires_component` / `forbids_component`                      |
| Must include a broad class of component | `requires_category`                                             |
| Exactly one source                      | `requires_single_source`                                        |
| No disconnected nodes                   | `requires_connected_graph`                                      |
| Direct connection                       | `requires_edge`                                                 |
| Reachable directed path                 | `requires_path`                                                 |
| Minimum instances on one node           | `requires_redundancy`                                           |
| Placement or ordered path               | semantic `placement`                                            |
| All traffic must traverse a guard       | semantic `guardedPath`                                          |
| Independent fan-out                     | semantic `fanout`                                               |
| Store must fit access pattern           | semantic `storageFit`                                           |
| Specific component property             | semantic `componentProperty` tied to a presence rule            |
| Runtime state must occur/not occur      | semantic `stateTransition` / `stateSequence` on a discrete case |
| Numeric performance target              | simulation `RUBRIC_CHECK`                                       |
| Invariant must never break              | scenario invariant plus invariant `RUBRIC_CHECK`                |
| Cost/resource cap                       | `budget` or hard constraints in config                          |
| Unsupported tradeoff                    | explanation or explicit deferred note                           |

Do not use a simulation metric as a proxy for application correctness.

## 4. Structural rule vocabulary

Current structural kinds:

- `requires_component`
- `requires_category`
- `requires_edge`
- `requires_path`
- `max_component_count`
- `requires_redundancy`
- `forbids_component`
- `requires_connected_graph`
- `requires_single_source`
- `min_node_count`
- `max_node_count`

Target resolved component types, never display labels. Service Builder and custom
nodes grade by their serialized backing type.

Avoid overspecification:

- use a category when multiple component types are valid;
- require the lesson-defining path, not one exact graph;
- do not enforce cosmetic nodes;
- avoid both a structural count and an equivalent topology rubric metric unless
  they serve distinct feedback.

## 5. Semantic vocabulary

Current authoring kinds include:

- `componentPresence`
- `componentProperty`
- `placement`
- `guardedPath`
- `fanout`
- `storageFit`
- `forbidUnjustified`
- `stateTransition`
- `stateSequence`

Runtime state scopes in the embedded snapshot include request, delivery, broker,
replication, protocol, idempotency, commit-outcome, lock, and reservation. Do not
invent an exact state label that is not supplied by the target Studio or newer
documentation.

Use runtime state criteria only with discrete evidence. `forbidUnjustified` and
justification behavior may not be available in every hosted learner flow; confirm
the target environment before relying on it.

## 6. Rubric metrics

The visual Studio's advanced verdict selector is capability-controlled.

Common metrics:

- latency: `summary.latency.p50`, `.p90`, `.p95`, `.p99`, `.min`, `.max`, `.mean`;
- throughput/counts: `summary.throughput`, `.totalRequests`,
  `.successfulRequests`, `.failedRequests`, `.rejectedRequests`,
  `.timedOutRequests`, `.connectionResetRequests`;
- errors: `summary.errorRate`;
- worst node: `perNode.maxUtilization`, `perNode.maxErrorRate`,
  `perNode.maxLatencyP99`;
- invariant family: `invariantViolations.count`, `sloBreaches.count`,
  `conservation.unbalanced`, `littlesLaw.violations`;
- capability counters: reservation, lock, retry, and rate-limit aggregates
  exposed by the registry.

Raw row DSL also supports `topology.*` metrics, but the current Question Studio
advanced selector does not expose them. In a visual-Studio walkthrough, translate
topology counts and presence checks into structural rules.

Unknown metric paths resolve to no finite value and fail. Never invent a metric
name. Use the bundled catalog or a metric visibly offered by the target Studio.

## 7. Units and thresholds

- Latency values are milliseconds.
- Throughput is requests per second.
- Utilization and raw error rate are fractions from 0 to 1.
- Studio's friendly Error rate control is a human percent and compiles `1` to
  raw `0.01`.
- Availability NFR text is not automatically a runtime grade; use an implemented
  metric or a supported derived check.
- `passThreshold` is a fraction from 0 to 1, not a percentage.
- Points default to 1 where omitted, but authored walkthroughs should make
  important weights explicit.

Boundary operators matter. “At most 80%” is `<= 0.8`, not `< 0.8` and not
`<= 80`.

## 8. Scenario invariants

An invariant belongs to a suite case and contains:

- stable ID;
- learner-readable description;
- condition expression.

To make it affect grading, add an invariant rubric check such as:

```json
{
  "type": "RUBRIC_CHECK",
  "kind": "invariant",
  "metric": "invariantViolations.count",
  "op": "==",
  "value": 0,
  "points": 2
}
```

An invariant without a corresponding grade may remain visible evidence but does
not necessarily enforce the question's pass contract.

## 9. Config/suite contract

The config row owns:

- question type, entry format, difficulty, domains, concepts, workload category;
- scaffold and locks;
- allowed/forbidden node types and hard caps;
- question-owned workload cases, faults, invariants, seeds, duration, and warmup;
- budget and pass threshold;
- learner visibility and environment capabilities.

The suite must create every metric the rubric asserts. A latency, throughput,
error, capability-counter, or state-transition check with no executable case is
an authoring bug.

## 10. Traceability table

Put a table like this in the Question Studio walkthrough:

| Learner obligation      | Studio location                           | Compiled DSL                                 | Evidence                      |
| ----------------------- | ----------------------------------------- | -------------------------------------------- | ----------------------------- |
| One traffic source      | Grading → Structural                      | `STRUCTURAL_RULE requires_single_source`     | Static topology               |
| Server utilization ≤80% | Scenarios → Invariant + Grading → Verdict | invariant + `invariantViolations.count == 0` | Analytic per-node utilization |

Every prompt requirement must appear once. If two checks reinforce the same
requirement (for example topology plus runtime), say why both are useful.

## 11. Discrimination design

Create at least:

- one passing design;
- one plausible wrong design that fails the intended lesson;
- one anti-gaming design when a shortcut is obvious.

For each, predict the exact failed obligation and actual metric range. Avoid
“should fail” without identifying the evidence.

Multiple variants in one architecture family may all pass. Truly different
families are not yet a first-class OR expression; narrow or split instead of
weakening checks.

## 12. Validation

Without simulator access, validate catalog membership, units, scenario coverage,
cross-file consistency, and good/bad-design discrimination analytically. When the
target Question Studio is available, compile the project and run the passing and
failing designs. Report offline consistency, Studio compilation, and behavioral
simulation as three separate validation levels.
