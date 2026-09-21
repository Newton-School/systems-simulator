import { PALETTE_TEMPLATES } from '../catalog/paletteTemplates'
import type { ComponentCategory, ComponentType } from '../core/types'
import type { SemanticCriterion } from './gradingCriteria'
import type { CheckOp, RubricCheckKind } from './rubric'
import type { StructuralRule } from './structural'
import { getComponentCategorySupport, type SupportTier } from './supportLedger'

export type AuthoringEvidenceMode = 'question' | 'discrete' | 'analytic'
export type AuthoringCapabilityCategory = 'structural' | 'semantic' | 'rubric'
export type AuthoringFieldControl =
  | 'text'
  | 'number'
  | 'component'
  | 'component-list'
  | 'category'
  | 'metric'
  | 'operator'
  | 'state-transition'

export interface AuthoringFieldDefinition {
  key: string
  label: string
  control: AuthoringFieldControl
  required: boolean
}

export interface AuthoringCapabilityDefinition {
  id: string
  label: string
  category: AuthoringCapabilityCategory
  supportTier: SupportTier
  evidenceModes: readonly AuthoringEvidenceMode[]
  fields: readonly AuthoringFieldDefinition[]
  compile<T extends Record<string, unknown>>(draft: T): T
  decompile<T extends Record<string, unknown>>(compiled: T): T
}

interface CapabilitySeed {
  label: string
  supportTier: SupportTier
  evidenceModes: readonly AuthoringEvidenceMode[]
  fields: readonly AuthoringFieldDefinition[]
}

const field = (
  key: string,
  label: string,
  control: AuthoringFieldControl,
  required = true
): AuthoringFieldDefinition => ({ key, label, control, required })

const STRUCTURAL_CAPABILITY_SEEDS = {
  requires_component: {
    label: 'Require a component',
    fields: [
      field('componentType', 'Component', 'component'),
      field('minCount', 'Minimum', 'number', false)
    ]
  },
  requires_category: {
    label: 'Require a component category',
    fields: [
      field('category', 'Category', 'category'),
      field('minCount', 'Minimum', 'number', false)
    ]
  },
  requires_edge: {
    label: 'Require a direct connection',
    fields: [field('fromType', 'From', 'component'), field('toType', 'To', 'component')]
  },
  max_component_count: {
    label: 'Limit a component count',
    fields: [
      field('componentType', 'Component', 'component'),
      field('maxCount', 'Maximum', 'number')
    ]
  },
  requires_redundancy: {
    label: 'Require redundant instances',
    fields: [
      field('componentType', 'Component', 'component'),
      field('minReplicas', 'Minimum replicas', 'number')
    ]
  },
  forbids_component: {
    label: 'Forbid a component',
    fields: [field('componentType', 'Component', 'component')]
  },
  requires_connected_graph: {
    label: 'Require a connected design',
    fields: []
  },
  requires_single_source: {
    label: 'Require exactly one traffic source',
    fields: []
  },
  min_node_count: {
    label: 'Require a minimum node count',
    fields: [field('count', 'Minimum nodes', 'number')]
  },
  max_node_count: {
    label: 'Limit the node count',
    fields: [field('count', 'Maximum nodes', 'number')]
  },
  requires_path: {
    label: 'Require a reachable path',
    fields: [field('fromType', 'From', 'component'), field('toType', 'To', 'component')]
  }
} satisfies Record<StructuralRule['kind'], Pick<CapabilitySeed, 'label' | 'fields'>>

