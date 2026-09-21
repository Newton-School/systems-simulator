# {{QUESTION_TITLE}} — Builder Walkthrough ({{LESSON_SUMMARY}})

Build and verify {{ONE_SENTENCE_DESIGN_GOAL}} in the DSDS simulator.

> This is the learner/canonical-design guide. To author the question itself, see
> [Question Studio Walkthrough](question-studio-walkthrough.md).

## The problem

> {{BOUNDED_LEARNER_PROMPT}}

### What this lesson tests

- {{PRIMARY_LESSON}}
- {{SECONDARY_LESSON_IF_ANY}}

### Governing calculation

Show the exact arithmetic, units, rounding, and boundary operator:

```text
{{FORMULA_1}}
{{FORMULA_2}}
{{PASSING_RESULT}}
```

List visible assumptions that make the calculation true.

## Final topology

```text
{{SOURCE}} -> {{COMPONENT}} -> {{COMPONENT}}
```

| Canvas label | Resolved type    | Role in this lesson |
| ------------ | ---------------- | ------------------- |
| {{LABEL}}    | `{{TYPE_TOKEN}}` | {{ROLE}}            |

Call out valid equivalent variants that the grading contract accepts.

---

## Part 1 — Place or inspect the nodes

Give exact palette/library names and counts. For scaffolded questions, describe
the starting design and what the learner is expected to change.

## Part 2 — Configure the workload source

State whether the question injects the workload or the learner configures it.

| Field        | Value           |
| ------------ | --------------- |
| Pattern      | `{{PATTERN}}`   |
| Base traffic | `{{RPS}}` req/s |
| Request mix  | {{MIX}}         |
| Request size | {{SIZE}} bytes  |

## Part 3 — Configure the processing/storage components

For each component, give the exact inspector section and values. Explain derived
capacity from instances, concurrency, and service time. If capacity is an authored
scaffold given, say so explicitly.

## Part 4 — Wire and route the edges

```text
{{EDGE_1}}
{{EDGE_2}}
```

State direction, edge mode, routing strategy, weights/conditions, fan-out, and
whether the question uses connector or network edges.

## Part 5 — Run the scenario

1. {{RUN_STEP}}
2. {{INSPECTION_STEP}}
3. {{VERDICT_STEP}}

State whether the run resolves to **discrete** or **analytic** evaluation and why.
Identify which results are authoritative and which animation is representative.

## Expected results

| Design variant            | Changed variable | Expected metric | Verdict  | Failing/passing check |
| ------------------------- | ---------------- | --------------: | -------- | --------------------- |
| {{BAD_VARIANT}}           | {{CHANGE}}       |      {{METRIC}} | Fail     | `{{CHECK_ID}}`        |
| **{{REFERENCE_VARIANT}}** | {{CHANGE}}       |  **{{METRIC}}** | **Pass** | All required checks   |

Use measured output when available; label calculated predictions that have not
been executed.

## Why the design works

Explain the causal chain from offered load through routing, capacity, queues or
traits to the observed metric. Avoid generic architecture advice.

## Simulator physics and boundaries

- **Modeled directly:** {{DIRECT_EVIDENCE}}
- **Inferred from topology/configuration:** {{INFERRED_EVIDENCE}}
- **Simplified proxy:** {{SIMPLIFICATION}}
- **Not modeled or graded:** {{DEFERRED_CONCERN}}

## Gotchas and anti-gaming checks

- {{COMMON_CONFIGURATION_ERROR}}
- {{PLAUSIBLE_SHORTCUT_AND_WHY_IT_FAILS}}
- {{UNIT_OR_BOUNDARY_ERROR}}

## What the authored question grades

| Learner obligation | Evidence     | Rule/check               |
| ------------------ | ------------ | ------------------------ |
| {{OBLIGATION}}     | {{EVIDENCE}} | `{{DSL_RULE_OR_METRIC}}` |

## Simpler and harder variants

- **Simpler:** {{SIMPLER_VARIANT}}
- **Harder:** {{HARDER_VARIANT}}
