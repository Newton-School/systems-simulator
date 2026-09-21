# Standalone Simulator Question Author Skill

This folder is a self-contained prompt package for creating two DSDS documents
from a system-design question:

- `builder-walkthrough.md`
- `question-studio-walkthrough.md`

Recipients do not need access to the original simulator or documentation
repository. The package includes its workflow, templates, simulator feasibility
rules, component/metric catalog, grading DSL, Question Studio field guide, pair
consistency contract, and a worked QuickCart example.

## Use with any LLM

Upload or attach the entire folder (or the ZIP that contains it), then use:

```text
Read SKILL.md and treat it as the controlling workflow. Read the references it
routes to and use the two assets as output templates. Given the system-design
question below, create exactly builder-walkthrough.md and
question-studio-walkthrough.md. If you cannot create files, return two separately
labeled Markdown artifacts with those exact filenames.

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
├── references/                        # self-contained domain knowledge
└── examples/quickcart/                # worked two-document example
```

## Version boundary

The embedded simulator and Question Studio behavior was verified on
**2026-09-21**. When the target application changes, update the embedded
references or provide newer documentation to the LLM. The skill instructs the
LLM to flag unsupported or unverified details instead of inventing them.
