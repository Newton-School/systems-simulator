# 29. Question and grading concepts

Marks: **[P]** primary, **[S]** secondary (fetched or searched), **[K]** established convention, definition or design judgement (no measured figure rests on it), **[D]** derived here from cited definitions or the chapter's own arithmetic, **[?]** needs an owner decision, **[repo]** read from the repository. See [README](README.md).

**[repo]** here means read from the question and grading types (`src/engine/analysis/question.ts`, `rubric.ts`, `structural.ts`, `gradingCriteria.ts`, `evaluationEnvelope.ts`, `src/engine/classroom/`).
How a design question is described, run and graded. Like chapters 26 and 27 this documents the simulator's own contract;
what makes a good question comes from assessment practice (section 8). The numbers a rubric checks are chapter 27;
the decisions a question asks for are chapter 25.

## 1. A question package

A `QuestionPackage` (version 1.0) carries: [repo]

| Part                                      | Content                                                                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| identity                                  | `id`, `title`, `description`, `difficulty` (beginner, intermediate, advanced, expert), `tags`, `estimatedTimeMinutes`, `author`                                                                                            |
| `type`                                    | the grading archetype: `fix`, `build-budget`, `optimize`, `open-build`, `scaling`, `ha-chaos`, `tradeoff`                                                                                                                  |
| `entryFormat`                             | how the learner starts: `blank-canvas`, `requirements-first`, `partial-scaffold`, `broken-scaffold`, `baseline-optimize`, `locked-lab` (orthogonal to `type`)                                                              |
| `prompt`                                  | the statement (markdown), functional requirements, non-functional targets (NFRs), scale parameters                                                                                                                         |
| `scaffold`                                | the starting topology (`empty`, `partial`, `complete`), locked node and edge ids, and for optimize questions a baseline verdict to beat                                                                                    |
| `constraints`                             | allowed or forbidden node types, node-count and worker caps, budget, whether the scaffold may be changed or removed                                                                                                        |
| `structuralRules`                         | graph-shape requirements (section 3)                                                                                                                                                                                       |
| `semanticCriteria`, `justify`             | meaning of the graph and graph-consistent written reasons (sections 4 and 5)                                                                                                                                               |
| `budget`                                  | a cap on `cost`, `nodes` or `edges` (the anti-kitchen-sink axis)                                                                                                                                                           |
| `workloadCategory`, `domains`, `concepts` | what the question is about: `read-heavy`, `write-heavy`, `connection-heavy`, `correctness-heavy`, `batch-heavy`; bottleneck domains (compute, storage, network, resilience, correctness, cost); lesson-level concept slugs |
| `suite`                                   | the grading cases (section 2)                                                                                                                                                                                              |
| `rubric`                                  | scored checks (section 3)                                                                                                                                                                                                  |
| `classroom`                               | settings for concept-first modes (section 7)                                                                                                                                                                               |

**NFR targets** state what the design must achieve in numbers: `latency_p99`, `latency_p50`, `availability`, `error_rate`, `throughput`, each with an operator, a value and a unit (`ms`, `percent`, `req_per_sec`, `nines`). Scale parameters: daily active users, peak requests per second, read/write ratio, storage, retention, growth. [repo]

## 2. The suite: grading cases

A **case** is a set of **overrides** (`global`, `workload`, `faults`, `invariants`, optionally a chaos `experiment`) applied to the learner's topology; it carries no topology of its own because the design under test is the learner's. A suite is a named list of cases; `visibleToStudent` false makes it a hidden contest suite, and `dryRunCase` is a representative case the learner can run. [repo]

**The stated scale is the load.** Where a case sets no rate of its own, the run uses the question's `prompt.scale.peakRps` as the base rate (and `readWriteRatio` as the read/write mix) in place of whatever the learner configured, so a design cannot be graded at a lower load than the problem states; a case's own `workload` override wins. [repo]

Typical cases: the **steady** load, a **peak** or spike, a **fault** (a node or zone down), a **scaled** load. Running several cases catches designs that pass only the easy one. [K]

Grading invariants (for example `perNode.maxUtilization <= 0.8`) are declared in a case, since learners never author them, and checked through an invariant rubric check. [repo]

## 3. Rubric, metrics and structural rules

**Rubric.** A list of `RubricCheck`s `{id, description, kind, metric, op, value, points}` and a `passThreshold` (fraction of points required, default 1). Kinds: `topology` (about the graph), `simulation` (about the run) and `invariant` (about invariants and self-checks). Operators `<`, `<=`, `>`, `>=`, `==`, `!=`. [repo]

**Metric selectors:**

- simulation: dotted paths into the verdict (`summary.errorRate`, `summary.latency.p99`, `perNode.<id>.utilization`) and aggregates `perNode.maxUtilization`, `perNode.maxErrorRate`, `perNode.maxLatencyP99`, `sloBreaches.count`;
- invariant: `invariantViolations.count`, `conservation.unbalanced`, `littlesLaw.violations`;
- topology: `topology.nodeCount`, `edgeCount`, `sourceCount`, `totalWorkers`, `totalReplicas`, and others.

