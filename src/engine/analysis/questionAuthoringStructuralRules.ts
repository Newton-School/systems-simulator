import {
  getStructuralAuthoringCapability,
  type AuthoringCapabilityDefinition
} from './authoringCapabilities'
import type { ComponentCategory, ComponentType, EdgeDefinition } from '../core/types'
import type { StructuralRule } from './structural'

/** Every `STRUCTURAL_RULE` kind in the test-case catalog (§1). */
export const AUTHORING_STRUCTURAL_RULE_KINDS = [
  'requires_component',
  'requires_category',
  'requires_edge',
  'requires_path',
  'max_component_count',
  'requires_redundancy',
  'forbids_component',
  'requires_connected_graph',
  'requires_single_source',
  'min_node_count',
  'max_node_count'
] as const

export type AuthoringStructuralRuleKind = (typeof AUTHORING_STRUCTURAL_RULE_KINDS)[number]

export const AUTHORING_STRUCTURAL_EDGE_MODES = [
  'synchronous',
  'asynchronous',
  'streaming',
  'conditional'
] as const satisfies readonly NonNullable<EdgeDefinition['mode']>[]

export const AUTHORING_STRUCTURAL_CATEGORIES = [
  'compute',
  'network-and-edge',
  'storage-and-data',
  'messaging-and-streaming',
  'orchestration-and-infra',
  'security-and-identity',
  'observability',
  'devops-and-delivery',
  'data-infra-and-analytics'
] as const satisfies readonly ComponentCategory[]

/** Tolerant flat draft; `compile` is the strict boundary that rejects incomplete rules. */
export interface AuthoringStructuralRuleDraft {
  id: string
  kind: AuthoringStructuralRuleKind
  /** requires_component / max_component_count / requires_redundancy / forbids_component */
  componentType?: string
  /** requires_category */
  category?: ComponentCategory
  /** requires_edge / requires_path */
  fromType?: string
  toType?: string
  /** requires_edge (optional) */
  mode?: NonNullable<EdgeDefinition['mode']>
  /** requires_component / requires_category */
  minCount?: number | null
  /** max_component_count */
  maxCount?: number | null
  /** min_node_count / max_node_count */
  count?: number | null
  /** requires_redundancy */
  minReplicas?: number | null
}

export type AuthoringStructuralRuleAction =
  | { type: 'add'; rule: AuthoringStructuralRuleDraft }
  | { type: 'update-kind'; id: string; kind: AuthoringStructuralRuleKind }
  | { type: 'update'; id: string; changes: Partial<Omit<AuthoringStructuralRuleDraft, 'id'>> }
  | { type: 'remove'; id: string }

export interface AuthoringStructuralRuleKindMeta {
  kind: AuthoringStructuralRuleKind
  label: string
  capability: AuthoringCapabilityDefinition
}

const CAPABILITY_BY_KIND = new Map<AuthoringStructuralRuleKind, AuthoringCapabilityDefinition>()
for (const kind of AUTHORING_STRUCTURAL_RULE_KINDS) {
  const capability = getStructuralAuthoringCapability(kind)
  if (!capability) throw new Error(`Missing "${kind}" structural authoring capability`)
  CAPABILITY_BY_KIND.set(kind, capability)
}

export function getAuthoringStructuralRuleCapability(
  kind: AuthoringStructuralRuleKind
): AuthoringCapabilityDefinition {
  const capability = CAPABILITY_BY_KIND.get(kind)
  if (!capability) throw new Error(`Missing "${kind}" structural authoring capability`)
  return capability
}

export const AUTHORING_STRUCTURAL_RULE_KIND_META: readonly AuthoringStructuralRuleKindMeta[] =
  AUTHORING_STRUCTURAL_RULE_KINDS.map((kind) => ({
    kind,
    label: getAuthoringStructuralRuleCapability(kind).label,
    capability: getAuthoringStructuralRuleCapability(kind)
  }))

export function isAuthoringStructuralRuleKind(
  value: unknown
): value is AuthoringStructuralRuleKind {
  return (
    typeof value === 'string' &&
    AUTHORING_STRUCTURAL_RULE_KINDS.includes(value as AuthoringStructuralRuleKind)
  )
}

export function createAuthoringStructuralRule(
  kind: AuthoringStructuralRuleKind = 'requires_component',
  id = 'structural-rule'
): AuthoringStructuralRuleDraft {
  const base: AuthoringStructuralRuleDraft = { id, kind }
  switch (kind) {
    case 'requires_component':
    case 'requires_category':
      return { ...base, minCount: 1 }
    case 'max_component_count':
      return { ...base, maxCount: 1 }
    case 'requires_redundancy':
      return { ...base, minReplicas: 2 }
    case 'min_node_count':
      return { ...base, count: 4 }
    case 'max_node_count':
      return { ...base, count: 12 }
    default:
      return base
  }
}

/** Back-compat helper retained for the palette's default single-source rule. */
export function createAuthoringSingleSourceRule(
  id = 'single-source'
): AuthoringStructuralRuleDraft {
  return createAuthoringStructuralRule('requires_single_source', id)
}

