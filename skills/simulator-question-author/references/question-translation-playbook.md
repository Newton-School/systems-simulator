# Question Translation Playbook

Use this reference to turn a broad system-design prompt into one bounded simulator
lesson before writing either walkthrough.

## 1. Intake

Capture:

- raw prompt and source;
- required user journeys;
- explicit scale, traffic ratios, object sizes, and retention;
- NFRs and failure expectations;
- interviewer hints or expected components;
- target learner level and timebox;
- missing assumptions.

Do not start with a topology. Start with the lesson the prompt is trying to teach.

## 2. Extract atomic statements

Break the prompt into one-idea statements and assign each one a disposition:

| Disposition   | Meaning                                                                              | Typical evidence                       |
| ------------- | ------------------------------------------------------------------------------------ | -------------------------------------- |
| Structural    | The graph must contain or connect something.                                         | Structural rule                        |
| Semantic      | The component, placement, configuration, or runtime state must mean the right thing. | Semantic criterion                     |
| Simulation    | A measurable runtime target must hold under a defined case.                          | Rubric check or invariant              |
| Budget        | Cost, node, edge, or worker usage is bounded.                                        | Budget/constraint                      |
| Explanation   | The learner must reason about a tradeoff that is not safely machine-graded.          | Prompt prose or justification          |
| Narrative     | Useful context with no grading consequence.                                          | Prompt prose                           |
| Deferred      | Unsupported claim that must not be presented as tested.                              | Explicit boundary                      |
| Split trigger | A separate bottleneck or lesson that needs another question.                         | New question, only with user agreement |

Every scale number must either drive the scenario, define a derived calculation,
or be labeled context. Every learner obligation must have a grading surface or be
explicitly explanation-only.

## 3. Choose the dominant lesson

A well-bounded question normally has:

- one dominant path;
- one dominant bottleneck domain;
- one workload character;
- one to three teaching concepts;
- one main reason a plausible wrong design fails.

Common lessons that fit well:

- horizontal capacity and headroom;
- cache placement and store fit;
- synchronous versus asynchronous decoupling;
- fan-out shape;
- redundancy and failure containment;
- rate limiting or contention, with declared model boundaries;
- cost-bounded optimization;
- a runtime state transition already emitted by the engine.

Split or narrow when the prompt combines independent paths such as hot-path
serving, analytics, moderation, search indexing, payments, and background
delivery. If two fully valid architecture families require contradictory grading,
do not broaden checks until they become meaningless. Select one family or ask to
split.

## 4. Normalize into an architecture task

The simulator grades architecture, configuration, and modeled behavior—not
application implementation.

Translate feature language into architectural obligations:

| Source wording         | Simulator wording                                                                |
| ---------------------- | -------------------------------------------------------------------------------- |
| Generate a short URL   | Provide a write path that persists the mapping.                                  |
| Redirect a short URL   | Provide a low-latency read path to the mapping store.                            |
| Send notifications     | Decouple production from delivery and fan out to delivery workers/providers.     |
| Prevent overselling    | Route reservation writes through a modeled reservation/coordination guard.       |
| Survive a node failure | Provide redundant capacity and demonstrate behavior under a deterministic fault. |

Never turn pure business logic into a fake latency or throughput check.

## 5. Choose assignment shape

Choose `questionType` and `entryFormat` independently.

### Question type

| Value          | Use when                                                   |
| -------------- | ---------------------------------------------------------- |
| `open-build`   | Build an architecture from an empty or loose start.        |
| `scaling`      | Saturation, capacity, replicas, or headroom is the lesson. |
| `fix`          | Repair a deliberately broken design.                       |
| `optimize`     | Improve a working baseline.                                |
| `build-budget` | Meet targets under a hard resource/cost cap.               |
| `ha-chaos`     | Redundancy and fault behavior dominate.                    |
| `tradeoff`     | Comparing defensible choices is the lesson.                |

### Entry format

