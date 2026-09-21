# Question Studio Authoring Reference

Use this standalone UI snapshot to write the author-facing walkthrough. It was
verified on **2026-09-21**. Newer controls visibly present in the target Studio or
newer user-supplied documentation override this snapshot.

## 1. Entry and files

Question Studio is selected through the app's Question Studio surface. In the web
app, `/question-studio`, `?studio=question`, or
`?surface=question-studio` resolves to that surface.

Header actions:

- **New**
- **Open**
- **Save draft**
- **Preview learner**
- **Django bundle** / **Export**

Draft filenames derive from the question title:

```text
<derived-question-id>.dsds-question-project.json
```

The title also determines the question ID. Choose the final title before building
rules and use a title whose slug is the intended stable ID.

Do not recommend opening an older question package without verifying that it
passes the current project import. Legacy topology rubric metrics or an ID that
does not match the title-derived slug can make an import fail.

## 2. Current visible stages

The visible rail is:

1. **Frame** — lesson identity and setup.
2. **Brief** — learner prompt, FRs, NFRs, scale, and context.
3. **Start** — learner scaffold and constraints.
4. **Scenarios** — workloads, faults, invariants, and dry run.
5. **Grading** — structural, semantic, metric, verdict, and justification rules.
6. **Preview** — compiled learner experience.
7. **Export** — package, Newton rows, and Django handoff.

The verified version has a hidden Discrimination Lab (`prove`) capability that is
not on the visible rail. Do not instruct authors to click it unless it is visibly
available in their target Studio. Keep reference/gamed-design validation in the
walkthrough acceptance section.

## 3. Stage 1 — Frame

### Question identity

- Question title (required)
- Generated question ID (read-only slug)

### Runtime question setup

- question type;
- difficulty;
- learner entry;
- workload category;
- estimated time;
- pass threshold;
- teaching domains;
- concepts taught;
- optional budget;
- grading-scenario visibility.

### Catalogue metadata

- short description;
- author;
- created date;
- tags.

Walkthrough rule: give exact values for every field used, not “fill in suitable
metadata.”

## 4. Stage 2 — Brief

### Problem statement

The field accepts plain text; rendering is generated safely. Write architecture
work, scale, important givens, and model boundaries. Do not tell learners to
write application code.

### Functional requirements

Use one observable architectural obligation per card. Order becomes learner
order.

### Non-functional requirements

Friendly NFR metrics currently include:

- P99 latency;
- P50 latency;
- availability;
- error rate;
- throughput.

An NFR card is learner-facing. It does not by itself guarantee a grading check.
The walkthrough must add the matching implemented metric/invariant in Grading or
label the NFR as contextual.

### Scale and context

Current fields include DAU, peak traffic, read share, stored data, retention,
growth rate, and additional learner context. Scenario values still control the
actual run.

## 5. Stage 3 — Start

### Blank canvas

Leave the Scaffold canvas blank and select a compatible learner entry format.
Configure allowed and forbidden component types so the learner can build every
valid answer without unrelated palette noise.

### Scaffolded question

Use **Create starting topology** / **Open canvas workspace** to build the exact
initial graph. The full component library and inspector are available there.

After returning, configure:

- allowed and forbidden node types;
- maximum nodes;
- maximum total workers;
- maximum runtime cost;
- whether learners may edit/remove scaffold nodes;
- optional locked node/edge IDs;
- optional baseline verdict for optimization.

Entry format and scaffold shape must agree. A blank canvas cannot be a partial or
broken scaffold; repair/optimization formats require non-empty scaffolds.

Do not set a node cap lower than the visible-node canonical answer. If instances
inside one node are an accepted alternative, say so explicitly.

## 6. Stage 4 — Scenarios

Every complete scenario needs:

- description;
- fixed seed;
- traffic pattern;
- run duration;
- warmup shorter than duration;
- base traffic;
- read percentage;
- request size.

Pattern-specific controls appear for burst, spike, sawtooth, and diurnal cases.
Advanced workload controls include:

- source node ID;
- time resolution, timeout, and trace sampling;
- custom request mix and keyspace/metadata;
- origins;
- stop conditions;
- deterministic/probabilistic/conditional faults;
- scenario invariants.

Guidelines:

- leave Source node ID empty when learner node IDs are not fixed;
- customize the request mix when request names, metadata, or keyspace matter;
- use fixed seeds for comparison and grading;
- select a learner-visible dry run deliberately;
- require the footer to show **Normalized runtime case** before proceeding.

## 7. Stage 5 — Grading

### Structural grading

The current editor exposes all structural kinds. Add the minimum rules that
define the lesson and block obvious icon-placement gaming. Common safeguards:

- exactly one source;
- required lesson components;
- lesson-defining edges/paths;
- connected design.

### Semantic grading

Use when component meaning, placement, property, fan-out, storage fit, guarded
path, or supported runtime states matter. Provide exact IDs, points, and
hard-fail behavior where the control exposes them.

### Runtime metric grading

The friendly editor authors one common simulation threshold at a time from:

- P99 latency;
- error rate;
- throughput.

It works in human units and compiles to the correct verdict selector.

### Verdict-metric grading

Use for advanced simulation and invariant metrics. The selector comes from the
engine-owned capability registry. Topology metrics are not currently in this
selector; express those as structural rules.

### Justification prompts

Use only when the target learner environment supports collecting and grading
them. Otherwise place the tradeoff as explanation guidance, not a pass gate.

## 8. Stage 6 — Preview

The walkthrough should give a checklist for:

- title and problem statement;
- FRs, NFRs, and scale;
- learner entry and scaffold summary;
- allowed palette;
- test visibility and dry-run access;
- any modeling disclaimer.

Preview is a contract check, not only copy editing.

## 9. Stage 7 — Export

Export is available only when the compiler reports a ready project. The author
can inspect:

- Question package;
- Newton rows;
- Django handoff.

The guide must tell the author what to verify in each view: stable ID, scenario
conditions, rules, metrics/units, points, pass threshold, and row ordering.

Save the editable draft separately from the deployable Django bundle.

## 10. Readiness and compiler checks

The shell's readiness panel checks broad presence of:

- question identity;
- learner brief;
- scenario;
- grading contract.

The compiler additionally rejects incomplete drafts and invalid combinations.
Use diagnostic navigation links rather than telling authors to edit generated
JSON manually.

## 11. Compatibility rule

If a named control is absent from the target Studio, do not fabricate navigation
or tell the author to hand-edit generated JSON. Record the mismatch, use the
closest visibly supported control only when semantics are equivalent, and mark
the affected step as requiring a package refresh when no equivalent exists.
