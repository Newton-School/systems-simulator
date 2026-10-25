# Feature Visibility Matrix — Spec

Status: proposed (not implemented). Third in a set:

| Spec                                               | Question it answers                                                                  | Who decides                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| [feature-flags-spec.md](feature-flags-spec.md)     | Is this feature released in this build?                                              | Engineers                      |
| [question-policy-spec.md](question-policy-spec.md) | For _this question_, what is editable / graded / revealed?                           | Question author                |
| **this spec**                                      | For _this feature_, in _this mode and environment_, is it hidden, visible or usable? | Product, with scoped overrides |

This spec is the spine the other two plug into. It replaces a growing pile of one-off gates with a
single table: **feature × context → hidden / visible / enabled**.

## 1. The problem, with the example

Take the single-point-of-failure (SPOF) check. Today it is controlled in at least four unrelated ways:

| Gate                                                                                | Where                                               |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Hidden in Classroom unless the question opts in (`classroom.designChecks === true`) | `hooks/useClassroom.ts` → `useDesignChecksHidden()` |
| Node badges also need the user's `displaySettings.showSpofBadges`                   | `components/nodes/BaseNode.tsx:130`                 |
| Results list is emptied when hidden                                                 | `components/simulation/ResultsTray.tsx:4155`        |
| Author toggle for it                                                                | `components/authoring/QuestionSetupEditor.tsx`      |

Nothing says "SPOF check is a feature; here is where it appears (node badge, results tray, grading
check); here is where it is on or off". Answering "can SPOF be turned off in Classroom mode?"
means reading four files. The same sprawl exists for everything else a mode changes:

- `EnvironmentCapabilities` booleans (terminal, topology files/JSON, settings, annotate, edge model, resource editing, execution profile…)
- `EnvironmentVisibility` (prompt, scaffold source nodes, suite details, live metrics, rubric checks)
- `experienceEnvelope.ts` (sidebar tabs, `canvasLocked`, button labels, chosen from tags/format)
- `displaySettings` (user prefs, incl. the `simpleShell` beta)
- Classroom's own lock-down (`controls`, `designChecks`, `abstractions`)

## 2. Goals and non-goals

Goals

- A feature registry: every toggleable capability has one id, one description, one list of surfaces.
- A matrix from context to state, reviewable as a single table and enforced as one function.
- Explicit rules for who may override a feature's state (question, host, user) and in which direction.
- Absent configuration reproduces today's behaviour exactly.
- Authoring and docs are generated from the registry, so they cannot drift.

Non-goals

- Per-student or percentage targeting.
- A visual rewrite of any surface; only the gating moves.
- Security enforcement. Hiding is pedagogy; the grader and host remain the authority (section 7).

## 3. Vocabulary

**Feature**: a named capability a user can see or use. Examples: `spofCheck`, `terminal`,
`topologyFiles`, `topologyJson`, `edgeProperties`, `resourceEditing`, `executionProfile`,
`liveMetrics`, `rubricChecks`, `suiteDetails`, `annotations`, `blueprintsTab`, `labsTab`,
`scenariosTab`, `libraryTab`, `settingsModal`, `testRuns`, `costMeter`, `budgetMeter`,
`metricLenses`, `simpleShell`.

**Surface**: a place a feature renders or acts. One feature can appear on several surfaces
(`spofCheck` → `node-badge`, `results-tray`, `grading`). Surfaces: `canvas`, `node`, `edge`,
`properties-panel`, `palette`, `sidebar`, `results-tray`, `question-card`, `terminal`, `settings`,
`toolbar`, `grading`, `export`.

**State** (three values, ordered):

| State     | Meaning                                                                    |
| --------- | -------------------------------------------------------------------------- |
| `hidden`  | Not rendered, not reachable, not evaluated where the feature is evaluative |
| `visible` | Rendered read-only; shows values but cannot be used or changed             |
| `enabled` | Fully usable                                                               |

The order is `hidden < visible < enabled`. "Tighten" means moving left.

**Context**: the environment the app is running in. Axes that exist today:

