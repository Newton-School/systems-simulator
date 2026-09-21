# {{QUESTION_TITLE}} — Question Studio Walkthrough

Use this guide to author the {{QUESTION_TITLE}} question in Question Studio.

> This is the author workflow. For the learner/canonical solution, see
> [Builder Walkthrough](builder-walkthrough.md).

## Finished teaching and grading contract

- **Dominant lesson:** {{PRIMARY_LESSON}}
- **Expected topology family:** {{TOPOLOGY_FAMILY}}
- **Passing evidence:** {{PASS_EVIDENCE}}
- **Plausible wrong design:** {{GAMED_DESIGN}}
- **Feasibility:** {{DIRECT_GUIDED_STRUCTURAL_OR_REFRAMED}}

### Modeling boundaries

| Concern     | Treatment                                        | Reason       |
| ----------- | ------------------------------------------------ | ------------ |
| {{CONCERN}} | Modeled / inferred / explanation-only / deferred | {{BOUNDARY}} |

## Before you start

1. Open Question Studio.
2. Click **New**.
3. Work through **Frame**, **Brief**, **Start**, **Scenarios**, **Grading**,
   **Preview**, and **Export**.
4. Save the editable draft regularly.

---

## Stage 1 — Frame

### Question identity

| Field                 | Value                |
| --------------------- | -------------------- |
| Question title        | `{{QUESTION_TITLE}}` |
| Generated question ID | `{{QUESTION_SLUG}}`  |

### Runtime question setup

| Field                              | Value                     |
| ---------------------------------- | ------------------------- |
| Question type                      | **{{QUESTION_TYPE}}**     |
| Difficulty                         | **{{DIFFICULTY}}**        |
| Learner entry                      | **{{ENTRY_FORMAT}}**      |
| Workload category                  | **{{WORKLOAD_CATEGORY}}** |
| Estimated time                     | `{{MINUTES}}` min         |
| Pass threshold                     | `{{PASS_THRESHOLD}}`      |
| Teaching domains                   | {{DOMAINS}}               |
| Concepts taught                    | {{CONCEPTS}}              |
| Grade a budget                     | {{BUDGET_SETTING}}        |
| Let learners see grading scenarios | {{VISIBILITY}}            |

### Catalogue metadata

Provide the exact short description, author convention, date convention, and tags.

---

## Stage 2 — Brief

### Problem statement

```text
{{FINAL_LEARNER_PROBLEM_STATEMENT}}
```

### Functional requirements

1. {{FR_1}}
2. {{FR_2}}

### Non-functional requirements

| Metric  | Operator |       Value | Unit     | Graded by   |
| ------- | -------- | ----------: | -------- | ----------- |
| {{NFR}} | `{{OP}}` | `{{VALUE}}` | {{UNIT}} | `{{CHECK}}` |

### Scale and additional context

| Field           |             Value |
| --------------- | ----------------: |
| {{SCALE_FIELD}} | `{{SCALE_VALUE}}` |

---

## Stage 3 — Start

Describe the exact blank/scaffolded starting state, then list:

- allowed component labels and resolved type tokens;
- forbidden types;
- node/worker/cost caps;
- scaffold edit/remove permissions;
- locked nodes/edges and baseline verdict when applicable.

Explain why every constraint is necessary and confirm it permits all accepted
solutions.

---

## Stage 4 — Scenarios

### {{SCENARIO_NAME}}

| Field                    | Value                      |
| ------------------------ | -------------------------- |
| What this scenario tests | `{{SCENARIO_DESCRIPTION}}` |
| Fixed seed               | `{{SEED}}`                 |
| Traffic pattern          | **{{PATTERN}}**            |
| Run duration             | `{{DURATION}}` sec         |
| Warmup                   | `{{WARMUP}}` sec           |
| Base traffic             | `{{RPS}}` req/s            |
| Request mix              | {{MIX}}                    |
| Request size             | `{{SIZE}}` bytes           |
| Source node ID           | {{SOURCE_ID_OR_BLANK}}     |

