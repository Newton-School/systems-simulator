---
name: simulator-question-author
description: 'Turn a system-design prompt into a validated Question Studio project, private grader package, and canonical passing TopologyJSON. Use for simulator curriculum questions, workloads, grading rules, reference designs, and optional author or learner walkthroughs.'
---

# Simulator Question Author

Create one coherent, testable question contract. Do not treat prose, JSON, and the
reference design as separate deliverables.

If the user is a lecturer/TA or asks for a lecture, in-class activity, or
concept-first question, use `classroom-question-author` when it is available.
This skill remains the full-fidelity path for Architect questions and the shared
grading contract underneath both workflows.

The bundled capability snapshot (version `2026-10-26`) targets simulator commit `6aae0ef`
(the engine-realism update) plus the student-assignment privacy boundary introduced in
October 2026. If the target
simulator exposes a newer schema or capability registry, prefer it and report the
compatibility delta.

## Required outputs

Create exactly these author-side files from one title-derived `<slug>`:

1. `<slug>.simulator-question-project.json` — editable Question Studio source.
2. `<slug>.question-package.json` — **private** compiled author/grader contract.
   It contains hidden cases, rules, and rubric data and must not be delivered to a
   learner browser.
3. `<slug>.solution-topology.json` — canonical engine `TopologyJSON` that opens in
   the simulator and passes the private package.
4. `<slug>.coverage.json` — the trace from every source bullet to the check that
   grades it (or why nothing does), the sanity and carried-forward tiers, and the
   explanation for every Studio advisory left in place. Instructors review this
   file, not the JSON rules.

A browser-safe student assignment is a publication projection, not a replacement
for these authoring artifacts. Generate it only when the target product exposes a
stable student-package export. It may contain the prompt, scaffold, constraints,
public justification prompts, and at most the public `dryRunCase`; it must exclude
private suite cases, rubric checks, structural rules, semantic criteria, grader
hints, and answer tokens.

Optional Markdown walkthroughs are emitted only when requested.

## Read only what the question needs

Always read:

- [grading budget](references/grading-budget.md)
- [feasibility and physics](references/simulator-feasibility.md)
- [component and metric catalog](references/component-and-metric-catalog.md)
- [grading and evaluation](references/grading-dsl-and-evaluation.md)
- [artifact schemas](references/json-artifact-schemas.md)
- [engine realism update](references/engine-realism-update.md): new workload patterns,
  the `gray-failure` fault, SLO selectors, and behaviour changes to re-check

Read [Question Studio authoring](references/question-studio-authoring.md) for UI
instructions. Read the deep [evaluation manual](references/evaluation-authoring-reference-manual.md)
only for advanced traits, environment profiles, costs, faults/experiments,
consistency, custom builders, or Newton/Django handoff. Read the
[test-case catalog](references/test-case-catalog.md) only for exact low-level row
or state-transition fields. Read the [walkthrough contract](references/walkthrough-pair-contract.md)
only when walkthroughs are requested. Read [archetype patterns](references/archetype-patterns.md)
when selecting a starting structure; choose the closest archetype and remove
irrelevant parts rather than cloning the QuickCart example.
Read [Classroom authoring](references/classroom-authoring.md) whenever the user
wants a lecture/classroom question or when deciding whether Classroom mode is
appropriate.

The curated references and bundled capability evidence must agree. When they do
not, use the newer engine-derived evidence, avoid inventing fields, and report the
mismatch.

## Workflow

### 1. Bound the lesson

Extract functional requirements, NFRs, scale, failure expectations, constraints,
and hints. Choose one dominant lesson, one workload character, one plausible wrong
design, and the smallest accepted solution family. Ask only when choosing the
solution family would materially change the assignment.

Classify each requirement as structural, semantic, runtime, invariant, budget,
explanation-only, or deferred. Do not grade business logic or provider guarantees
with unrelated runtime metrics.

Copy every source bullet (requirements and expected concepts) verbatim into the
coverage map before designing any check. The source decides what is tested; the
simulator's capabilities only decide how. When the source is one question in a
series ("Everything from Q2 +"), grade only what this question adds.

### 2. Select honest evidence

Use analytic/fluid execution for high-rate steady-state capacity, throughput,
utilization, error rate, and supported latency approximations. Use discrete
execution for request ordering, queues, retries, breakers, faults, sessions,
protocol state, and trait counters. Feature metrics are generally unresolved when
the relevant feature is absent; use that fail-closed behavior deliberately.

Narrow exactly-once, global ordering, provider semantics, and multi-key
transactional guarantees to supported proxies. Bounded single-key register
linearizability is supported only when every operation is checked; pair zero
violations with `consistency.linearizableVerified == 1` or
`consistency.linearizabilityOpsNotChecked == 0`.

### 3. Establish one authoring contract

Record:

- title, slug, type, entry format, difficulty, domains, concepts, and workload;
- canonical topology and accepted variants, including component-family matching;
- scaffold/locks, constraints, and `builderPolicy`;
- edge model, routing, resources, service time, and derived capacity;
- private cases, one intentionally public dry run, seeds, faults/experiments, and invariants;
- structural rules, semantic criteria, rubric checks, points, and threshold;
- a passing design, a near miss, an anti-gaming design, and unsupported concerns.

Generic component requirements are directional: `load-balancer` accepts its L4
and L7 subtypes; `load-balancer-l7` accepts only L7. Apply the same relation to
allowlists, structural/semantic checks, and solution validation.

