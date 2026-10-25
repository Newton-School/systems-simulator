# Question Policy (per-question flags) — Spec

Status: proposed (not implemented). Companion to [feature-flags-spec.md](feature-flags-spec.md) and
[feature-visibility-matrix-spec.md](feature-visibility-matrix-spec.md). Which _features_ show in
which mode/environment is the matrix spec's job; its `policy.features` override supersedes this
spec's `surfaces` block (3.4), so implement only one of the two.

That spec covers **app-level** flags: release state of the app, decided by engineers, identical for
every question. This one covers **content-level** flags: what a _question author_ decides, stored
inside the `QuestionPackage`, versioned and exported with the question. Author-facing name:
**Question Policy**. Three questions it answers per question:

1. **Edit** — what may the student change, and what is frozen?
2. **Grade** — what is evaluated, on which scenarios and which parts of the design, and how heavily?
3. **Reveal / surfaces** — what does the student see and which tools can they use, and when?

## 1. What exists today (so we extend, not duplicate)

Per-question control is already real but scattered across eight places with different shapes:

| Need                               | Exists today                                                                                                     | Where                                           | Gap                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| Lock scaffold parts                | `scaffold.lockedNodeIds/lockedEdgeIds`, `constraints.canModifyScaffold`, `canRemoveScaffoldNodes`                | `engine/analysis/question.ts`, `FlowCanvas.tsx` | Whole-node/edge granularity only; UI-enforced                                           |
| Restrict what can be placed        | `constraints.allowedNodeTypes/forbiddenNodeTypes/maxNodeCount/maxBudget/maxTotalWorkers`                         | `question.ts`                                   | Types only, no per-field control                                                        |
| Gate custom builders               | `builderPolicy` (+ `TRAIT_PACK_DATA_PATHS` to stop bypass via properties panel/terminal)                         | `engine/analysis/builderPolicy.ts`              | The one place that already does path-level locking and violation-as-check; builder-only |
| Mode-level visibility/capabilities | `EnvironmentProfile` (AUTHOR / ASSIGNMENT / PRACTICE)                                                            | `engine/analysis/environmentProfile.ts`         | Host-chosen, not authored per question                                                  |
| When results show                  | `RubricCheckVisibility` = HIDDEN / LIVE_DURING_BUILD / POST_SUBMIT_ONLY                                          | `environmentProfile.ts`                         | One value per mode, not per check                                                       |
| What is graded                     | `rubric.checks[]` (`points`, `passThreshold`), `structuralRules`, `semanticCriteria`, `justify`, `suite.cases[]` | `question.ts`, `rubric.ts`                      | No advisory/off state; no per-check scoping to cases or nodes                           |
| Concept-first lock-down            | `classroom.controls[]` ("if present, everything else is locked"), `guidedKnobs[].path`, `designChecks`           | `engine/classroom/types.ts`                     | Classroom-only; the best existing model of an allow-list                                |
| Experience type                    | `experienceEnvelope.ts` derives tabs/`canvasLocked` from tags, type, constraints                                 | `renderer/utils/experienceEnvelope.ts`          | Inferred from tags, not declared                                                        |

Takeaway: the model needed is mostly an **allow-list with path granularity** (Classroom already
has it) plus **per-check grading modes**, unified behind one resolver. Today's behaviour must be
the result of an absent policy.

## 2. Goals and non-goals

Goals

- One optional `policy` block on `QuestionPackage`; absent = byte-for-byte today's behaviour.
- Path-level edit control (`sim.resources.instanceCount`, `config.cache.ttl`, …) in any mode, not just Classroom.
- Per-check and per-case grading control: scored, advisory, hidden, off.
- Enforced in the **engine/grader**, not only in the UI.
- Authorable in Question Studio with presets, previewable, and validated for satisfiability.

Non-goals

- Replacing `EnvironmentProfile`. The mode stays host-supplied; policy refines it (6).
- Anti-cheat or secrecy. The client is untrusted; policy is pedagogy plus a grader backstop (7).
- Remote or conditional (per-student) policy. Same package, same policy.

## 3. Schema

Additive and optional. Strict zod (unknown keys are errors, as `builderPolicy` does) so a typo is
never a silent no-op.

```ts
export interface QuestionPolicy {
  version: 1
  edit?: EditPolicy
  grade?: GradePolicy
  reveal?: RevealPolicy
  surfaces?: SurfacePolicy
}
```

### 3.1 Edit