Document custom request types, keyspace, origins, stop conditions, and faults only
when used.

### Invariants

| ID                 | Description               | Condition       |
| ------------------ | ------------------------- | --------------- |
| `{{INVARIANT_ID}}` | {{INVARIANT_DESCRIPTION}} | `{{CONDITION}}` |

State the learner-visible dry-run choice and require **Normalized runtime case**.

---

## Stage 5 — Grading

### Structural grading

| Rule           | Configuration | Purpose |
| -------------- | ------------- | ------- |
| {{RULE_LABEL}} | {{FIELDS}}    | {{WHY}} |

### Semantic grading

| Criterion             | Configuration | Points/hard fail | Purpose |
| --------------------- | ------------- | ---------------- | ------- |
| {{CRITERION_OR_NONE}} | {{FIELDS}}    | {{SCORING}}      | {{WHY}} |

### Runtime metric grading

| Metric     | Comparison     |          Human value | Compiled check                            |
| ---------- | -------------- | -------------------: | ----------------------------------------- |
| {{METRIC}} | {{COMPARISON}} | `{{VALUE}}` {{UNIT}} | `{{RAW_METRIC}} {{RAW_OP}} {{RAW_VALUE}}` |

### Verdict-metric grading

| Metric            | Comparison |       Value |       Points |
| ----------------- | ---------- | ----------: | -----------: |
| `{{METRIC_PATH}}` | `{{OP}}`   | `{{VALUE}}` | `{{POINTS}}` |

### Justification

State whether it is unused, learner guidance only, or a verified grading surface.

---

## Requirement traceability and compiled row plan

| Learner obligation | Studio control      | Compiled row/check                | Evidence     |
| ------------------ | ------------------- | --------------------------------- | ------------ |
| {{OBLIGATION}}     | {{STUDIO_LOCATION}} | `{{ROW_TYPE}} {{KIND_OR_METRIC}}` | {{EVIDENCE}} |

List the expected ordered row inventory:

1. `SIMULATOR_CONFIG: {{QUESTION_SLUG}}`
2. `STRUCTURAL_RULE: {{RULE_ID}}`
3. `SEMANTIC_CRITERION: {{CRITERION_ID}}` (when used)
4. `RUBRIC_CHECK: {{CHECK_ID}}`

Do not invent rows for budgets, constraints, or workloads; those live inside the
config row.

---

## Stage 6 — Preview

Verify title, prompt, requirements, scale, entry format, scaffold, palette,
dry-run visibility, and model-boundary wording.

## Stage 7 — Export

Require **Generated output is current**, then inspect:

1. Question package;
2. Newton rows;
3. Django handoff.

Verify stable ID, scenario, units, rules, points, pass threshold, and row order.
Save the draft and download the Django bundle separately.

---

## Acceptance and discrimination checks

| Candidate design         | Expected evidence      | Expected outcome | Exact failing obligation |
| ------------------------ | ---------------------- | ---------------- | ------------------------ |
| {{GAMED_DESIGN}}         | {{METRIC_OR_RULE}}     | Fail             | `{{CHECK_ID}}`           |
| **{{REFERENCE_DESIGN}}** | **{{METRIC_OR_RULE}}** | **Pass**         | All required checks      |

Add anti-gaming cases for disconnected icons, lowered learner workload, invalid
component variants, or configuration shortcuts when relevant.

## Troubleshooting

- **Wrong generated ID:** align the Frame title and intended slug.
- **Scenario incomplete:** fill required values and keep warmup below duration.
- **Metric never resolves:** verify the metric registry and execution mode.
- **Expected bad design passes:** verify workload pressure and the intended rule.
- **Expected good design cannot be built:** revisit Start-stage constraints and
  hidden configuration assumptions.
