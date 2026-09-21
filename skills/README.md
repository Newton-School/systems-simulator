# Reusable LLM Skills

This directory is the source of truth for standalone, shareable LLM skills owned
by the systems-simulator repository.

Each skill must be self-contained: a recipient should be able to use its folder
without cloning this repository. Keep implementation-specific knowledge inside
the skill's references, include a clear version boundary, and do not commit
generated ZIP files.

## Available skills

| Skill                     | Purpose                                                                                                   | Entry point                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Simulator Question Author | Converts one system-design question into a learner builder walkthrough and a Question Studio walkthrough. | [`simulator-question-author/SKILL.md`](simulator-question-author/SKILL.md) |

## Package a skill

From the repository root:

```bash
npm run package:simulator-question-author
```

This creates the following ignored build artifacts:

```text
dist/skills/simulator-question-author.zip
dist/skills/simulator-question-author.zip.sha256
```

Share the ZIP through the team-approved Drive, Slack, SharePoint, or other file
channel. The source folder remains canonical; regenerate the archive after every
change instead of editing or committing it.

For another skill, run:

```bash
bash scripts/package-skill.sh <skill-name>
```

## Distribution page

The copy-ready onboarding page is
[`docs/wiki/Simulator-Question-Author-Skill.md`](../docs/wiki/Simulator-Question-Author-Skill.md).
Keep it synchronized with material changes to the package or compatibility date.