### 4. Design grading

Stay inside the [grading budget](references/grading-budget.md): at most 5 sanity
rows, 4 carried-forward presence rows, 6 core checks, and 15 rows in total.

- **Sanity:** one traffic source, a connected graph, and the shape rules for
  components the design uses (load balancer between traffic and servers, a queue
  or stream feeding its consumer).
- **Carried forward:** presence of an earlier question's headline component,
  never its behavior.
- **Core:** one check per source bullet this question adds. Mark context and
  tolerated behavior as `explained` instead of grading it.
- **NFRs:** only when the source states one, and always with the paired check.
  Templates carry an example NFR with its check; keep both or remove both.
- **Near misses:** at least one, each caught by a core check.

Use the four Newton/Django row types only: `SIMULATOR_CONFIG`,
`STRUCTURAL_RULE`, `SEMANTIC_CRITERION`, and `RUBRIC_CHECK`. Builder policy,
constraints, suite data, and environment metadata live inside the config row.

Prefer structural rules for component-specific presence, counts, paths, and
placement. Studio also exposes fixed topology totals (`topology.totalNodes`,
`topology.totalEdges`, `topology.totalWorkers`) as rubric metrics. Bind every
runtime check to a case that produces the metric. Preserve human UI units versus
raw package units (`1%` becomes `0.01`).

For faults or chaos experiments, target learner-resolvable component/location IDs,
use fixed timing and seeds, and make the experiment verdict an explicit gate.

### 5. Emit from the bundled templates

Use:

- `assets/question-studio-project.template.json`
- `assets/question-package.template.json`
- `assets/solution-topology.template.json`
- `assets/coverage.template.json`

The solution template is canonical engine `TopologyJSON`, not a React Flow canvas
file. Do not emit renderer types, handles, dimensions, or `data.rendererType`.

Derive capacity from the actual serialized node fields. If instance resources are
present, use the simulator's instance/execution-profile derivation; otherwise use
authored capacity only when the question intentionally supplies it. Do not assume
all routers or gateways are infinite: confirm the selected component's current
spec before excluding it from bottleneck analysis.

Set `prompt.scale.readWriteRatio` to the read share of the private workload (0
for write-only work). Learners see it in the brief, and when it is omitted the
Studio compiler fills it from the scenario default of 80.

Use identical learner-facing descriptions and stable IDs in project and compiled
package. Keep private cases out of the public dry run. A dry run should teach the
surface without revealing hidden thresholds, faults, or rubric structure.

**Classroom mode.** Apply the prompt-general decision process in
[Classroom authoring](references/classroom-authoring.md); do not start from the
QuickCart topology. Students place registered concept cards and decide only
visible structure and copy counts; the grader rebuilds every node from the
question's givens. Classroom never invents numbers. Decide for every question:

- For a lecture-style question, add `question.setup.classroom` to the project with
  the numbers the prompt states as `givens` (e.g. `"microservice": { "capacityRps":
100000 }`), keyed by component type, plus `targets` and, when the authored checks
  read engine details, plain-language `checks`. The compiler copies the block into
  the package unchanged. Use only fields and check templates listed in the
  snapshot's `classroom` section.
- Give every Classroom question an explicit `allowedNodeTypes` list. Every entry
  must map to a card in the snapshot. State `capacityRps` for every capacity-bound
  allowed card, and state peak traffic.
- If passing depends on an engine setting (instance sizing is the lesson), a
  component with no concept card, or behavior a card deliberately hides, set
  `"abstractions": ["architect"]` or grade only the supported structural lesson.
- Design checks (e.g. "single point of failure") are hidden in Classroom mode. Set
  `"designChecks": true` in the block only when the lesson is redundancy.

Do not tell learners to configure capacity for a lecture-style question; state it
as a given. `examples/quickcart` demonstrates capacity arithmetic only, not a
universal Classroom topology.

### 6. Validate

Always run the bundled standalone validator:

```bash
node scripts/validate-artifacts.mjs <output-directory> <slug>
```

In a simulator checkout, also run:

```bash
npm run audit:simulator-question -- <output-directory> <slug>
npm run sim -- validate <slug>.solution-topology.json
npm run sim -- grade <slug>.question-package.json <slug>.solution-topology.json
# When Classroom mode is allowed, the reference must also pass there:
npm run sim -- grade <slug>.question-package.json <slug>.solution-topology.json --abstraction classroom
```

The audit compiles the project exactly as the Question Studio does, requires
every Studio advisory to be fixed or explained in coverage, grades the reference
and every near miss, and re-runs the grading budget. A question that fails the
audit is not finished, even when it grades correctly.

Then grade the near miss and confirm it fails the intended obligation. When the
Question Studio is available, open the project in AUTHOR mode, compile it, and
compare the exported package. Assignment mode is not a verification environment:
topology files, raw JSON, terminal/settings, private checks, and repeated dry runs
may be unavailable by design.

Report these evidence levels separately: JSON/cross-file validation, schema and
compiler validation, headless behavioral grading, and in-app author verification.
Never claim a pass from arithmetic or JSON coherence alone.

## Completion standard

Finish only when all four files parse and open, the question is inside the
grading budget with every source bullet traced, every Studio advisory is fixed or
explained, the Studio project compiles to the supplied private package, the canonical solution passes every gate, the near
miss fails for the intended reason, family-aware constraints accept every solution
component, private grading data is excluded from the student projection/public dry
run, and any walkthrough matches the artifacts exactly.