function component(value: string | undefined): ComponentType | null {
  const trimmed = value?.trim()
  return trimmed ? (trimmed as ComponentType) : null
}

function positiveInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isInteger(value) || value < 0) return null
  return value
}

/** Human-readable description; the runtime `StructuralRule.description` is required. */
export function describeAuthoringStructuralRule(draft: AuthoringStructuralRuleDraft): string {
  const c = draft.componentType?.trim() || 'component'
  switch (draft.kind) {
    case 'requires_component':
      return `Include at least ${draft.minCount ?? 1} ${c}.`
    case 'requires_category':
      return `Include at least ${draft.minCount ?? 1} node in the ${draft.category ?? 'category'} category.`
    case 'requires_edge':
      return `Connect ${draft.fromType?.trim() || 'a source'} directly to ${draft.toType?.trim() || 'a target'}${draft.mode ? ` over a ${draft.mode} edge` : ''}.`
    case 'requires_path':
      return `Ensure a path from ${draft.fromType?.trim() || 'a source'} to ${draft.toType?.trim() || 'a target'}.`
    case 'max_component_count':
      return `Use at most ${draft.maxCount ?? 1} ${c}.`
    case 'requires_redundancy':
      return `Run ${c} with at least ${draft.minReplicas ?? 2} replicas.`
    case 'forbids_component':
      return `Do not use ${c}.`
    case 'requires_connected_graph':
      return 'Every node must be reachable (no orphans).'
    case 'requires_single_source':
      return 'Use exactly one traffic source.'
    case 'min_node_count':
      return `Use at least ${draft.count ?? 1} nodes.`
    case 'max_node_count':
      return `Use at most ${draft.count ?? 1} nodes.`
  }
}

export function compileAuthoringStructuralRule(
  draft: AuthoringStructuralRuleDraft
): StructuralRule | null {
  const id = draft.id.trim()
  if (!id) return null
  const description = describeAuthoringStructuralRule(draft)

  switch (draft.kind) {
    case 'requires_component': {
      const componentType = component(draft.componentType)
      if (!componentType) return null
      const minCount = draft.minCount ?? 1
      if (positiveInt(minCount) === null || minCount < 1) return null
      return { id, description, kind: 'requires_component', componentType, minCount }
    }
    case 'requires_category': {
      if (!draft.category) return null
      const minCount = draft.minCount ?? 1
      if (positiveInt(minCount) === null || minCount < 1) return null
      return { id, description, kind: 'requires_category', category: draft.category, minCount }
    }
    case 'requires_edge': {
      const fromType = component(draft.fromType)
      const toType = component(draft.toType)
      if (!fromType || !toType) return null
      return {
        id,
        description,
        kind: 'requires_edge',
        fromType,
        toType,
        ...(draft.mode ? { mode: draft.mode } : {})
      }
    }
    case 'requires_path': {
      const fromType = component(draft.fromType)
      const toType = component(draft.toType)
      if (!fromType || !toType) return null
      return { id, description, kind: 'requires_path', fromType, toType }
    }
    case 'max_component_count': {
      const componentType = component(draft.componentType)
      const maxCount = positiveInt(draft.maxCount)
      if (!componentType || maxCount === null) return null
      return { id, description, kind: 'max_component_count', componentType, maxCount }
    }
    case 'requires_redundancy': {
      const componentType = component(draft.componentType)
      const minReplicas = positiveInt(draft.minReplicas)
      if (!componentType || minReplicas === null || minReplicas < 1) return null
      return { id, description, kind: 'requires_redundancy', componentType, minReplicas }
    }
    case 'forbids_component': {
      const componentType = component(draft.componentType)
      if (!componentType) return null
      return { id, description, kind: 'forbids_component', componentType }
    }
    case 'requires_connected_graph':
      return { id, description, kind: 'requires_connected_graph' }
    case 'requires_single_source':
      return { id, description, kind: 'requires_single_source' }
    case 'min_node_count': {
      const count = positiveInt(draft.count)
      if (count === null || count < 1) return null
      return { id, description, kind: 'min_node_count', count }
    }
    case 'max_node_count': {
      const count = positiveInt(draft.count)
      if (count === null) return null
      return { id, description, kind: 'max_node_count', count }
    }
  }
}

function resetForKind(
  rule: AuthoringStructuralRuleDraft,
  kind: AuthoringStructuralRuleKind
): AuthoringStructuralRuleDraft {
  return createAuthoringStructuralRule(kind, rule.id)
}

export function authoringStructuralRuleReducer(
  rules: readonly AuthoringStructuralRuleDraft[],
  action: AuthoringStructuralRuleAction
): AuthoringStructuralRuleDraft[] {
  switch (action.type) {
    case 'add':
      return rules.some((rule) => rule.id === action.rule.id) ? [...rules] : [...rules, action.rule]
    case 'update-kind':
      return rules.map((rule) => (rule.id === action.id ? resetForKind(rule, action.kind) : rule))
    case 'update':
      return rules.map((rule) =>
        rule.id === action.id ? { ...rule, ...action.changes, id: rule.id } : rule
      )
    case 'remove':
      return rules.filter((rule) => rule.id !== action.id)
  }
}
