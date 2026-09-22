import {
  SEMANTIC_AUTHORING_CAPABILITIES,
  type AuthoringCapabilityDefinition
} from './authoringCapabilities'
import {
  SemanticCriterionSchema,
  type AccessPattern,
  type SemanticCriterion
} from './gradingCriteria'
import type { ComponentType } from '../core/types'
import type { RequestStateTransitionSource } from '../core/simulationSemantics'
import type { RequestOutcomeStatus } from '../core/event-stream'
import type { ComponentPropertyExpectedValue, ComponentPropertyOperator } from './gradingCriteria'
import { getComponentPropertyDefinition } from './componentPropertyCatalog'

/**
 * The topology-shape semantic kinds the Studio can author today: every kind whose
 * evidence comes from the *static* student topology (`evidenceMode: 'question'`).
 * The runtime-trace kinds (`stateTransition`, `stateSequence`) need discrete
 * matchers and land with QAS-012, so they are deliberately excluded here.
 */
export const AUTHORING_SEMANTIC_RULE_KINDS = [
  'componentPresence',
  'componentProperty',
  'placement',
  'guardedPath',
  'fanout',
  'storageFit',
  'forbidUnjustified',
  'stateTransition',
  'stateSequence'
] as const

export type AuthoringSemanticRuleKind = (typeof AUTHORING_SEMANTIC_RULE_KINDS)[number]

export const AUTHORING_STORAGE_FIT_ACCESS_PATTERNS = [
  'point-lookup',
  'time-series',
  'append-only-ledger',
  'transactional-relational',
  'search-index',
  'blob'
] as const satisfies readonly AccessPattern[]

/**
 * A tolerant flat draft: kind-specific fields stay optional so an incomplete rule
 * remains saveable. `compile` is the single strict boundary that rejects a draft
 * missing anything its kind requires.
 */
export interface AuthoringSemanticRuleDraft {
  id: string
  kind: AuthoringSemanticRuleKind
  points: number | null
  /** Optional learner-facing label preserved into the compiled semantic criterion. */
  description?: string
  /** Violating a hard-fail criterion zeroes the whole question (catalog: the trap). */
  hardFail?: boolean
  /** componentProperty parent; the parent supplies the component type. */
  parentId?: string
  property?: string
  propertyOperator?: ComponentPropertyOperator
  expected?: ComponentPropertyExpectedValue
  /** placement + forbidUnjustified target. */
  componentType?: string
  justifyId?: string
  /** placement optional "sits between" pair. */
  betweenFrom?: string
  betweenTo?: string
  notBefore?: string
  orderedPipeline?: string[]
  /** guardedPath source/guard/destination. */
  from?: string
  guard?: string
  to?: string
  /** fanout broker + minimum independent consumers + the wrong (queue) broker. */
  broker?: string
  minConsumers?: number | null
  forbiddenBroker?: string
  /** storageFit access pattern + accepted / partial-credit / anti-pattern stores. */
  accessPattern?: AccessPattern
  accept?: string[]
  partial?: string[]
  antiPattern?: string[]
  runtimeScope?: AuthoringRuntimeScope
  runtimeState?: string
  runtimeSource?: RequestStateTransitionSource
  runtimeNodeId?: string
  runtimeNodeType?: string
  runtimeReasonCode?: string
  whereCaseId?: string
  whereOutcomeStatus?: RequestOutcomeStatus
  whereTerminalNodeId?: string
  whereTerminalNodeType?: string
  minCount?: number | null
  maxCount?: number | null
  sequence?: AuthoringRuntimeMatcherDraft[]
  minMatches?: number | null
}

export type AuthoringRuntimeScope =
  | 'request'
  | 'delivery'
  | 'broker'
  | 'replication'
  | 'protocol'
  | 'idempotency'
  | 'commit-outcome'
  | 'lock'
  | 'reservation'

export interface AuthoringRuntimeMatcherDraft {
  scope: AuthoringRuntimeScope
  state: string
  source?: RequestStateTransitionSource
  nodeId?: string
  nodeType?: string
  reasonCode?: string
}