| Axis          | Values                                        | Source today                                                         |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| `mode`        | `AUTHOR`, `ASSIGNMENT`, `PRACTICE`            | `EnvironmentProfile.mode` (host)                                     |
| `abstraction` | `architect`, `classroom`                      | `EnvironmentProfile.abstraction` / question `classroom.abstractions` |
| `experience`  | `SANDBOX`, `ASSIGNMENT`, `INTERVIEW`, `LAB`   | `experienceEnvelope.ts` (derived from tags/format)                   |
| `entryFormat` | per `QuestionEntryFormat` (e.g. `locked-lab`) | `question.ts`                                                        |
| `host`        | standalone, Newton-hosted iframe              | `questionHostMessaging.ts` / `appSurface.ts`                         |
| `surface`     | `simulator`, `question-studio`                | `appSurface.ts`                                                      |
| `presenter`   | on/off (projector layout)                     | profile / settings                                                   |

Adding an axis later (for example `cohort`) must not change existing rows.

## 4. Data model

### 4.1 Feature registry

`src/engine/analysis/featureRegistry.ts` (pure, no React, so CLI/export/renderer share it):

```ts
export type FeatureState = 'hidden' | 'visible' | 'enabled'

export interface FeatureDef {
  id: FeatureId
  label: string
  description: string
  surfaces: Surface[]
  /** States this feature can legally take. Some are meaningless as 'visible'. */
  states: FeatureState[]
  /** State when no matrix row or override says otherwise (today's behaviour). */
  default: FeatureState
  /** Who may move it, and how far. */
  overridable: {
    byQuestion: 'none' | 'tighten' | 'any'
    byHost: 'none' | 'tighten' | 'any'
    byUser: 'none' | 'tighten' | 'any'
  }
  /** Features that must be at least this state for this one to work. */
  requires?: Partial<Record<FeatureId, FeatureState>>
  /** Whether this feature also affects the grader's verdict (see 7). */
  affectsGrading?: boolean
}
```

### 4.2 The matrix

A table of rows, each a context pattern and a set of feature states. Later/more specific rows win;
unspecified axes are wildcards.

```ts
export interface MatrixRow {
  when: Partial<{
    mode: Mode[]
    abstraction: Abstraction[]
    experience: Experience[]
    entryFormat: QuestionEntryFormat[]
    host: Host[]
    surface: AppSurface[]
    presenter: boolean
  }>
  set: Partial<Record<FeatureId, FeatureState>>
}
```

Seed, illustrating the SPOF example and values read from the current presets:

```ts
const MATRIX: MatrixRow[] = [
  {
    when: {},
    set: {
      spofCheck: 'enabled',
      terminal: 'enabled',
      topologyFiles: 'enabled' /* … all defaults */
    }
  },
  {
    when: { mode: ['ASSIGNMENT'] },
    set: {
      terminal: 'hidden',
      topologyFiles: 'hidden',
      topologyJson: 'hidden',
      settingsModal: 'hidden',
      annotations: 'hidden',
      edgeProperties: 'hidden',
      suiteDetails: 'hidden',
      resourceEditing: 'visible'
    }
  },
  {
    when: { abstraction: ['classroom'] },
    set: { spofCheck: 'hidden', terminal: 'hidden', edgeProperties: 'hidden' }
  },
  { when: { abstraction: ['classroom'], presenter: true }, set: { settingsModal: 'hidden' } },
  {
    when: { experience: ['LAB'] },
    set: { blueprintsTab: 'hidden', scenariosTab: 'hidden', libraryTab: 'hidden' }
  }
]
```

Reading it: `spofCheck` is `enabled` everywhere by default and `hidden` in Classroom, which matches
today's `useDesignChecksHidden()`. The Assignment row mirrors `ASSIGNMENT_ENVIRONMENT_PROFILE`
(terminal, files, JSON, settings, annotate off; edge editing off). The PRACTICE and remaining rows
are filled during the audit in step 1 of the rollout; this table is the contract, not a guess.

The matrix is data, so it renders directly into a docs table (section 9) and can be diffed in PRs.

### 4.3 Overrides

```ts
export interface FeatureOverrides {
  question?: Partial<Record<FeatureId, FeatureState>> // question.policy.features
  host?: Partial<Record<FeatureId, FeatureState>> // host launch payload
  user?: Partial<Record<FeatureId, FeatureState>> // displaySettings / dev panel
}
```

In a question package this extends the policy block from the question-policy spec:

```jsonc
"policy": {
  "version": 1,
  "features": { "spofCheck": "enabled", "liveMetrics": "hidden" }
}
```

This is how a redundancy lesson turns SPOF **on** in Classroom: the registry must declare
`spofCheck.overridable.byQuestion = 'any'` for that to be legal. Features that the product wants
fixed per mode (for example `terminal` in ASSIGNMENT) declare `byQuestion: 'tighten'`.