const SEMANTIC_CAPABILITY_SEEDS = {
  componentPresence: {
    label: 'Require a configured component',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('componentType', 'Component', 'component'),
      field('minCount', 'Minimum count', 'number')
    ]
  },
  componentProperty: {
    label: 'Configuration requirement',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('parentId', 'Parent component requirement', 'text'),
      field('property', 'Property', 'text'),
      field('expected', 'Expected value', 'text')
    ]
  },
  placement: {
    label: 'Place a component in the correct path',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [field('componentType', 'Component', 'component')]
  },
  guardedPath: {
    label: 'Require traffic through a guard',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('from', 'From', 'component'),
      field('guard', 'Guard', 'component'),
      field('to', 'To', 'component', false)
    ]
  },
  fanout: {
    label: 'Require independent fan-out',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [field('broker', 'Broker', 'component'), field('minConsumers', 'Consumers', 'number')]
  },
  storageFit: {
    label: 'Require a store fit',
    supportTier: 'first-class',
    evidenceModes: ['question'],
    fields: [
      field('accessPattern', 'Access pattern', 'text'),
      field('accept', 'Accepted stores', 'component-list')
    ]
  },
  forbidUnjustified: {
    label: 'Forbid an unjustified component',
    supportTier: 'guided',
    evidenceModes: ['question'],
    fields: [field('componentType', 'Component', 'component')]
  },
  stateTransition: {
    label: 'Require a runtime state transition',
    supportTier: 'guided',
    evidenceModes: ['discrete'],
    fields: [field('match', 'Transition', 'state-transition')]
  },
  stateSequence: {
    label: 'Require a runtime state sequence',
    supportTier: 'guided',
    evidenceModes: ['discrete'],
    fields: [field('sequence', 'Transitions', 'state-transition')]
  }
} satisfies Record<SemanticCriterion['kind'], CapabilitySeed>

function identity<T extends Record<string, unknown>>(value: T): T {
  return value
}

function capability(
  category: Exclude<AuthoringCapabilityCategory, 'rubric'>,
  id: string,
  seed: Pick<CapabilitySeed, 'label' | 'fields'> & Partial<CapabilitySeed>
): AuthoringCapabilityDefinition {
  return {
    id,
    label: seed.label,
    category,
    supportTier: seed.supportTier ?? 'first-class',
    evidenceModes: seed.evidenceModes ?? ['question'],
    fields: seed.fields,
    compile: identity,
    decompile: identity
  }
}

export const STRUCTURAL_AUTHORING_CAPABILITIES = Object.entries(STRUCTURAL_CAPABILITY_SEEDS).map(
  ([id, seed]) => capability('structural', id, seed)
)

export function getStructuralAuthoringCapability(
  id: StructuralRule['kind']
): AuthoringCapabilityDefinition | undefined {
  return STRUCTURAL_AUTHORING_CAPABILITIES.find(
    (capabilityDefinition) => capabilityDefinition.id === id
  )
}

export const SEMANTIC_AUTHORING_CAPABILITIES = Object.entries(SEMANTIC_CAPABILITY_SEEDS).map(
  ([id, seed]) => capability('semantic', id, seed)
)

export interface RubricMetricCapability {
  id: string
  label: string
  kind: Exclude<RubricCheckKind, 'topology'>
  supportTier: SupportTier
  evidenceModes: readonly AuthoringEvidenceMode[]
  operators: readonly CheckOp[]
}

const ALL_OPERATORS = ['<', '<=', '>', '>=', '==', '!='] as const satisfies readonly CheckOp[]