export type AuthoringSemanticRuleAction =
  | { type: 'add'; rule: AuthoringSemanticRuleDraft }
  | { type: 'update-kind'; id: string; kind: AuthoringSemanticRuleKind }
  | { type: 'update'; id: string; changes: Partial<Omit<AuthoringSemanticRuleDraft, 'id'>> }
  | { type: 'remove'; id: string }

export interface AuthoringSemanticRuleKindMeta {
  kind: AuthoringSemanticRuleKind
  label: string
  capability: AuthoringCapabilityDefinition
}

const CAPABILITY_BY_KIND = new Map<AuthoringSemanticRuleKind, AuthoringCapabilityDefinition>()
for (const kind of AUTHORING_SEMANTIC_RULE_KINDS) {
  const capability = SEMANTIC_AUTHORING_CAPABILITIES.find((definition) => definition.id === kind)
  if (!capability) throw new Error(`Missing "${kind}" semantic authoring capability`)
  CAPABILITY_BY_KIND.set(kind, capability)
}

export function getAuthoringSemanticRuleCapability(
  kind: AuthoringSemanticRuleKind
): AuthoringCapabilityDefinition {
  const capability = CAPABILITY_BY_KIND.get(kind)
  if (!capability) throw new Error(`Missing "${kind}" semantic authoring capability`)
  return capability
}

export const AUTHORING_SEMANTIC_RULE_KIND_META: readonly AuthoringSemanticRuleKindMeta[] =
  AUTHORING_SEMANTIC_RULE_KINDS.map((kind) => {
    const capability = getAuthoringSemanticRuleCapability(kind)
    return { kind, label: capability.label, capability }
  })

export function isAuthoringSemanticRuleKind(value: unknown): value is AuthoringSemanticRuleKind {
  return (
    typeof value === 'string' &&
    AUTHORING_SEMANTIC_RULE_KINDS.includes(value as AuthoringSemanticRuleKind)
  )
}

export function createAuthoringSemanticRule(
  kind: AuthoringSemanticRuleKind = 'guardedPath',
  id = 'semantic-rule'
): AuthoringSemanticRuleDraft {
  const base: AuthoringSemanticRuleDraft = { id, kind, points: 1 }
  switch (kind) {
    case 'componentPresence':
      return { ...base, minCount: 1 }
    case 'componentProperty':
      return { ...base, propertyOperator: 'equals' }
    case 'fanout':
      return { ...base, minConsumers: 2 }
    case 'storageFit':
      return { ...base, accessPattern: 'point-lookup', accept: [] }
    case 'stateTransition':
      return { ...base, runtimeScope: 'request', runtimeState: 'completed', minCount: 1 }
    case 'stateSequence':
      return {
        ...base,
        sequence: [
          { scope: 'request', state: 'generated' },
          { scope: 'request', state: 'completed' }
        ],
        minMatches: 1
      }
    default:
      return base
  }
}

function component(value: string | undefined): ComponentType | null {
  const trimmed = value?.trim()
  return trimmed ? (trimmed as ComponentType) : null
}

function propertyOperatorDescription(operator: ComponentPropertyOperator): string {
  switch (operator) {
    case 'equals':
      return 'equals'
    case 'notEquals':
      return 'does not equal'
    case 'atLeast':
      return 'is at least'
    case 'atMost':
      return 'is at most'
  }
}

/**
 * The strict boundary. Returns a runtime `SemanticCriterion` only when every field
 * the kind requires is present; otherwise `null` so callers can flag the draft.
 */