| Value                | Required starting state                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `blank-canvas`       | Empty scaffold.                                                             |
| `requirements-first` | Explicit FR/NFR/scale decomposition; normally benefits from a guided start. |
| `partial-scaffold`   | Non-empty topology learners complete.                                       |
| `broken-scaffold`    | Non-empty flawed topology; pair with `fix`.                                 |
| `baseline-optimize`  | Non-empty baseline plus baseline verdict; pair with `optimize`.             |
| `locked-lab`         | Mostly fixed topology with parameter-focused work.                          |

## 6. Choose metadata

### Domains

- `compute`: queues, workers, concurrency, service capacity, saturation.
- `storage`: store fit, caching, read/write paths.
- `network`: routing, modeled edge effects, protocol/session behavior.
- `resilience`: faults, retries, breakers, failover, redundancy.
- `correctness`: guarded paths and supported coordination/runtime evidence.
- `cost`: budget and resource tradeoffs.

Choose the lesson domains, not every technology named.

### Workload categories

- `read-heavy`
- `write-heavy`
- `connection-heavy`
- `correctness-heavy`
- `batch-heavy`

### Concepts

Use short kebab-case lesson labels such as `read-cache`, `store-fit`,
`horizontal-scaling`, `async-decoupling`, or `capacity-headroom`. Confirm that the
concept fits the support boundaries in the bundled feasibility reference.

## 7. Design the shared contract

Record these decisions before writing:

| Decision           | Required detail                                                                |
| ------------------ | ------------------------------------------------------------------------------ |
| Title/slug         | Title must derive the intended stable ID in Question Studio.                   |
| Canonical topology | Nodes, resolved component types, directed edges, routing modes.                |
| Valid variants     | Component variants or topology variations that should also pass.               |
| Capacity model     | Derived capacity, authored given, instance count, service time, queue/workers. |
| Workload           | Pattern, RPS, duration, warmup, mix, sizes, source resolution, keyspace.       |
| Failure model      | Deterministic faults and their timing, if any.                                 |
| Execution mode     | Analytic or discrete, chosen for the evidence needed.                          |
| Grading            | Structural, semantic, metric, invariant, budget, and explanation mappings.     |
| Reference design   | Smallest or clearest passing design.                                           |
| Gamed design       | Plausible wrong design and the exact obligation that rejects it.               |
| Boundaries         | Simplified, presentational, or deferred claims.                                |

## 8. Real scale versus evaluation scale

Do not automatically compress large numbers. The engine can evaluate high-rate
steady-state capacity questions analytically.

Use real scale when:

- the lesson is throughput, capacity, utilization, error rate, or steady-state
  latency supported by the analytic model;
- absolute event-by-event behavior is not needed.

Use a tractable, proportionally representative scale when:

- the lesson depends on retries, circuit breakers, queue redelivery, faults,
  request timelines, runtime semantic transitions, or other discrete traits;
- a full-scale event run would exceed practical limits.

When compressing:

- preserve request mix and dominant path;
- preserve the utilization relationship or the intended failure threshold;
- state the modeled evaluation scale separately from real-world context;
- prove the good and bad designs still separate.

## 9. Multiple valid solutions

The evaluator grades a constraint set, not equality with a reference graph.

For variants within one family:

- use broad structural rules;
- use categories when a single component type is unnecessarily narrow;
- use semantic `accept` lists where supported;
- grade common runtime outcomes.

For genuinely different end-to-end families, the current engine does not provide
a first-class “family A OR family B” contract. Narrow the lesson or split the
question. Do not simulate alternatives by weakening every rule.

## 10. Final translation test

Before writing the guides, answer:

1. What must the learner understand?
2. What exact wrong design should fail?
3. Which implemented evidence rejects it?
4. What starting state and palette make the intended solution possible?
5. What result should the learner observe?
6. Which real-world concerns remain outside the model?

If any answer is vague, the question contract is not ready.
