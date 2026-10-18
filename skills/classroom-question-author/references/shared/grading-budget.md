# Grading Budget

A question is solvable only when every graded row is something the source asked
for. Simulator capability is not a reason to grade: grade what the source
(PDF, brief, or pasted prompt) wants tested, plus a small shared set of sanity
rules, and nothing else.

`scripts/grading-budget.mjs` enforces this file. A question outside the budget
fails validation.

## The three tiers

Every structural rule, semantic rule, metric rule, and rubric check belongs to
exactly one tier, recorded in `<slug>.coverage.json`.

| Tier            | Purpose                                               | Allowed rows                                                                                                                                              | Cap |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --: |
| Sanity          | The design is a coherent architecture at all          | `requires_single_source`, `requires_connected_graph`, `requires_path`, `requires_edge`, `requires_redundancy`, `requires_component`, semantic `placement` |   5 |
| Carried forward | An earlier question's headline component still exists | `requires_component`, `requires_category`, semantic `componentPresence`                                                                                   |   4 |
| Core            | One check per source bullet this question adds        | Any row                                                                                                                                                   |   6 |

The whole question may use at most 15 rows. A `componentProperty` rule and the
`componentPresence` parent it requires count as one core check.

## Sanity catalogue

Use only the recipes that apply to components the question introduces or keeps.

| Recipe                      | Row                                                                                  | When                                  |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| One traffic source          | `requires_single_source`                                                             | Always                                |
| Everything connected        | `requires_connected_graph`                                                           | Always                                |
| Load balancer in the middle | `placement` of `load-balancer` between `api-endpoint` and `microservice`, `hardFail` | A load balancer is part of the design |
| Queue has a consumer        | `placement` of `queue` between the producing service and its worker, `hardFail`      | A queue is part of the design         |
| Stream has a consumer       | `placement` of `stream` between the producing services and its consumers, `hardFail` | A stream is part of the design        |

Sanity rows use `points: 1`. They are never the check that catches a near miss.

## Core: trace every check to a source bullet

1. List every bullet of the source's requirements and concepts, verbatim, in
   `coverage.requirements`.
2. Give each bullet one status:
   - `graded`: exactly one core check grades it. Prefer a structural or
     placement rule for shape; use a runtime metric only for behavior.
   - `covered`: an existing sanity, carried-forward, or core check already
     grades it. List those checks; they are not counted again.
   - `explained`: the bullet is context, motivation, or tolerated behavior
     ("processing may become slower"). Give the reason; grade nothing.
3. Pick the smallest metric that proves the bullet. Do not stack an
   "observed at all" check (`queue.accepted >= 1`) under the real one
   (`queue.noLoss == 1`): absent features are unresolved and fail closed.
4. Do not grade stronger guarantees than the source states. "Handle
   replication lag" is `consistency.staleReads == 0`, not bounded
   linearizability.

## Series: carry forward presence, never behavior

When a source says "Everything from the previous question +", the new question
grades only what it adds. Earlier lessons survive as presence rows in the
carried-forward tier (`requires_component api-gateway`), each naming the
question it comes from. Re-grading an earlier lesson's behavior (gateway
authentication, routing coverage, queue loss) is rejected. Skip a carried-forward
row that the new design satisfies trivially, and explain why in coverage.

Set `coverage.series.buildsOn` to the previous question's id.

## NFRs

Add a non-functional requirement only when the source states one. Every NFR
shown to learners must be graded by its paired metric (`error_rate` and
`availability` by `summary.errorRate`, `throughput` by `summary.throughput`,
`latency_p99` / `latency_p50` by the matching latency metric), either as a rubric
check or a metric rule, and traced as an `nfr` requirement. Templates contain an
example NFR and its paired check: remove both or keep both.

## Near misses

Every project stores at least one near miss (`assets.gamedTopologies`) whose
`expectedObligationId` is a core check. A near miss caught only by a sanity rule
does not prove the lesson is graded.

## Studio advisories

The Question Studio compile raises advisories. Each one must be fixed or
explained in `coverage.advisories` (`code`, optional `path`, `reason`). The
audit fails on an unexplained advisory and on an explanation for an advisory the
Studio no longer raises.

Common advisories:

- `domains.supportTier`: the domain is only partly modeled. Tag only the
  dominant domain; `compute` and `storage` are first-class. Explain any guided
  domain you keep.
- `concepts.supportTier`: the concept is guided. Explain what is actually graded.
- `guardedPath.readWriteMix`: the compiler always records a read/write ratio, so
  every `guardedPath` raises this. Explain that the guard covers all traffic, or
  use a different rule.
- `nfr.orphan`: an NFR has no paired check. Fix it; never explain it away.

## Worked example

`examples/food-delivery-series/` turns a five-question PDF series into five
questions, each inside the budget:

| Question                | Sanity | Carried forward | Core | Rows |
| ----------------------- | -----: | --------------: | ---: | ---: |
| 1 Load balancer + queue |      4 |               0 |    4 |    8 |
| 2 API gateway           |      4 |               0 |    5 |    9 |
| 3 Event processing      |      5 |               1 |    2 |    8 |
| 4 Read/write database   |      5 |               2 |    4 |   13 |
| 5 Sharding              |      5 |               2 |    5 |   12 |

Read its coverage files to see `graded`, `covered`, and `explained` bullets side
by side with the PDF wording.
