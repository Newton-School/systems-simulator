# Standalone Simulator Question Author Skill

This folder is a self-contained prompt package for creating three openable System
Design Simulator JSON artifacts from a system-design question:

- `<slug>.simulator-question-project.json`
- `<slug>.question-package.json`
- `<slug>.solution-topology.json`

It can also create the learner and Question Studio Markdown walkthroughs when
they are explicitly requested.

Recipients do not need access to the original simulator or documentation
repository. The package includes its workflow, templates, simulator feasibility
rules, component/metric catalog, grading DSL, Question Studio field guide,
cross-file consistency contract, the full evaluation-authoring and test-case
manuals, and a worked QuickCart example.

## Use with any LLM

Upload or attach the entire folder (or the ZIP that contains it), then use:

```text
Read SKILL.md and treat it as the controlling workflow. Read the references it
routes to and use the JSON assets as output templates. Given the system-design
question below, create the three required JSON artifacts with one title-derived
slug: <slug>.simulator-question-project.json, <slug>.question-package.json, and
<slug>.solution-topology.json. If you cannot create files, return three separately
labeled JSON artifacts with those exact filenames.

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
└── examples/quickcart/                # worked JSON artifacts + optional walkthroughs
```

## Version boundary

The embedded simulator and Question Studio behavior was verified on
**2026-09-22**. When the target application changes, update the embedded
references or provide newer documentation to the LLM. The skill instructs the
LLM to flag unsupported or unverified details instead of inventing them.
