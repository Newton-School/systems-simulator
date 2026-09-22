---
name: simulator-question-author
description: 'Convert a system-design question into three openable System Design Simulator JSON files: a Question Studio authoring project, a compiled question package, and a reference solution topology that passes every check. Optionally also emit the learner and author Markdown walkthroughs. Use when mapping an interview or curriculum prompt to simulator components, workloads, test-case rows, grading rules, capacity math, and honest modeling boundaries.'
---

# Simulator Question Author

This is a standalone, vendor-neutral skill. Everything required for its normal
workflow is inside this directory; do not assume access to a source repository,
another skill, Codex, or an OpenAI product.

The embedded capability and Question Studio snapshot was verified on
**2026-09-21**. If the user supplies newer UI, schema, or runtime documentation,
prefer that evidence and identify any compatibility change.

## Output contract

Given one system-design question, create exactly these **three openable JSON
files**, using one title-derived slug `<slug>`:

1. `<slug>.simulator-question-project.json` — opens in **Question Studio** (Open
   project); the editable authoring project. This is exactly the filename Question
   Studio writes on Save draft / Save project.
2. `<slug>.question-package.json` — opens in the **Simulator** (Open question
   package); the compiled, gradeable question a learner attempts.
3. `<slug>.solution-topology.json` — opens in the **Simulator** (Open
   design/topology); a reference solution canvas that passes every check.

`<slug>` is derived from the question title, not fixed — QuickCart is only the
worked example. Generate these for any question.

The exact schema of each file, the cross-file consistency contract, and the
capacity math that makes the solution pass are in
[json-artifact-schemas.md](references/json-artifact-schemas.md). Guaranteed-valid
worked instances of all three are in [`examples/quickcart/`](examples/quickcart/).

Place the files in the user-selected output location. If no writable filesystem is
available, return three separately labeled JSON artifacts with those exact
filenames.