## 4A. Customisation: everything is data, and easy to change

The point of the matrix is that changing what appears where is a data edit, never a code hunt.
Full customisation means every layer below is configurable; easy means each has one obvious place
and a UI.

### 4A.1 Named environments (profiles)

An **environment** is a named, reusable bundle of matrix rows and defaults. Built-ins ship as data
(`assignment`, `practice`, `author`, `classroom`, `lab`, `interview`, `presenter`); custom ones are
the same shape:

```jsonc
{
  "id": "midterm-exam",
  "label": "Midterm exam",
  "extends": "assignment", // inherit, then change only the differences
  "set": {
    "liveMetrics": "hidden",
    "rubricChecks": "hidden",
    "spofCheck": "hidden",
    "testRuns": "enabled"
  },
  "values": { "maxTestRuns": 3 } // typed quantities live alongside states
}
```

- `extends` is single-inheritance with a cycle check; the child only lists differences.
- A question or a host launch selects an environment by id (`policy.environment` / host payload);
  per-feature overrides (4.3) still apply on top.
- Environments are validated against the registry (unknown feature, illegal state, or an
  override the registry forbids is an error, with the file and line).

### 4A.2 Where the data lives

| Layer                                                          | Stored in                                                        | Edited by                | Needs a release?               |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------ | ------------------------------ |
| Registry (what features exist, legal states, who may override) | `featureRegistry.ts`                                             | Engineers                | Yes (adding a feature is code) |
| Built-in environments and matrix rows                          | `config/environments/*.json`                                     | Product/engineers via PR | Yes, but no code change        |
| Custom environments                                            | Workspace file / host-supplied JSON (`environments.custom.json`) | Instructors, admins      | No                             |
| Per-question overrides                                         | `question.policy`                                                | Question authors         | No                             |
| User preferences                                               | `displaySettings`                                                | End user                 | No                             |

Adding a feature is one registry entry plus wrapping its surface in `<Feature id>`; it then shows
up automatically in the Studio, the dev panel, the generated matrix doc and the skills snapshot.
Changing _where_ an existing feature appears is a one-line matrix edit.

### 4A.3 Editing UIs (no JSON required)

- **Environment editor** (Question Studio and Settings > Environments, which already exists as
  `EnvironmentsTab.tsx`): a grid of features × states per environment, with "inherited from
  `assignment`" shown greyed and a reset-to-inherited control per cell.
- **Matrix view**: features as rows, contexts as columns, click a cell to change it, with a diff
  badge against the built-in value. This is the same table the generator writes to docs.
- **Question Features panel** (section 8): per-feature override for one question.
- **Presets** for common intents ("Exam", "Guided lab", "Open sandbox", "Presenting"), each just a
  named environment the user can duplicate and tweak.
- Every editor shows the **effective** result and which layer won, and a **live preview** that
  renders the real UI for the chosen environment.

### 4A.4 Import, export, share

- Export/import an environment or a question's policy as JSON; schema-validated on import with
  human-readable errors (path, reason, suggested fix).
- Environments embedded in a question package travel with it; shared ones are referenced by id and
  version, and a missing id falls back to the question's declared `fallbackEnvironment` rather than
  failing open.
- CLI parity: `simulator env list | show <id> | validate <file> | diff <a> <b> | resolve --question q.json --env midterm-exam`,
  so authoring pipelines and the grader can reproduce exactly what a student saw.

### 4A.5 Safety rails that keep customisation safe

- Customising never needs code, and cannot break the registry's `overridable` rules or the
  AUTHOR-in-Studio guarantee.
- Every custom environment is versioned (`version`, `updatedAt`); a submission records the
  environment id and version plus the resolved feature set, so changing an environment later
  cannot rewrite what a past verdict meant.
- A custom environment that would make an existing question unsatisfiable (hides a feature a graded
  check depends on) shows a readiness warning in the Studio before it can be applied.

## 5. Resolution

```
1. registry default
2. matrix rows, in order (more specific context wins; later row wins ties)
3. question override     (honoured per overridable.byQuestion)
4. host override         (honoured per overridable.byHost)
5. user override         (honoured per overridable.byUser)
6. requires closure      (a feature below what it requires drops to hidden)
=  effective state
```

Override legality, per `overridable` value:

- `none`: ignored (and a validation warning where authored).
- `tighten`: applied only if it moves the state left; a loosening request is ignored.
- `any`: applied as given, then clamped to `states`.