Ordered rules over a target and an action. Matching rules combine: **deny beats allow; more
specific selector beats less specific; no match → the default.**

```ts
export interface EditPolicy {
  /** Applies when no rule matches. 'open' = today's behaviour. */
  default?: 'open' | 'locked'
  rules?: EditRule[]
}

export interface EditRule {
  id: string
  effect: 'allow' | 'deny'
  on: TargetSelector
  actions: EditAction[]
  /** Student-facing reason shown on the disabled control. */
  reason?: string
}

export type EditAction =
  | 'add'
  | 'remove'
  | 'move'
  | 'connect'
  | 'disconnect'
  | 'configure' // change values under `paths`
  | 'rename'
  | 'duplicate'

export interface TargetSelector {
  nodeIds?: string[]
  nodeTypes?: string[] // engine componentType, family-aware like classroom givens
  origin?: 'scaffold' | 'student' // scaffold nodes vs ones the student added
  edgeIds?: string[]
  paths?: string[] // config paths with * and ** globs; only meaningful for 'configure'
}
```

Example, "tune the cache only":

```jsonc
"edit": {
  "default": "locked",
  "rules": [
    { "id": "add-cache", "effect": "allow", "on": { "nodeTypes": ["cache"] }, "actions": ["add", "connect", "remove"] },
    { "id": "tune",      "effect": "allow", "on": { "nodeTypes": ["cache"], "paths": ["config.ttlSeconds", "config.capacityMb"] }, "actions": ["configure"] },
    { "id": "no-bypass", "effect": "deny",  "on": { "nodeTypes": ["database"], "paths": ["**"] }, "actions": ["configure"],
      "reason": "The database is fixed for this question." }
  ]
}
```

Back-compat sugar, normalised at load into rules, never both written back:

| Legacy                                    | Equivalent                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `lockedNodeIds` / `lockedEdgeIds`         | `deny` `remove`+`configure`+`move` / `disconnect` on those ids                         |
| `canModifyScaffold:false`                 | `deny` `configure`+`move`+`rename` on `origin:'scaffold'`                              |
| `canRemoveScaffoldNodes:false`            | `deny` `remove` on `origin:'scaffold'`                                                 |
| `allowedNodeTypes` / `forbiddenNodeTypes` | `allow`/`deny` `add` by `nodeTypes`                                                    |
| `classroom.controls[]`                    | allow-list with `default:'locked'` (Classroom keeps its own schema; resolver reads it) |
| `builderPolicy`                           | stays; its path table (`TRAIT_PACK_DATA_PATHS`) feeds the same path matcher            |

If both a legacy field and `edit` are present, `edit` wins and the authoring UI shows a conflict
warning.

### 3.2 Grade

Controls _what is evaluated and on what_, layered on the existing rubric/rules/cases. It never
adds checks of its own; it adjusts how existing ones count.

```ts
export type GradeMode = 'scored' | 'advisory' | 'hidden' | 'off'
//  scored   - counts toward points and pass threshold (today's behaviour)
//  advisory - evaluated and shown, 0 points, never fails the attempt
//  hidden   - scored, but result not shown to the student (only to grader/author)
//  off      - not evaluated

export interface GradePolicy {
  /** Axis switches. Omit = on. */
  axes?: {
    rubric?: GradeMode
    structural?: GradeMode
    semantic?: GradeMode
    justify?: GradeMode
    invariants?: GradeMode
    designChecks?: GradeMode
  }
  /** Per-item overrides, keyed by existing ids. */
  items?: GradeItemOverride[]
  /** Overrides rubric.passThreshold when set. */
  passThreshold?: number
}

export interface GradeItemOverride {
  /** rubric check id, structural rule id, semantic criterion id, or justify prompt id. */
  id: string
  mode?: GradeMode
  /** Only evaluate against these suite case ids. Omit = all cases. */
  cases?: string[]
  /** Evaluate only against matching nodes (topology/per-node metrics). */
  scope?: TargetSelector
  points?: number
}
```

Example, "grade p99 on the spike case only; availability is advisory":

```jsonc
"grade": {
  "items": [
    { "id": "p99-latency", "mode": "scored",   "cases": ["spike"], "points": 6 },
    { "id": "availability","mode": "advisory" },
    { "id": "no-spof",     "mode": "off" }
  ],
  "passThreshold": 0.7
}
```

Rules:

- Item ids must exist; unknown ids are a validation error (not ignored).
- `cases` must reference real `suite.cases[].id`; a `scored` item with an empty case set is an error.
- `hidden` + a student-visible suite is allowed; `hidden` items still affect the verdict.
- Grading results gain `policyMode` per check so reports show _why_ something didn't count.

### 3.3 Reveal

Per-check timing, refining the mode-wide `RubricCheckVisibility`.

```ts
export interface RevealPolicy {
  /** Default for checks not listed. */
  checks?: RubricCheckVisibility
  items?: Array<{ id: string; visibility: RubricCheckVisibility }>
  /** Show the scenario suite / reference hints to the student. */
  suiteDetails?: boolean
  liveMetrics?: boolean
}
```

### 3.4 Surfaces

Declared instead of inferred from tags in `experienceEnvelope.ts`.

```ts
export interface SurfacePolicy {
  tabs?: ExperienceSidebarTab[] // subset of what the mode offers
  terminal?: boolean
  topologyFiles?: boolean
  topologyJson?: boolean
  testRunLimit?: number // max graded runs per attempt
  blueprints?: boolean
}
```

## 4. Resolution

```
host mode preset (EnvironmentProfile)   <- host supplies; authority on security-sensitive capabilities
        ∩
question.policy                          <- author supplies
        ∩
(legacy fields, normalised)
        =  EffectivePolicy
```

- **Restrictive wins.** The question can tighten what the mode allows (e.g. disable the terminal
  in PRACTICE) but can never loosen what the mode forbids (e.g. enable topology import in
  ASSIGNMENT). `AUTHOR` mode ignores edit/surface restrictions so authors can build the question.
- One pure function owns the answer; no component reads `policy` fields directly:

```ts
resolvePolicy(question, profile): EffectivePolicy
canEdit(policy, { action, nodeId?, nodeType?, origin?, path? }): { allowed: boolean; ruleId?: string; reason?: string }
gradeModeFor(policy, itemId, caseId?): GradeMode
revealFor(policy, itemId): RubricCheckVisibility
```

Location: `src/engine/analysis/questionPolicy.ts` (pure, no React, like `builderPolicy.ts`), so the
renderer, CLI evaluator and Django/Newton export all share it.

## 5. Enforcement points

| Layer                                               | Change                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas (`FlowCanvas.tsx`)                           | Replace the scattered `constraints.*` reads with `canEdit(...)`; disabled drag/delete/connect show `reason`                                                                  |
| Properties panel / `fieldConfig.ts`                 | Fields render read-only with a lock tooltip when `configure` is denied for that path                                                                                         |
| Terminal (`src/shared/commands`)                    | `set`/config commands call `canEdit` per path, so the terminal is not a bypass (same lesson as `TRAIT_PACK_DATA_PATHS`)                                                      |
| Import / host messages (`questionHostMessaging.ts`) | Imported topology is diffed against scaffold and validated, not trusted                                                                                                      |
| **Grader (backstop)**                               | Diff submission vs scaffold; every violation becomes a failed check of kind `policy` (e.g. "Database config was modified"), exactly as `builderPolicy` violations already do |
| Grading                                             | `gradeModeFor` applied when assembling rubric/structural/semantic results; advisory/off/hidden handled before scoring                                                        |
| Results UI                                          | Respect `revealFor`; show advisory checks distinctly (no points, no pass/fail pressure)                                                                                      |

The grader backstop is non-negotiable: UI locks are convenience, the grader decides the verdict.

## 6. Relationship to modes, classroom and app flags

- **EnvironmentProfile** stays the host's lever; policy is the author's. Table in 4 defines who wins.
- **Classroom**: `classroom.controls` remains the concept-first allow-list. When present, the
  resolver treats it as `edit.default = 'locked'` plus its listed allows; `edit` rules then only
  tighten further. No change to Classroom authoring.
- **App-level flags** gate the _rollout_ of this feature, not individual questions:
  `questionPolicyEdit`, `questionPolicyGrade` (release flags, expiring). With the flag off,
  `policy` is parsed and validated but ignored, so questions can be authored ahead of the UI.

## 7. Validation and authoring

Validation (extends the existing readiness audit / `AuthoringReadinessPanel`):

- Schema strictness; unknown ids, cases, paths (against `fieldConfig` registry) are errors.
- **Satisfiability:** replay the question's reference solution under the effective policy. If the
  solution needs an edit the policy denies, or a scored check can't pass, block publishing. The
  authoring skill already requires a passing solution; this reuses it.
- **Dead locks:** warn when everything is locked (nothing to do) or a graded metric depends only
  on config the student can't touch.