The two Markdown walkthroughs (`builder-walkthrough.md`,
`question-studio-walkthrough.md`) are now **optional**: produce them only when the
user asks for docs, following [the walkthrough steps](#optional-emit-the-markdown-walkthroughs).
Do not create Django assignments, screenshots, or indexes unless explicitly
requested.

## Minimum input

The only required input is the raw system-design question. Use supplied scale,
NFRs, solution hints, difficulty, or simulator details when available. Make
conservative assumptions when values are missing and list them visibly. Ask a
question only when the accepted solution family or dominant lesson cannot be
chosen without materially changing the result.

## Embedded source of truth

Use the bundled references in this order:

1. [Simulator feasibility and physics](references/simulator-feasibility.md)
2. [Component and metric catalog](references/component-and-metric-catalog.md)
3. [Grading DSL and evaluation](references/grading-dsl-and-evaluation.md)
4. [Question Studio authoring](references/question-studio-authoring.md)
5. [JSON artifact schemas](references/json-artifact-schemas.md) — the exact shape of
   the three emitted files, the cross-file contract, and the capacity math.
6. [Walkthrough pair contract](references/walkthrough-pair-contract.md) — only when
   the user also asks for the Markdown docs.

For advanced or exact authoring details, load these deep references only when
the task needs them:

- [Evaluation Authoring Reference Manual](references/evaluation-authoring-reference-manual.md)
  for discriminatory authoring, workload modeling, node sizing, environment
  profiles, validation behavior, and the Django/Newton handoff.
- [Test-Case Catalog](references/test-case-catalog.md) for exact row JSON,
  rule/criterion/check fields, `SIMULATOR_CONFIG`, workload examples, and
  component vocabulary.

The two deep references are bundled snapshots of larger source manuals and may
contain historical guidance or provenance paths. They do not require those
external paths. If they conflict with the first five curated references, this
`SKILL.md`, or controls visible in a newer target Studio, prefer the newer/curated
contract. In particular, do not apply the manuals' 2,000–5,000 RPS discrete-run
guidance to a supported high-rate analytic/fluid capacity question.

The QuickCart files under `examples/quickcart/` are a worked pattern, not a
template to copy blindly.

If an implementation detail is absent from this package, do not invent it.
Choose a supported proxy, make it explanation-only, or label it for validation
against the target simulator version.

## Workflow

### 1. Translate the lesson

- Normalize the prompt into an architecture task rather than application code.
- Extract each functional requirement, NFR, scale fact, constraint, expected
  tradeoff, and interviewer hint.
- Choose one dominant lesson, bottleneck, workload character, and plausible wrong
  design.
- Follow [question-translation-playbook.md](references/question-translation-playbook.md).

### 2. Run the feasibility gate

Classify every source requirement as one of:

- runtime-simulated;
- structurally graded;
- semantically inferred;
- budget-constrained;
- explanation-only;
- deferred.

Choose discrete or analytic execution based on the evidence the lesson needs.
Do not promise application logic, provider behavior, transport physics,
consistency guarantees, or metrics not described in this package.

If the dominant lesson is not honestly representable, explain the nearest
supported reframing instead of writing misleading walkthroughs.

Read the full evaluation manual only when the question depends on advanced node
sizing, environment profiles, cost/budget semantics, contention, runtime state,
or Django/Newton row handoff.

### 3. Create one internal authoring contract

Before drafting the artifacts, establish one shared contract in working notes:

- stable title and title-derived slug;
- question type, entry format, difficulty, domains, concepts, and workload;
- canonical topology and accepted equivalent variants;
- component label-to-type mappings;
- edge modes and routing assumptions;
- resource and capacity derivation;
- workload cases, fixed seeds, durations, request mix, faults, and invariants;
- structural rules, semantic criteria, rubric checks, points, and threshold;
- one passing design, one plausible near miss, and one anti-gaming design;
- unsupported or narrative-only concerns.

All outputs must be derived from this same contract.

### 4. Design grading and compiled row intent

- Bind every gradeable statement to one implemented surface: structural,
  semantic, runtime metric, invariant, or budget.
- Use exactly the four row types documented in the grading reference:
  `SIMULATOR_CONFIG`, `STRUCTURAL_RULE`, `SEMANTIC_CRITERION`, and
  `RUBRIC_CHECK`.
- Prefer structural rules for topology checks. The visual Studio's advanced
  verdict selector exposes simulation/invariant metrics, not topology metrics.
- Keep human UI units distinct from raw DSL units. For example, Studio error
  rate `1%` corresponds to raw `summary.errorRate < 0.01`.
- Ensure every runtime metric has a scenario capable of producing it.
- Consult the full test-case catalog when exact row JSON or less-common fields are
  required; do not copy an example without checking it against the curated
  grading and feasibility references.

### 5. Emit the three JSON files

Follow [json-artifact-schemas.md](references/json-artifact-schemas.md) and start
each file from its template in [`assets/`](assets/):

- `assets/question-studio-project.template.json` → `<slug>.simulator-question-project.json`
- `assets/question-package.template.json` → `<slug>.question-package.json`
- `assets/solution-topology.template.json` → `<slug>.solution-topology.json`

Fill every `{{PLACEHOLDER}}` from the internal authoring contract (step 3). Then:

- **Derive the solution, do not guess it.** Size the service tier with the capacity
  formula in the schema reference (`capacity = workers ÷ serviceTimeSeconds`;
  `utilization = (load ÷ fan-out) ÷ capacity`). Replicate the single service node in
  the template to the number of nodes the budget requires, wire each to the router,
  and confirm the busiest node lands **inside** the invariant target with margin.
- **Keep routers passthrough.** A load balancer never bottlenecks; only service
  nodes appear in `perNode.maxUtilization`.
- **Write the same plain-sentence learner-facing descriptions in both artifacts**:
  each rule/check draft in `<slug>.simulator-question-project.json` and its compiled
  counterpart in `<slug>.question-package.json` must carry identical `description`
  text (e.g. "Serve the full 1,000,000 req/s"), never `metric op value` jargon.
  Question Studio preserves these descriptions into the Django rows; omitting them
  intentionally opts into Studio's generic generated fallback.

### 6. Enforce the cross-file consistency contract

Apply §4 of [json-artifact-schemas.md](references/json-artifact-schemas.md): id,
title, thresholds, allowed node types, rubric checks, declared invariants, and the
workload/seed must agree across all three files, and every `componentType` in the
solution must be an allowed type.

### 7. Validate honestly

Always perform these offline checks:

- all three files parse as JSON with no unresolved `{{PLACEHOLDER}}`;
- #1 has `"artifact": "dsds-question-project"`; #2 has `version`, `suite`, `rubric`;
  #3 has `"version": "2.0.0"` and a non-empty `nodes` array;
- all component tokens, rule kinds, semantic kinds, and metrics occur in the
  bundled catalogs;
- request weights per case sum to a positive total; warmup is below duration;
- raw fraction/percentage conversions are correct (UI `1%` → `0.01`);
- every graded runtime/invariant check has an executable scenario that produces it;
- the solution's **derived** utilization is strictly inside the budget, and one
  plausible near-miss (e.g. one fewer server) would fail for the intended reason.

If the target environment allows, open #2 as the question and #3 as the design, run
**Run & Evaluate**, and confirm a full pass. Report offline validation and any
in-app run as separate levels of evidence. Never claim a design passes merely
because the JSON is internally coherent.

### Optional: emit the Markdown walkthroughs

Only when the user asks for docs, additionally produce `builder-walkthrough.md`
(from `assets/builder-walkthrough.template.md`) and `question-studio-walkthrough.md`
(from `assets/question-studio-walkthrough.template.md`), then reconcile them with
[walkthrough-pair-contract.md](references/walkthrough-pair-contract.md). They must
describe the exact same topology, capacity math, workload, and thresholds as the
three JSON files.

## Completion standard

The task is complete only when:

- the question has one clear teaching objective;
- every graded requirement has a supported evidence source;
- all three JSON files parse and open in their target surface without edits;
- the three files agree per the cross-file consistency contract;
- the solution topology passes every check, and one plausible wrong design fails
  for the intended reason;
- any optional walkthroughs use the same modeling boundaries as the JSON;
- the response names the emitted files and states the validation actually done.
