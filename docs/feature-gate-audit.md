# Feature gate audit

Step 1 of [feature-visibility-matrix-spec.md](feature-visibility-matrix-spec.md) §12: where the app
decides what is shown or usable depending on mode, abstraction or experience, and how each gate maps
onto the feature registry ([featureRegistry.ts](../src/engine/analysis/featureRegistry.ts)) and
matrix ([featureMatrix.ts](../src/engine/analysis/featureMatrix.ts)). Line numbers are as of
`97f01fc`. Nothing in the renderer reads the registry yet; the equivalence test
([featureMatrixEquivalence.test.ts](../src/renderer/src/utils/featureMatrixEquivalence.test.ts))
proves the matrix reproduces these gates across every preset, requested abstraction and question
shape (81 cases).

## Context axes as they exist in code

| Axis                      | Values                              | Derived by                                                                                                                                                                                                                                            |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                    | AUTHOR, ASSIGNMENT, PRACTICE        | host input to `resolveEnvironmentProfile`                                                                                                                                                                                                             |
| `abstraction` (requested) | architect, classroom, **guided**    | profile; the spec only named the first two                                                                                                                                                                                                            |
| `abstraction` (in effect) | same                                | `resolveAbstraction(profile, question)`: falls back to architect when the question is not Classroom-ready or does not allow the level                                                                                                                 |
| `experience`              | SANDBOX, ASSIGNMENT, INTERVIEW, LAB | `resolveExperienceEnvelope` (graded or ASSIGNMENT mode → ASSIGNMENT; lab tag or fully locked complete scaffold → LAB; no question → SANDBOX; else INTERVIEW). Note AUTHOR is `graded: true`, so any question under AUTHOR is an ASSIGNMENT experience |
| question `domains`        | `network`, `cost`, …                | unlock edges (`network`) and resource editing (`cost`)                                                                                                                                                                                                |

The matrix context uses the abstraction **in effect**, never the requested one.

## Gates found, and what they map to

| Feature                                                             | Today's gate                                                                                                                                                                                   | Reads                                                    | Notes                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `topologyFiles`                                                     | `WorkspaceLayout.tsx:455`                                                                                                                                                                      | raw profile `canUseTopologyFiles`                        | **Also forced off by `isNewtonHostMode()`**; the host axis is not in the matrix yet                        |
| `topologyJson`                                                      | `WorkspaceLayout.tsx:462`, `1613`, `1645`, `2001`                                                                                                                                              | Classroom-locked profile                                 | Classroom hides it outside AUTHOR                                                                          |
| `terminal`                                                          | `WorkspaceLayout.tsx:463`, `1410`, `2067`                                                                                                                                                      | Classroom-locked profile                                 | Same Classroom rule                                                                                        |
| `settingsModal`                                                     | `SettingsButton.tsx:22`, `WorkspaceLayout.tsx:1501`, `1969`                                                                                                                                    | raw profile                                              | Not Classroom-locked                                                                                       |
| `annotations`                                                       | `FlowCanvas.tsx:179`                                                                                                                                                                           | raw profile                                              |                                                                                                            |
| `scaffoldNodeEditing`                                               | `BaseNode.tsx:117`, `FlowCanvas.tsx:214`, `PropertiesPanel.tsx:1441`, `useStore.ts:88-186`                                                                                                     | raw profile                                              | The store also ANDs authored locks (`canModifyScaffold`, locked ids) and attempt `LOCKED`; see Not covered |
| `testRuns`                                                          | `QuestionPanel.tsx:756`, `canTriggerTestRun`                                                                                                                                                   | raw profile                                              | The cap (`maxTestRuns`) is a value, and is not enforced (`ENFORCE_TEST_RUN_LIMIT = false`)                 |
| `edgeProperties`                                                    | `resolveEdgeModel`, `canEditEdgesForQuestion` (many: `PacketEdge`, `PropertiesPanel`, `TerminalTab`, `appTerminalDeps`, `useTopologySerializer`, `TopologyJsonViewer`, `ImportTopologyDialog`) | profile + question domains                               | Ladder: connector (hidden) < modelled locked (visible) < modelled editable (enabled)                       |
| `resourceEditing`                                                   | `canEditResourcesForQuestion`; `PropertiesPanel.tsx:1457`, `appTerminalDeps.ts:152`                                                                                                            | profile + domains + Classroom                            |                                                                                                            |
| `executionProfile`                                                  | `appTerminalDeps.ts:159`                                                                                                                                                                       | Classroom-locked profile                                 |                                                                                                            |
| `questionPrompt`                                                    | `QuestionPanel.tsx:742`                                                                                                                                                                        | raw `visibility.prompt`                                  |                                                                                                            |
| `scaffoldSourceNodes`                                               | `BaseNode.tsx:119`                                                                                                                                                                             | raw visibility                                           |                                                                                                            |
| `suiteDetails`                                                      | `QuestionPanel.tsx:746`                                                                                                                                                                        | raw visibility AND `suite.visibleToStudent`              | The question half is question-policy territory                                                             |
| `liveMetrics`                                                       | `BaseNode.tsx:134`, `useNodeMetrics.ts:6`, `WorkspaceLayout.tsx:1702`                                                                                                                          | raw visibility                                           |                                                                                                            |
| `rubricChecks`                                                      | `shouldShowRubricResults`, `QuestionPanel.tsx:1214`                                                                                                                                            | raw visibility                                           | Only shown vs not here; the timing (live / after submit) stays a value                                     |
| `designChecks`                                                      | `useDesignChecksHidden` (`useClassroom.ts:28`) → `ResultsTray.tsx:4155`, `DesignChecksChip.tsx:27`, `BaseNode.tsx:130`                                                                         | Classroom active AND NOT `classroom.designChecks`        | The question opt-in becomes a question-layer override                                                      |
| `spofBadges`                                                        | `BaseNode.tsx:131`                                                                                                                                                                             | `displaySettings.showSpofBadges` AND design checks shown | Only the badge and ring; the tray and chip ignore the user pref, so this is split from `designChecks`      |
| `questionTab` `libraryTab` `labsTab` `scenariosTab` `blueprintsTab` | `experienceEnvelope.ts` `allowedTabs`; `WorkspaceLayout.tsx:430,482,1445,1480`; `LibrarySidebar.tsx:128`                                                                                       | experience kind                                          | Blueprints are filtered out everywhere by `withVisibleTabs`; Labs only shown where the list includes it    |
| `canvasInteraction`                                                 | `experienceEnvelope.ts` `canvasLocked`; `WorkspaceLayout.tsx:435,1703`                                                                                                                         | experience kind                                          |                                                                                                            |