- **Conflicts:** legacy field vs `edit` rule disagreement.

Question Studio:

- New "Policy" stage beside Constraints / Scaffold / Builder (`questionStudioStages.ts`), absorbing
  `QuestionConstraintsEditor`, `ScaffoldContractEditor` and `BuilderPolicyEditor` as sub-panels.
- **Presets as data, not code**: presets live in a JSON file, users can save their own ("Save as
  preset"), and a question can also select a shared named environment
  (see [feature-visibility-matrix-spec.md](feature-visibility-matrix-spec.md) 4A). Everything
  below is editable without touching JSON.
- **Presets** that write rules and are editable afterwards: _Open design_, _Fix and tune_ (scaffold
  locked, named paths editable), _Locked lab_ (everything locked, run-only), _Predict then run_.
- Click a node in the scaffold canvas to toggle per-path editability; each rule shows the
  students' view live in `LearnerExperiencePreview`.
- Rubric editor gets a per-check mode selector (scored / advisory / hidden / off) and case scope.

## 8. Packaging and compatibility

- `policy` is optional; `QUESTION_PACKAGE_VERSION` gets a minor bump only if the package schema
  gates on it; old packages load unchanged and old app builds that see `policy` must reject (strict
  schema) rather than silently drop it — decide per 11.
- Update: `json-artifact-schemas.md` and `capability-snapshot.json` in both skills,
  `questionAuthoringExportBundle.ts`, `newtonQuestionRows.ts`, `djangoQuestionExport.ts`,
  `src/cli/questionEvaluate.ts` / `questionBatch.ts`, and the authoring-coverage report.
- Re-package skills (`npm run package:*`) and the wiki page after the schema lands.

## 9. Testing

- `questionPolicy.test.ts`: precedence (deny > allow, specificity), glob matching, default modes,
  legacy normalisation, host ∩ question restrictiveness, AUTHOR bypass.
- Property test: for any legacy-only question, `canEdit` equals today's FlowCanvas behaviour.
- Grader: tampered submission (edit a locked path via import/terminal) fails with a `policy` check.
- Grade modes: advisory shows 0 points; off absent; hidden scored but not revealed; case scoping.
- Studio: satisfiability error when the reference solution is denied; preset round-trips.
- Existing `studentExperienceContract.test.tsx` and `QuestionPanel.test.ts` must stay green unchanged.

## 10. Rollout

1. `questionPolicy.ts` + schema + tests; legacy normalisation; no UI. Behind `questionPolicyEdit`.
2. Wire `canEdit` into canvas, properties panel, terminal; grader `policy` check.
3. Grade modes and reveal in the grader and results UI (`questionPolicyGrade`).
4. Studio Policy stage, presets, satisfiability validation.
5. Export/CLI/skills/doc updates; migrate sample labs (`sampleLabs.ts`) to presets as proof.
6. Retire direct reads of legacy `constraints.*` in the renderer (keep fields in the schema).

Each step ships with production behaviour unchanged for questions that have no `policy`.

## 11. Open questions

1. **Granularity of `configure`:** are config paths stable enough to be a public contract? Need a
   registry (from `fieldConfig.ts`) with stable ids, or authors will lock paths that get renamed.
2. **Forward compatibility:** should older app builds reject or ignore an unknown `policy`?
   Rejecting is safer for locks (ignoring would silently unlock) but breaks old clients.
3. **Per-node grading scope:** is `scope` on grade items needed in v1, or only `cases`? Per-node
   scoping depends on which metrics are per-node.
4. **Test-run limits:** is `testRunLimit` policy or host (server-side) state? A client counter is
   trivially reset.
5. **Student-visible policy:** show students the whole rule list ("what you can change") or only
   per-control reasons?
6. **Hidden items and fairness:** any requirement that `hidden` scoring be disclosed in the brief?
7. **Time-based reveal:** do we need "reveal after N attempts", or is the three-state visibility enough?

## 12. Acceptance criteria

- A question without `policy` behaves identically (property test over all sample questions/labs).
- An author can make "student may only change cache TTL and capacity" in Studio without editing JSON.
- The same restriction holds through canvas, properties panel, terminal and import, and a tampered
  submission fails in the grader.
- A check can be set to advisory/hidden/off and scoped to specific cases, and reports say why.
- Publishing is blocked when the reference solution cannot pass under the policy.
- Skills, export bundle and CLI accept the new field and their docs are updated.
