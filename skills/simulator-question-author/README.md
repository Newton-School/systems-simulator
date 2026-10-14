# Standalone Simulator Question Author Skill

This folder is a self-contained skill for creating and validating four private,
author-side System Design Simulator artifacts from a system-design question:

- `<slug>.simulator-question-project.json`
- `<slug>.question-package.json`
- `<slug>.solution-topology.json`
- `<slug>.coverage.json` (source bullet to check trace and grading budget)

Every question stays inside a grading budget: a few shared sanity rules plus at
most one check per source bullet. See `references/grading-budget.md`.

It can also create the learner and Question Studio Markdown walkthroughs when
they are explicitly requested.

The compiled question package is a private grader contract, not a learner payload.
A browser-safe student package must be derived by the product publication layer
and must omit cases, rubric checks, grading rules, hints, and answer material.

Recipients do not need access to the original repository for basic artifact
validation. The package includes a standalone validator, generated capability
snapshot, templates, feasibility rules, grading DSL, field guides, deep manuals,
and a worked QuickCart example.

## Use with any LLM

Upload or attach the entire folder (or the ZIP that contains it), then use:

```text
Read SKILL.md and treat it as the controlling workflow. Read the references it
routes to and use the JSON assets as output templates. Given the system-design
question below, create the four required JSON artifacts with one title-derived
slug: <slug>.simulator-question-project.json, <slug>.question-package.json,
<slug>.solution-topology.json, and <slug>.coverage.json. Grade only what the
question asks for, within references/grading-budget.md. If you cannot create
files, return four separately labeled JSON artifacts with those exact filenames.

System-design question:
<paste the question here>
```

If the product supports reusable projects, knowledge bases, custom GPTs, Gems,
skills, or system instructions, add this entire directory to that feature. Native
installation is product-specific; the Markdown workflow itself is not.

## Package layout

```text
simulator-question-author/
├── SKILL.md
├── README.md
├── agents/openai.yaml                 # optional OpenAI/Codex discovery metadata
├── assets/                            # output templates
├── references/                        # curated guidance + full deep-reference manuals
├── scripts/validate-artifacts.mjs     # standalone cross-file/privacy/budget validator
├── scripts/grading-budget.mjs         # grading budget rules (used by the validator)
├── examples/quickcart/                # worked JSON artifacts + optional walkthroughs
└── examples/food-delivery-series/     # five-question PDF series inside the budget
```

## Version boundary

The embedded snapshot targets simulator commit `c33c557` plus the October 2026
student-assignment privacy boundary. In a simulator checkout, run
`npm run check:simulator-question-author-snapshot` and
`npm run validate:simulator-question-author-skill` before packaging. Audit any
generated question with `npm run audit:simulator-question -- <directory> <slug>`. When the
target changes, regenerate the snapshot and report compatibility differences
instead of inventing fields.