## Quirks the audit turned up

These are today's behaviour, reproduced as-is by the matrix. None is changed in this step.

1. **Raw vs Classroom-locked reads are inconsistent.** Terminal, JSON, execution profile and edge
   editing read the Classroom-locked profile; files, settings, annotations and scaffold editing read
   the raw one. The matrix carries this faithfully (Classroom rows touch only the first group).
2. **Edge labels.** `canEditEdgeLabelsForQuestion` reads the raw `canEditEdges`, so under PRACTICE
   with Classroom in effect, edge labels stay editable while edge properties are hidden. Not
   modelled; there is no `edgeLabels` feature yet.
3. **Tab order matters.** Keyboard shortcuts index into `allowedTabs` (`WorkspaceLayout.tsx:1480`),
   but the matrix expresses membership only. The consumer migration needs a fixed tab order constant.
4. **Simple shell filters the library tab** (`WorkspaceLayout.tsx:430`) and enables the Add popover
   (`:435`). That is a layout preference layered on the envelope, deliberately outside the matrix.
   The `DisplaySettings` comment says the simple layout has since become the default, so the
   "(beta), off by default" wording in the older progressive-disclosure doc, and the `simpleShell`
   default in the flag spec's example, are out of date.
5. **Host forces files off** (`isNewtonHostMode`) regardless of profile, and ASSIGNMENT fails closed
   for files, JSON, terminal and settings against host payloads
   (`resolveEnvironmentProfile`). The latter is already reflected by `SAFETY` override scope.
6. **AUTHOR is graded**, so the "experience" for any question under AUTHOR is ASSIGNMENT.

## Not covered by this step

- **Host overrides** (profile payload, Newton host). The resolver supports a `host` layer; nothing
  feeds it, and the equivalence test does not exercise host payloads on top of presets.
- **Question-level locks**: `lockedNodeIds`, `lockedEdgeIds`, `canModifyScaffold`,
  `canRemoveScaffoldNodes`, `isLockedLabQuestion`, attempt `LOCKED`. These belong to
  [question-policy-spec.md](question-policy-spec.md).
- **Values, not states**: `maxTestRuns`, `editPaletteList`, `resourceBudget`, `costBudget`,
  `rubricChecks` timing.
- **Not yet audited**: `chromeDensity` and `presenter` (appearance, probably not features), metric
  lenses, the cost/budget meters, edge routing and node display style, scenarios content, the
  Question Studio surface, and the `import.meta.env.DEV` gates (LLM grading, perf diagnostics),
  which are app feature flags per [feature-flags-spec.md](feature-flags-spec.md).
- **AUTHOR on Question Studio** never being tightened: needs the `surface` axis, added when the
  Studio is migrated.

## What this step added

- `featureRegistry.ts`: 23 features, their surfaces, legal states, defaults and override scopes.
- `featureMatrix.ts`: the matrix rows and `resolveFeatures(context, overrides)` (defaults → rows →
  question / host / user overrides by scope → `requires` closure).
- `featureMatrixEquivalence.test.ts`: registry checks, the 81-case equivalence proof, and override
  rules.

## Next (step 2 onward)

1. `useFeature` and a renderer-side context built from the store, then migrate `spofCheck` first:
   `designChecks` and `spofBadges`.
2. Migrate the capability booleans one at a time, deleting each old read as its consumer moves.
3. Add the `host` and `surface` axes, a tab-order constant, and the quirks above as explicit rows or
   decisions.