Hard rules regardless of registry:

- `AUTHOR` mode on the `question-studio` surface is never tightened by question or user overrides,
  so authors can always inspect what they are restricting.
- The host may always tighten. Only features marked `byHost: 'any'` may be loosened by the host.
- A student-facing loosening of a safety feature (`topologyFiles`, `topologyJson`, `terminal` in a
  graded context) is never allowed from a question, since a question is attacker-controlled content
  in a graded setting.

### API

```ts
resolveFeatures(context, overrides): ResolvedFeatures
featureState(resolved, id): FeatureState
isUsable(resolved, id): boolean      // state === 'enabled'
isShown(resolved, id): boolean       // state !== 'hidden'
```

A small React layer: `useFeature(id)` returns the state; `<Feature id="spofCheck" surface="node-badge">`
renders children only when shown and passes `disabled` when `visible`. Components never read mode,
abstraction or profile booleans for gating once migrated.

## 6. Mapping what exists today

| Today                                                                                                               | Becomes                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `EnvironmentCapabilities.canUseTerminal / canUseTopologyFiles / canViewTopologyJson / canUseSettings / canAnnotate` | features `terminal`, `topologyFiles`, `topologyJson`, `settingsModal`, `annotations`                                          |
| `canEditEdges`, `edgeModel`                                                                                         | `edgeProperties` (`hidden` = connector, `visible` = network read-only, `enabled` = editable)                                  |
| `canEditResources`, `canEditExecutionProfile`                                                                       | `resourceEditing`, `executionProfile`                                                                                         |
| `canTriggerTestRuns`, `maxTestRuns`                                                                                 | feature `testRuns`; the _number_ stays a value in question policy / host (a feature is a state, not a quantity)               |
| `EnvironmentVisibility.*`                                                                                           | `questionPrompt`, `scaffoldSourceNodes`, `suiteDetails`, `liveMetrics`, `rubricChecks` (timing stays `RubricCheckVisibility`) |
| `experienceEnvelope.allowedTabs`, `canvasLocked`                                                                    | `questionTab`, `libraryTab`, `blueprintsTab`, `labsTab`, `scenariosTab`; `canvasLocked` = canvas `visible`                    |
| `useDesignChecksHidden()`, `classroom.designChecks`, `displaySettings.showSpofBadges`                               | `spofCheck` (+ other design checks) with question and user overrides                                                          |
| `displaySettings.simpleShell`                                                                                       | feature `simpleShell`, `byUser: 'any'`                                                                                        |
| `editPaletteList`, `resourceBudget`, `costBudget`                                                                   | stay as typed values on the profile; the _display_ of budgets becomes `costMeter`, `budgetMeter` features                     |

`EnvironmentProfile` is kept as the host-facing input type. `resolveFeatures` derives from it, so
existing hosts and the Newton integration don't change.

## 7. Enforcement and grading

Visibility is not authorisation:

- **Evaluative features** (`affectsGrading: true`, e.g. `spofCheck`, `rubricChecks`) must also be
  honoured by the grader. If `spofCheck` is `hidden`, no SPOF check may influence the verdict, and
  the grader receives the same resolved feature set the client used (the `--abstraction` precedent
  for CLI grading, extended to a `--features` snapshot or derivation from the same inputs).
- **Capability features** (`terminal`, `topologyFiles`, `resourceEditing`) are enforced where the
  action happens (command registry, import path, store setters), not only by hiding the button, and
  edits are re-validated by the question-policy grader backstop.
- The resolved feature set is recorded in each submission so a verdict can be explained later.

## 8. Authoring (Question Studio)

- A "Features" section in the Policy stage lists only features where `overridable.byQuestion !== 'none'`.
- Each row shows: the state the matrix gives in the question's intended modes, the author's
  override, and the effective result per mode, so "SPOF: hidden in Classroom, enabled in Architect"
  is visible at a glance.
- A **mode preview switcher** (Assignment / Practice / Classroom / Lab) in `LearnerExperiencePreview`
  renders the real UI from `resolveFeatures`, instead of a mock.
- Readiness warnings: a graded check whose feature is hidden in a mode the question targets; a
  `requires` chain broken by an override; an override that is ignored because of `tighten`.
- Classroom's `designChecks` toggle remains as a friendly alias that writes the `spofCheck`
  override; one data model, two UI entry points.

## 9. Docs and tooling