function metricLabel(metric: string): string {
  return metric
    .replaceAll('.', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

function metric(
  id: string,
  kind: RubricMetricCapability['kind'],
  evidenceModes: readonly AuthoringEvidenceMode[]
): RubricMetricCapability {
  return {
    id,
    label: metricLabel(id),
    kind,
    supportTier: 'first-class',
    evidenceModes,
    operators: ALL_OPERATORS
  }
}

const SIMULATION_METRIC_IDS = [
  'summary.latency.p50',
  'summary.latency.p90',
  'summary.latency.p95',
  'summary.latency.p99',
  'summary.latency.min',
  'summary.latency.max',
  'summary.latency.mean',
  'summary.errorRate',
  'summary.throughput',
  'summary.totalRequests',
  'summary.successfulRequests',
  'summary.failedRequests',
  'summary.rejectedRequests',
  'summary.timedOutRequests',
  'summary.connectionResetRequests',
  'perNode.maxUtilization',
  'perNode.maxErrorRate',
  'perNode.maxLatencyP99',
  'reservations.commits',
  'reservations.conflicts',
  'reservations.oversells',
  'locks.acquires',
  'locks.contentions',
  'locks.keyless',
  'retries.attempts',
  'retries.budgetExhausted',
  'rateLimit.admitted',
  'rateLimit.rejected',
  'rateLimit.breaches',
  'rateLimit.keyless'
] as const

const INVARIANT_METRIC_IDS = [
  'invariantViolations.count',
  'sloBreaches.count',
  'conservation.unbalanced',
  'littlesLaw.violations'
] as const

export const RUBRIC_METRIC_CAPABILITIES: readonly RubricMetricCapability[] = [
  ...SIMULATION_METRIC_IDS.map((id) => metric(id, 'simulation', ['discrete', 'analytic'])),
  ...INVARIANT_METRIC_IDS.map((id) => metric(id, 'invariant', ['discrete', 'analytic']))
]

export function getRubricMetricCapability(id: string): RubricMetricCapability | undefined {
  return RUBRIC_METRIC_CAPABILITIES.find((capabilityDefinition) => capabilityDefinition.id === id)
}

export const SIMULATION_RUBRIC_METRICS: ReadonlySet<string> = new Set(SIMULATION_METRIC_IDS)
export const INVARIANT_RUBRIC_METRICS: ReadonlySet<string> = new Set(INVARIANT_METRIC_IDS)

export const NFR_METRIC_TO_RUBRIC_METRIC: Readonly<Record<string, string>> = {
  latency_p99: 'summary.latency.p99',
  latency_p50: 'summary.latency.p50',
  error_rate: 'summary.errorRate',
  throughput: 'summary.throughput'
}

export interface AuthoringComponentCapability {
  id: ComponentType
  label: string
  category: ComponentCategory
  supportTier: SupportTier
  supportSummary: string
}

function buildComponentCapabilities(): AuthoringComponentCapability[] {
  const byType = new Map<ComponentType, AuthoringComponentCapability>()
  for (const template of Object.values(PALETTE_TEMPLATES)) {
    // Composite location/container templates are canvas primitives, not
    // component choices that grading rules can target.
    if (!template.componentType || !template.category) continue
    if (byType.has(template.componentType)) continue
    const support = getComponentCategorySupport(template.category)
    byType.set(template.componentType, {
      id: template.componentType,
      label: template.label,
      category: template.category,
      supportTier: support.tier,
      supportSummary: support.summary
    })
  }
  return [...byType.values()].sort((left, right) => left.label.localeCompare(right.label))
}

export const AUTHORING_COMPONENT_CAPABILITIES = buildComponentCapabilities()

/**
 * Canonical palette template per component type: the first template of each
 * type, matching how {@link buildComponentCapabilities} picks the single
 * authoring row a component type is chosen by. The learner palette uses this so
 * that a question's `allowedNodeTypes` surfaces exactly the item the author
 * selected — not every same-type template (e.g. allowing `microservice` shows
 * "API Server" only, not also "ID Generator", "Service", "My Service").
 */
function buildCanonicalTemplateIds(): Record<string, string> {
  const byType: Record<string, string> = {}
  for (const template of Object.values(PALETTE_TEMPLATES)) {
    if (!template.componentType || !template.category) continue
    if (byType[template.componentType]) continue
    byType[template.componentType] = template.id
  }
  return byType
}

export const CANONICAL_TEMPLATE_ID_BY_COMPONENT_TYPE: Readonly<Record<string, string>> =
  buildCanonicalTemplateIds()

export const AUTHORING_OBLIGATION_CAPABILITIES: readonly AuthoringCapabilityDefinition[] = [
  ...STRUCTURAL_AUTHORING_CAPABILITIES,
  ...SEMANTIC_AUTHORING_CAPABILITIES
]