**Honesty rules:** a metric that cannot be measured (an unknown path, or a percentile with no successful samples) is **null and the check fails** with a note; a case whose execution did not complete fails its checks as skipped; a hidden execution failure is itself a check (`__execution__`). [repo]

**Structural rules** are checked on the graph before any simulation and can short-circuit grading: `requires_component`, `requires_category`, `requires_edge` (from type to type, optionally by mode), `requires_path`, `requires_redundancy` (minimum replicas), `max_component_count`, `forbids_component`, `requires_connected_graph`, `requires_single_source`, `min_node_count`, `max_node_count`. [repo]

## 4. Semantic criteria

Checks on what the graph **means**, not just its shape, so a design cannot pass by adding names: `componentPresence`, `componentProperty` (a setting meets a condition), `placement`, `guardedPath` (a protection such as a limiter or breaker sits on the path), `fanout`, `storageFit` (the store suits the access pattern), `forbidUnjustified`, `stateTransition` and `stateSequence` (runtime states that requests actually went through, such as a redelivery or a dead-letter). [repo]

## 5. Justification and anti-gaming

A `justify` prompt asks the learner to defend a decision bound to a real graph element ("why this database type?"). It is graded **structurally**: the answer must reference the node or type actually chosen (graph-consistency, the core defence against stuffing), optionally cite a scale number the question defines, and state a trade-off. [repo] Other anti-gaming axes: the **budget** cap, **forbidden** and **allowed** node types, **node-count** limits, **hidden** suites, and **anti-pattern** detection. [repo]

## 6. The attempt, the grade and the envelope

- **Attempt states:** `DRAFT`, `AUTOSAVED`, `SUBMITTED`, `GRADING`, `GRADED`, `LOCKED`. [repo]
- **Grade (`AttemptGrade`):** `structural`, `constraints`, `semantic`, `justification`, `budget`, `baselineComparison` (optimize questions: the metrics against the baseline), `experiments` (chaos), `classroom`, the full `graded` batch (rich data stays inside the simulator) and a collapsed **`contract`** (booleans) sent to the host across the iframe seam. [repo]
- **Evaluation envelope:** the frozen record of one submission: a snapshot of the exact topology, the per-case verdicts, a bounded **replay digest** (counts and an event-stream checksum), the contract, and a content **checksum** so the grade can be audited and reproduced from the envelope alone. The checksum is an integrity primitive, not a signature. [repo]
- **Determinism:** the same topology, case and seed give the same verdict, so a grade is reproducible (chapter 04).

## 7. Classroom abstractions

The same package can be worked at three levels: **architect** (the full simulator, today's grading), **guided** and **classroom** (concept-first modes). A `classroom` block states the numbers a problem gives about each component in human units (requests per second per copy, dollars per hour, a fixed delay), lecture labels, targets, controlled choices, guided knobs and plain-language checks. In those modes the result includes **feedback-only** checks (shown to the learner, never part of the score or host contract), **issues** for components the mode cannot model (any issue fails the structural gate) and **misconceptions**: teaching feedback matched to a typical mistake, presented in priority order. [repo]

## 8. What makes a good question (assessment practice)

- **Discrimination:** the reference solution passes every case, and each plausible wrong design fails at least one named check. A question that every design passes, or none, teaches nothing. [K]
- **One lesson per check:** each check tied to a concept, so a failure points at a misunderstanding. [K]
- **Numbers from the statement:** targets derived from the stated scale, with the arithmetic in the question's own explanation (chapters 23 and 24). [K]
- **Hidden variation:** a suite case that differs from the dry run (a different rate or fault) so a design tuned to the visible case fails. [K]
- **Misconception coverage:** common errors (no cache on a read-heavy path, a synchronous call to a slow dependency, retries without a budget, a single point of failure) each have a check or a feedback rule. [K]
- **Graph consistency:** written reasons must refer to what is actually built. [repo]

The authored question bank in this repository is validated both ways: every reference solution passes and every deliberately wrong design fails.

## 9. Testable expectations (summary)

- An unmeasurable metric fails its check; it never passes by default.
- A structural-rule failure stops grading before simulation and says which rule.
- The same submission and seed give the same grade and the same envelope checksum; changing the topology changes the checksum.
- A reference solution passes all checks; a design that removes the required protection fails the matching check.
- A justification that names a component not in the graph fails the graph-consistency test.
- A budget or node-count cap is enforced independently of performance.
- Feedback-only classroom checks never change the score.

## 10. Open items

- Cite: published guidance on constructed-response and performance-based assessment; the concept registry of lesson slugs.
- Decided and implemented: `errorBudget` feeds `sloStatus` and the rubric selectors `slo.maxBurnRate` and `slo.budgetsExceeded.count`; `npm run validate:question-bank` reports, per question, how many checks separate the reference from the gamed design.
