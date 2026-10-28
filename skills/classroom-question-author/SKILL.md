---
name: classroom-question-author
description: Create concept-first system-design questions for lectures and in-class activities, including Classroom-mode artifacts, misconception probes, answer keys, and a lecturer sheet. Use when a lecturer, TA, or curriculum author wants students to learn HLD concepts without configuring simulator internals. Use simulator-question-author instead for full-physics Architect questions.
---

# Classroom Question Author

Author from the teaching objective outward. Every student control must serve a
stated objective; every other number is a visible, locked given. Never begin by
copying QuickCart or by tuning engine configuration.

## Outputs

Create one coherent question with a title-derived `<slug>`:

1. `<slug>.simulator-question-project.json` — editable private Studio source.
2. `<slug>.question-package.json` — private grader package.
3. `<slug>.solution-topology.json` — canonical passing `TopologyJSON`.
4. `<slug>.coverage.json` — source → objective → check trace and readiness evidence.
5. `<slug>.lecture-sheet.md` — objectives, givens, napkin model, answer key,
   misconception responses, and teaching steps.

Do not give the private package, coverage map, solution, or probes to learners.

## Read only what the lesson needs

Start with the [question design card](references/question-design-card.md): the
thinking model (decision / given / hidden, six questions, honest routing) that every
later step applies.

Always read:

- [question design card](references/question-design-card.md)
- [classroom principles](references/classroom-principles.md)
- [system-design teaching concepts](references/system-design-concepts.md)
- [generated concept cards](references/concept-cards.md)
- [Classroom checks](references/classroom-checks.md)
- [objective worksheet](references/objective-worksheet.md)
- [shared grading budget](references/shared/grading-budget.md)
- [shared artifact schemas](references/shared/json-artifact-schemas.md)

Read [misconceptions and probes](references/misconceptions-and-probes.md) when
authoring expected wrong answers. Read [lecture scripts](references/lecture-scripts.md)
when the user wants a live demonstration, prediction, or presenter sequence. Read
the [advanced Classroom features](references/advanced-classroom-features.md) for
named choices, fixed latency givens, the Architect bridge, cohort insights, or
Guided controls. Read
the shared [grading DSL](references/shared/grading-dsl-and-evaluation.md) only when
a Classroom check cannot express an essential structural obligation.

## Workflow

### 1. Bound the lesson

Answer the design card's six questions, then complete the objective worksheet
before writing JSON. Extract the source bullets
verbatim, choose one dominant lesson, and state objectives as “the student can…”.
For every proposed control, name its objective. If none exists, make it a given or
remove it.

Resolve the lesson to stable IDs in the system-design concept registry. Treat its
surface tags as curriculum routing, then use the concept's generated `authoring`
recipe for its activity, recommended outcome, card kit, decision kinds, compatible
checks, required givens, and modeling boundary. Confirm actual simulator support
using the card and check catalogs. Do not turn an Architect-tagged concept into a
Classroom lesson merely because a similarly named component card exists.

Choose an honest outcome: Classroom-direct, Classroom-structural, Architect
handoff, or blocked/reframed. Never manufacture runtime evidence for a concept
the Classroom model does not implement.

### 2. Choose the smallest card kit

Use only cards in the generated catalog and exact component tokens from `covers`.
Set an explicit `allowedNodeTypes` list. A capacity-bound allowed card needs an
explicit `capacityRps` given, and every Classroom question needs a stated peak.
Labels may rename cards; labels never create behavior.

Map the author's component names to cards before writing anything: Client →
`api-endpoint`, Load Balancer → `load-balancer`, API Gateway → `api-gateway`, API
Server → `microservice`, Job Worker → `batch-worker`, Message Queue → `queue`, SQL
Database / Database → `relational-db`, NoSQL Database → `nosql-db`, Cache →
`in-memory-cache`, CDN → `cdn`. A requested component with no card (for example Event
Broker, Communication Server, Kafka stream, object storage) cannot run in Classroom
mode. Say so before authoring, name the components affected, and offer to drop or
reframe them; never silently emit an `abstractions: ["architect"]` question from this
skill.

Instance types, vCPU/RAM, service-time distributions, workers, queue slots,
timeouts, retries, traits, edge physics, seeds, and execution profiles are
forbidden student decisions. Use Architect mode when one of them is the lesson.

### 3. Trace objectives to checks

Use the smallest check set that proves the source. Every scored check names one
objective in coverage and uses a learner-facing label. Do not attach performance
checks to structural-only lessons. Stay within the shared grading budget.

Use only check templates listed by the selected concepts' generated authoring
recipes. Reject duplicate evidence and more than two scored checks for one
objective. Integrity/schema validation is internal and must not become another
student obligation.

For each expected wrong answer, write one teaching message and one probe design.
The probe must fail for the intended reason without relying on hidden config.

### 4. Emit artifacts and the lecture sheet

Start from the bundled JSON templates. The plain project and package templates have no
Classroom settings: also fill [classroom-block.template.json](assets/classroom-block.template.json)
and paste it identically as `question.setup.classroom` in the project and as top-level
`classroom` in the package. A question without it passes every other check but the
app opens it only in Architect mode, because no givens exist for its capacity cards.
Keep project/package IDs, labels, checks, and givens identical. The lecture sheet is the primary human output: include the
same givens as the package, the calculation model, a pass/fail answer table, and
what the lecturer should say for each misconception.

Treat supported abstractions and the published learner experience as separate
contracts. `classroom.abstractions` declares which experiences the question can
support; it does not select the Newton launch mode. For a Classroom-capable
question, verify the exported first `SIMULATOR_CONFIG` row contains:

```json
"environmentProfile": { "mode": "ASSIGNMENT", "abstraction": "classroom" }
```

Keep multiple supported abstractions when an Architect bridge is intentional.
Use only `['classroom']` when the question must never open in Guided or Architect.
Do not hand-edit the author-side project or package to compensate for a missing
publication profile; treat that as an export/compiler failure.

### 5. Validate behavior

Run `node scripts/validate-artifacts.mjs <output-directory> <slug>`; it fails when the
`classroom` block is missing or excludes `classroom`. In a simulator
checkout, also run the Studio audit and grade both Architect and Classroom paths.
Verify a plausible near miss and every misconception probe.

After engine changes, re-run every existing Classroom question and re-check its numeric
givens and thresholds: seeded runs now draw from independent random streams (same seed, same
result every time, but different numbers from before), and in-data-centre hops are faster
(same DC 0.25 ms, cross-zone 0.5 ms). Classroom mode compiles designs without faults and
forbids students from choosing latency, retries or timeouts, so the new fault and workload
options (`gray-failure`, `closed`, `trace`) belong to the Architect path
(`simulator-question-author`), not to Classroom questions. Keep capacity margins wide enough
that a near miss and the reference differ by more than sampling error. The bundled QuickCart
example passes on the current engine (13 servers pass, 12 fail headroom). A Classroom question
is not complete when only the reference passes.

## Completion standard

Finish only when the five outputs agree, every source bullet is traced, all
student controls serve objectives, required givens are explicit, the reference
passes Classroom grading, the near miss fails the intended obligation, probes
discriminate their messages, the lecture sheet matches the package, and the
compiled Newton `SIMULATOR_CONFIG` launches Classroom-capable assignments with
the Classroom abstraction.
