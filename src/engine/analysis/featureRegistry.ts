/**
 * The feature registry (docs/feature-visibility-matrix-spec.md §4.1): every capability the app
 * shows or withholds depending on mode, abstraction or experience, with one id, the surfaces it
 * appears on, the states it can take and who may override it.
 *
 * Step 1 of the rollout: this is data plus a pure resolver (`featureMatrix.ts`). Nothing in the
 * renderer reads it yet; `featureMatrix.test.ts` proves it reproduces today's gates. The audit of
 * where each gate lives today is docs/feature-gate-audit.md.
 */

/** hidden < visible < enabled. "Tightening" moves left. */
export type FeatureState = 'hidden' | 'visible' | 'enabled'

export const FEATURE_STATE_RANK: Readonly<Record<FeatureState, number>> = {
  hidden: 0,
  visible: 1,
  enabled: 2
}

export const SURFACES = [
  'canvas',
  'node',
  'edge',
  'properties-panel',
  'palette',
  'sidebar',
  'results-tray',
  'question-card',
  'terminal',
  'settings',
  'toolbar',
  'grading'
] as const
export type Surface = (typeof SURFACES)[number]

/** Who may move a feature, and how far. `tighten` = only toward `hidden`. */
export type OverrideScope = 'none' | 'tighten' | 'any'

export interface FeatureDef {
  label: string
  description: string
  surfaces: readonly Surface[]
  /** States this feature can legally take. */
  states: readonly FeatureState[]
  /** State when no matrix row says otherwise. */
  default: FeatureState
  overridable: { byQuestion: OverrideScope; byHost: OverrideScope; byUser: OverrideScope }
  /** Minimum state another feature must have for this one to work; otherwise this drops to hidden. */
  requires?: Readonly<Record<string, FeatureState>>
  /** Whether the feature also changes the grader's verdict (spec §7). */
  affectsGrading?: boolean
}

const ALL: readonly FeatureState[] = ['hidden', 'visible', 'enabled']
const SHOWN_OR_NOT: readonly FeatureState[] = ['hidden', 'visible']
const USABLE_OR_NOT: readonly FeatureState[] = ['hidden', 'enabled']
const READONLY_OR_EDITABLE: readonly FeatureState[] = ['visible', 'enabled']

/** Sensitive surfaces: a host or question may only remove them, never grant them (spec §5). */
const SAFETY = { byQuestion: 'tighten', byHost: 'tighten', byUser: 'none' } as const
/** Pedagogical controls a host may tune (run count, resource editing, feedback). */
const TUNABLE = { byQuestion: 'tighten', byHost: 'any', byUser: 'none' } as const
/** Layout/chrome that a question may shape but a user may not. */
const FIXED = { byQuestion: 'tighten', byHost: 'tighten', byUser: 'none' } as const

