# Simulator Question Author Skill

The Simulator Question Author skill converts one system-design prompt into two
consistent Markdown guides:

1. `builder-walkthrough.md` for learners and solution reviewers;
2. `question-studio-walkthrough.md` for Question Studio authors.

It contains the workflow, templates, simulator feasibility model, component/type
mapping, grading DSL, authoring-stage guide, consistency rules, and a worked
QuickCart example. It also bundles the full Evaluation Authoring Reference Manual
and Test-Case Catalog for exact DSL/row lookup. Recipients do not need access to
the systems-simulator repository.

## Download and share

Repository maintainers generate the standalone archive with:

```bash
npm run package:simulator-question-author
```

The command creates:

```text
dist/skills/simulator-question-author.zip
dist/skills/simulator-question-author.zip.sha256
```

Upload the ZIP and checksum to the team-approved shared location. Do not upload a
hand-edited archive; the canonical source is
[`skills/simulator-question-author/`](../../skills/simulator-question-author/).

> A private GitHub repository, private release, or private wiki still requires
> repository access. For recipients without access, share the generated ZIP via
> Drive, Slack, SharePoint, or another permitted file channel.

## Use with any LLM

Extract the ZIP first if the target LLM cannot inspect ZIP files. Upload or attach
the complete `simulator-question-author` folder, then prompt:

```text
Read SKILL.md and treat it as the controlling workflow. Read the references it
routes to and use the two assets as output templates. Given the system-design
question below, create exactly builder-walkthrough.md and
question-studio-walkthrough.md. If you cannot create files, return two separately
labeled Markdown artifacts with those exact filenames.

System-design question:
<paste the question here>
```

Products may call reusable context a skill, project, knowledge base, custom GPT,
Gem, or system instruction. Native installation differs, but the package's
Markdown instructions are vendor-neutral.

## Compatibility

The embedded simulator and Question Studio behavior was verified on
**2026-09-21**. When those systems change, update the canonical skill references,
run its validation, regenerate the ZIP, and replace the shared artifact.

## Maintainer checklist

- Review Markdown changes through a pull request.
- Validate `skills/simulator-question-author/` with the available skill validator.
- Confirm relative links and templates resolve.
- Run `npm run package:simulator-question-author`.
- Verify the generated ZIP and publish its `.sha256` checksum alongside it.
- Update the compatibility date when behavior was reverified.