export function compileAuthoringSemanticRule(
  draft: AuthoringSemanticRuleDraft
): SemanticCriterion | null {
  const id = draft.id.trim()
  if (!id) return null
  const points = draft.points
  if (points === null || !Number.isFinite(points) || points <= 0) return null
  const hardFail = draft.hardFail ? { hardFail: true as const } : {}
  const authoredDescription = draft.description?.trim()
  const description = authoredDescription ? { description: authoredDescription } : {}
  const components = (values: string[] | undefined): ComponentType[] =>
    (values ?? [])
      .map((value) => component(value))
      .filter((value): value is ComponentType => value !== null)

  switch (draft.kind) {
    case 'componentPresence': {
      const componentType = component(draft.componentType)
      const minCount = draft.minCount ?? 1
      if (!componentType || !Number.isInteger(minCount) || minCount < 1) return null
      return {
        id,
        kind: 'componentPresence',
        componentType,
        minCount,
        points,
        description:
          authoredDescription ??
          `Include at least ${minCount} ${componentType} component${minCount === 1 ? '' : 's'}.`,
        ...hardFail
      }
    }
    case 'componentProperty': {
      const parentId = draft.parentId?.trim()
      const property = draft.property?.trim()
      const operator = draft.propertyOperator ?? 'equals'
      if (!parentId || !property || draft.expected === undefined) return null
      const definition = getComponentPropertyDefinition(property)
      if (!definition || !definition.operators.includes(operator)) return null
      if (definition.valueType !== typeof draft.expected) return null
      return {
        id,
        kind: 'componentProperty',
        parentId,
        property,
        operator,
        expected: draft.expected,
        points,
        description:
          authoredDescription ??
          `${definition.label} ${propertyOperatorDescription(operator)} ${String(draft.expected)}.`,
        ...hardFail
      }
    }
    case 'placement': {
      const componentType = component(draft.componentType)
      if (!componentType) return null
      const from = component(draft.betweenFrom)
      const to = component(draft.betweenTo)
      // "between" is optional, but if either endpoint is set both must be.
      if ((from && !to) || (to && !from)) return null
      return {
        id,
        kind: 'placement',
        componentType,
        points,
        ...description,
        ...hardFail,
        ...(from && to ? { between: [from, to] as [ComponentType, ComponentType] } : {}),
        ...(component(draft.notBefore) ? { notBefore: component(draft.notBefore)! } : {}),
        ...(components(draft.orderedPipeline).length > 0
          ? { orderedPipeline: components(draft.orderedPipeline) }
          : {})
      }
    }
    case 'guardedPath': {
      const from = component(draft.from)
      const guard = component(draft.guard)
      if (!from || !guard) return null
      const to = component(draft.to)
      return {
        id,
        kind: 'guardedPath',
        from,
        guard,
        points,
        ...description,
        ...hardFail,
        ...(to ? { to } : {})
      }
    }
    case 'fanout': {
      const broker = component(draft.broker)
      const minConsumers = draft.minConsumers
      if (!broker || minConsumers === null || minConsumers === undefined) return null
      if (!Number.isInteger(minConsumers) || minConsumers < 2) return null
      const forbiddenBroker = component(draft.forbiddenBroker)
      return {
        id,
        kind: 'fanout',
        broker,
        minConsumers,
        points,
        ...description,
        ...hardFail,
        ...(forbiddenBroker ? { forbiddenBroker } : {})
      }
    }
    case 'storageFit': {
      const accessPattern = draft.accessPattern
      if (!accessPattern) return null
      const accept = components(draft.accept)
      if (accept.length === 0) return null
      const partial = components(draft.partial)
      const antiPattern = components(draft.antiPattern)
      return {
        id,
        kind: 'storageFit',
        accessPattern,
        accept,
        points,
        ...description,
        ...hardFail,
        ...(partial.length > 0 ? { partial } : {}),
        ...(antiPattern.length > 0 ? { antiPattern } : {})
      }
    }
    case 'forbidUnjustified': {
      const componentType = component(draft.componentType)
      if (!componentType) return null
      return {
        id,
        kind: 'forbidUnjustified',
        componentType,
        points,
        ...description,
        ...hardFail,
        ...(draft.justifyId?.trim() ? { justifyId: draft.justifyId.trim() } : {})
      }
    }
    case 'stateTransition': {
      if (!draft.runtimeScope || !draft.runtimeState?.trim()) return null
      const candidate = {
        id,
        kind: 'stateTransition',
        points,
        ...description,
        ...hardFail,
        match: {
          scope: draft.runtimeScope,
          state: draft.runtimeState.trim(),
          ...(draft.runtimeSource ? { source: draft.runtimeSource } : {}),
          ...(draft.runtimeNodeId?.trim() ? { nodeId: draft.runtimeNodeId.trim() } : {}),
          ...(draft.runtimeNodeType?.trim() ? { nodeType: draft.runtimeNodeType.trim() } : {}),
          ...(draft.runtimeReasonCode?.trim() ? { reasonCode: draft.runtimeReasonCode.trim() } : {})
        },
        ...(draft.whereCaseId?.trim() ||
        draft.whereOutcomeStatus ||
        draft.whereTerminalNodeId?.trim() ||
        draft.whereTerminalNodeType?.trim()
          ? {
              where: {
                ...(draft.whereCaseId?.trim() ? { caseId: draft.whereCaseId.trim() } : {}),
                ...(draft.whereOutcomeStatus ? { outcomeStatus: draft.whereOutcomeStatus } : {}),
                ...(draft.whereTerminalNodeId?.trim()
                  ? { terminalNodeId: draft.whereTerminalNodeId.trim() }
                  : {}),
                ...(draft.whereTerminalNodeType?.trim()
                  ? { terminalNodeType: draft.whereTerminalNodeType.trim() }
                  : {})
              }
            }
          : {}),
        ...(draft.minCount !== null && draft.minCount !== undefined
          ? { minCount: draft.minCount }
          : {}),
        ...(draft.maxCount !== null && draft.maxCount !== undefined
          ? { maxCount: draft.maxCount }
          : {})
      }
      const parsed = SemanticCriterionSchema.safeParse(candidate)
      return parsed.success ? parsed.data : null
    }
    case 'stateSequence': {
      if (!draft.sequence || draft.sequence.length < 2) return null
      const candidate = {
        id,
        kind: 'stateSequence',
        points,
        ...description,
        ...hardFail,
        sequence: draft.sequence.map((matcher) => ({
          scope: matcher.scope,
          state: matcher.state.trim(),
          ...(matcher.source ? { source: matcher.source } : {}),
          ...(matcher.nodeId?.trim() ? { nodeId: matcher.nodeId.trim() } : {}),
          ...(matcher.nodeType?.trim() ? { nodeType: matcher.nodeType.trim() } : {}),
          ...(matcher.reasonCode?.trim() ? { reasonCode: matcher.reasonCode.trim() } : {})
        })),
        ...(draft.whereCaseId?.trim() ||
        draft.whereOutcomeStatus ||
        draft.whereTerminalNodeId?.trim() ||
        draft.whereTerminalNodeType?.trim()
          ? {
              where: {
                ...(draft.whereCaseId?.trim() ? { caseId: draft.whereCaseId.trim() } : {}),
                ...(draft.whereOutcomeStatus ? { outcomeStatus: draft.whereOutcomeStatus } : {}),
                ...(draft.whereTerminalNodeId?.trim()
                  ? { terminalNodeId: draft.whereTerminalNodeId.trim() }
                  : {}),
                ...(draft.whereTerminalNodeType?.trim()
                  ? { terminalNodeType: draft.whereTerminalNodeType.trim() }
                  : {})
              }
            }
          : {}),
        ...(draft.minMatches !== null && draft.minMatches !== undefined
          ? { minMatches: draft.minMatches }
          : {})
      }
      const parsed = SemanticCriterionSchema.safeParse(candidate)
      return parsed.success ? parsed.data : null
    }
  }
}