export const FEATURES = {
  // ── Capabilities (EnvironmentCapabilities) ──────────────────────────────────────────────────
  topologyFiles: {
    label: 'Open / save topology files',
    description: 'Import, export, open and save topology files.',
    surfaces: ['toolbar', 'settings'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: SAFETY
  },
  topologyJson: {
    label: 'Raw topology JSON',
    description: 'Inspect the serialized topology in the right-hand panel.',
    surfaces: ['sidebar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: SAFETY
  },
  terminal: {
    label: 'Command terminal',
    description: 'The simulator command terminal.',
    surfaces: ['terminal', 'toolbar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: SAFETY
  },
  settingsModal: {
    label: 'Settings',
    description: 'The environment and simulation settings dialog.',
    surfaces: ['settings', 'toolbar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: SAFETY
  },
  annotations: {
    label: 'Teaching annotations',
    description: 'The separate teaching-annotation layer on the canvas.',
    surfaces: ['canvas'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: FIXED
  },
  scaffoldNodeEditing: {
    label: 'Edit scaffold nodes',
    description:
      'Whether nodes provided by the question scaffold can be edited. `visible` = shown but frozen.',
    surfaces: ['canvas', 'node', 'properties-panel'],
    states: READONLY_OR_EDITABLE,
    default: 'enabled',
    overridable: TUNABLE,
    affectsGrading: true
  },
  testRuns: {
    label: 'Test runs',
    description:
      'Trigger a test or dry run before submitting. The run cap is a value, not a state.',
    surfaces: ['question-card', 'toolbar'],
    states: ALL,
    default: 'enabled',
    overridable: TUNABLE
  },
  edgeProperties: {
    label: 'Edge properties',
    description:
      'How much of an edge is modelled: `hidden` = a plain connector (no physics, no panel), `visible` = ' +
      'modelled but locked, `enabled` = modelled and editable.',
    surfaces: ['edge', 'properties-panel', 'canvas'],
    states: ALL,
    default: 'enabled',
    overridable: TUNABLE,
    affectsGrading: true
  },
  resourceEditing: {
    label: 'Edit node resources',
    description: 'Change instance type and count. `visible` = values shown, not editable.',
    surfaces: ['properties-panel', 'terminal'],
    states: READONLY_OR_EDITABLE,
    default: 'enabled',
    overridable: TUNABLE,
    affectsGrading: true
  },
  executionProfile: {
    label: 'Edit execution profile',
    description: 'Switch a node between cpu-bound and io-bound.',
    surfaces: ['properties-panel', 'terminal'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: TUNABLE,
    affectsGrading: true
  },

  // ── Visibility (EnvironmentVisibility) ──────────────────────────────────────────────────────
  questionPrompt: {
    label: 'Question prompt',
    description: 'The prompt and FR / NFR / scale brief.',
    surfaces: ['question-card'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    overridable: FIXED
  },
  scaffoldSourceNodes: {
    label: 'Mark scaffold nodes',
    description: 'Show which nodes came from the scaffold.',
    surfaces: ['node', 'canvas'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    overridable: FIXED
  },
  suiteDetails: {
    label: 'Grading suite details',
    description: 'The detailed grading scenarios (also needs the suite to be student-visible).',
    surfaces: ['question-card', 'grading'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    overridable: FIXED
  },
  liveMetrics: {
    label: 'Live metrics',
    description: 'Live RPS and metrics while building.',
    surfaces: ['node', 'toolbar'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    overridable: TUNABLE
  },
  rubricChecks: {
    label: 'Rubric check results',
    description:
      'Whether check results are shown at all. WHEN they appear (live vs after submit) is the ' +
      '`rubricChecks` timing value on the environment profile, not a state.',
    surfaces: ['question-card', 'results-tray', 'grading'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    overridable: TUNABLE,
    affectsGrading: true
  },

  // ── Design checks (currently gated by Classroom + question + user prefs) ───────────────────
  designChecks: {
    label: 'Design checks',
    description:
      'Anti-pattern and single-point-of-failure analysis, in the results tray, the toolbar chip and the node badges.',
    surfaces: ['results-tray', 'toolbar', 'node'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    // A redundancy lesson turns this on in Classroom (`classroom.designChecks`), so a question may loosen it.
    overridable: { byQuestion: 'any', byHost: 'tighten', byUser: 'none' }
  },
  spofBadges: {
    label: 'SPOF badges',
    description: 'The single-point-of-failure badge and danger ring on canvas nodes.',
    surfaces: ['node'],
    states: SHOWN_OR_NOT,
    default: 'visible',
    // Today a user preference (`displaySettings.showSpofBadges`); only meaningful while design checks show.
    overridable: { byQuestion: 'tighten', byHost: 'none', byUser: 'tighten' },
    requires: { designChecks: 'visible' }
  },

  // ── Sidebar tabs and canvas (experienceEnvelope.ts) ─────────────────────────────────────────
  questionTab: {
    label: 'Question tab',
    description: 'The question / brief tab in the left sidebar.',
    surfaces: ['sidebar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: FIXED
  },
  libraryTab: {
    label: 'Component library tab',
    description: 'The component library in the left sidebar.',
    surfaces: ['sidebar', 'palette'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: FIXED
  },
  labsTab: {
    label: 'Labs tab',
    description: 'Guided labs in the left sidebar.',
    surfaces: ['sidebar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: FIXED
  },
  scenariosTab: {
    label: 'Scenarios tab',
    description: 'Sample scenarios in the left sidebar.',
    surfaces: ['sidebar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: FIXED
  },
  blueprintsTab: {
    label: 'Blueprints tab',
    description:
      'Blueprints in the left sidebar. Hidden everywhere while blueprints are being prepared.',
    surfaces: ['sidebar'],
    states: USABLE_OR_NOT,
    default: 'enabled',
    overridable: FIXED
  },
  canvasInteraction: {
    label: 'Canvas interaction',
    description: 'Whether the canvas can be edited. `visible` = locked, as in a Lab.',
    surfaces: ['canvas'],
    states: READONLY_OR_EDITABLE,
    default: 'enabled',
    overridable: FIXED
  }
} as const satisfies Record<string, FeatureDef>

export type FeatureId = keyof typeof FEATURES

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[]

export function featureDef(id: FeatureId): FeatureDef {
  return FEATURES[id]
}