- A generator emits `docs/feature-matrix.md` from the registry and matrix (rows = features,
  columns = contexts, cells = state, plus a column of which overrides are allowed). CI fails if it
  is stale.
- The dev panel from the feature-flags spec gains a "Resolved features" view with the winning layer
  per feature (default / matrix row / question / host / user), so "why can't I see X?" has an answer.
- The authoring skills (`simulator-question-author`, `classroom-question-author`) get the generated
  matrix in `references/` and the `capability-snapshot.json` includes the registry.

## 10. Relationship to the other specs

- **App feature flags**: a release flag can force a feature `hidden` before it launches (a build-level
  floor applied at step 1 of resolution), and is deleted when the feature ships. Flags are about
  _shipping_; this matrix is about _context_. Never encode a mode distinction as a flag.
- **Question policy**: `edit`, `grade`, `reveal`, `surfaces` stay the place for fine-grained,
  question-specific rules (paths, per-check modes, case scoping). Its `surfaces` block is superseded
  by `policy.features` here; do not implement both.

## 11. Testing

- Registry test: every feature has surfaces, a legal default, and `default ∈ states`.
- Matrix test: no row references an unknown feature or context value; all `requires` resolve.
- **Equivalence test (the key one):** for every existing `EnvironmentProfile` preset ×
  `abstraction` × sample question/lab, `resolveFeatures` equals today's capabilities, visibility and
  tabs. This proves the migration is behaviour-preserving before any gate is rewired.
- Override tests: `tighten` ignores loosening; `none` ignored; AUTHOR-in-Studio never tightened;
  safety features cannot be loosened by a question.
- Component tests render each migrated surface in `hidden`, `visible`, `enabled`.
- Grader test: a `hidden` evaluative feature does not affect the verdict.
- Generated doc is up to date.

## 12. Rollout

1. **Audit and registry**: enumerate every gate listed in section 6, write the registry and matrix,
   and land the equivalence test. No rewiring. This is also where the PRACTICE and unlisted rows get filled.
2. Add `resolveFeatures` and `useFeature`, derived from `EnvironmentProfile` + the question.
3. Migrate gates one feature at a time, starting with `spofCheck` (smallest, already question-driven)
   then the capability booleans; each PR deletes the old gate it replaces.
4. Question overrides (`policy.features`) and Studio Features section.
5. Grader snapshot and submission record.
6. Generated docs, dev panel resolved view, skills update.
7. Delete `EnvironmentCapabilities` gating reads in components (type stays for hosts).

Each step leaves behaviour unchanged for existing questions.

## 13. Open questions

1. **Granularity:** is `visible` (read-only) worth supporting for every feature, or only a few?
   Fewer legal states per feature means fewer rows to test; the `states` field allows both.
2. **Where do quantities live?** Test-run limits, budgets and palette lists are values, not states.
   Plan: registry gets a `value` kind later; for now they stay on the profile/policy.
3. **Host contract:** does the Newton host need a way to send per-feature overrides, or is
   `EnvironmentProfile` mode plus the question enough? Adding host overrides widens the integration.
4. **User overrides:** which features should end users be able to hide for themselves
   (`spofCheck` badges, `metricLenses`, `costMeter`), versus those that belong to the question?
5. **Precedence of user vs question:** should a student's "hide SPOF badges" beat a question that
   enables SPOF for its lesson? Proposal: the user may tighten only presentation features, never
   evaluative ones.
6. **Naming:** `abstraction` vs `mode` vs `experience` are three overlapping axes today. Should the
   matrix collapse them into one named "environment", or keep them orthogonal?
7. **Taxonomy for the author:** keep the UI flat (a list of features) or group by surface?

## 14. Acceptance criteria

- One registry and one matrix describe every mode/abstraction/experience-dependent gate.
- Answering "is X shown in Classroom, Assignment, Lab?" is a table lookup, and the table is generated.
- The SPOF check can be turned off or on for Classroom by the author, by the registry's rule, with
  the grader agreeing with the UI.
- The equivalence test passes against all existing presets and sample questions before any gate migrates.
- A new environment can be created by `extends` plus a few overrides, from the UI or a JSON file,
  with no code change, and is validated, previewable, exportable and recorded on submissions.
- Adding one feature takes one registry entry plus one `<Feature>` wrapper, and appears in every
  editor and generated doc automatically.
- No component gates on mode/abstraction/profile booleans directly after step 7.
- Overrides obey `overridable`; a question cannot loosen a graded-context safety feature.