function resetForKind(
  rule: AuthoringSemanticRuleDraft,
  kind: AuthoringSemanticRuleKind
): AuthoringSemanticRuleDraft {
  const next = createAuthoringSemanticRule(kind, rule.id)
  return {
    ...next,
    points: rule.points,
    ...(rule.description !== undefined ? { description: rule.description } : {})
  }
}

export function authoringSemanticRuleReducer(
  rules: readonly AuthoringSemanticRuleDraft[],
  action: AuthoringSemanticRuleAction
): AuthoringSemanticRuleDraft[] {
  switch (action.type) {
    case 'add':
      return rules.some((rule) => rule.id === action.rule.id) ? [...rules] : [...rules, action.rule]
    case 'update-kind':
      return rules
        .filter((rule) => rule.parentId !== action.id)
        .map((rule) => (rule.id === action.id ? resetForKind(rule, action.kind) : rule))
    case 'update':
      return rules.map((rule) => {
        if (rule.id === action.id) return { ...rule, ...action.changes, id: rule.id }
        if (rule.parentId === action.id && action.changes.componentType !== undefined) {
          return { ...rule, property: undefined, expected: undefined }
        }
        return rule
      })
    case 'remove':
      return rules.filter((rule) => rule.id !== action.id && rule.parentId !== action.id)
  }
}
