import type { Request } from '../core/events'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { ComponentNode, ComponentType, EdgeDefinition, NodeState } from '../core/types'
import type { ResolveRoute } from '../routing'

export type TraitHookName = 'beforeArrival' | 'beforeRouting' | 'filterRoutes'

export type TraitRoutingStrategyHint = 'round-robin'
export type FieldPath = string
export type AccuracyClass = 'invariant' | 'default-override' | 'user-parameter' | 'not-simulated'
export type ConfigAltitude = 'primary' | 'advanced'
export type ConfigNoteTone = 'info' | 'locked'
export type ConfigCustomRenderer = 'default' | 'routing-rules' | 'health-preset'

export interface ConfigDisplayTransform {
  toDisplay: (rawValue: unknown, data: CanvasNodeDataV2) => unknown
  fromDisplay: (displayValue: unknown, data: CanvasNodeDataV2) => unknown
}

interface ConfigFieldBase {
  path: FieldPath
  label: string | ((data: CanvasNodeDataV2) => string)
  unit?: string | ((data: CanvasNodeDataV2) => string | undefined)
  why?: string
  altitude?: ConfigAltitude
  optional?: boolean
  accuracy?: AccuracyClass
  visible?: (data: CanvasNodeDataV2) => boolean
  displayAs?: ConfigDisplayTransform
  renderer?: ConfigCustomRenderer
  placeholder?: string | ((data: CanvasNodeDataV2) => string)
}

export type ConfigField =
  | (ConfigFieldBase & {
      type: 'slider'
      min: number
      max: number
    })
  | (ConfigFieldBase & {
      type: 'select'
      options: readonly string[] | ((data: CanvasNodeDataV2) => readonly string[])
    })
  | (ConfigFieldBase & {
      type: 'input'
      step?: number
    })
  | (ConfigFieldBase & {
      type: 'boolean'
      defaultValue?: boolean
    })

export interface ConfigSection {
  id: string
  title: string | ((data: CanvasNodeDataV2) => string)
  fields: readonly ConfigField[]
  note?: string | ((data: CanvasNodeDataV2) => string | null)
  noteTone?: ConfigNoteTone
}

export interface ConfigFragment {
  sections: readonly ConfigSection[]
}

export interface CapabilityDefault {
  path: FieldPath
  value: unknown
  rationale: string
}

export interface CapabilityIdentityChip {
  label: string
  value: string
}

export interface NodeCapabilityModule {
  name: string
  appliesTo?: readonly ComponentType[]
  appliesWhen?: (data: CanvasNodeDataV2) => boolean
  forbiddenOn?: {
    types: readonly ComponentType[]
    sectionTitle?: string
    lockedNote: string
  }
  hooks?: NodeBehaviourTrait
  config?: ConfigFragment
  defaults?:
    | readonly CapabilityDefault[]
    | ((componentType: ComponentType) => readonly CapabilityDefault[])
  metrics?: {
    counters?: readonly string[]
    rejectionReasons?: readonly string[]
  }
  presentation?: {
    identityChip?: (data: CanvasNodeDataV2) => CapabilityIdentityChip | null
  }
  honesty: {
    simulates: readonly string[]
    notModeled: readonly string[]
  }
}

/**
 * Per-node mutable state store, scoped to a single engine run. Traits that
 * need to remember something across calls (token buckets, cold-start
 * timers, circuit-breaker state) read/write through this instead of module
 * -level state, which would otherwise leak between concurrent/sequential
 * engine instances that reuse the same node IDs.
 */
export interface TraitStateStore {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
}

export interface TraitContext {
  node: ComponentNode
  request: Request
  clock: bigint
  random?: () => number
  state?: TraitStateStore
  nodeState?: NodeState
}

export interface TraitFilterRoutesContext extends TraitContext {
  candidates: ResolveRoute[]
  isTargetHealthy?: (nodeId: string) => boolean
  isEdgeHealthy?: (edge: EdgeDefinition) => boolean
}

export type BeforeArrivalDecision =
  | { action: 'continue'; payload?: Record<string, unknown> }
  | { action: 'handled'; latencyUs: bigint; payload?: Record<string, unknown> }
  | { action: 'rejected'; reason: string; payload?: Record<string, unknown> }

export type BeforeRoutingDecision =
  | { action: 'route'; payload?: Record<string, unknown> }
  | { action: 'complete'; payload?: Record<string, unknown> }
  | { action: 'rejected'; reason: string; payload?: Record<string, unknown> }
  | { action: 'reroute'; targetNodeId: string; payload?: Record<string, unknown> }

export type FilterRoutesDecision =
  | ResolveRoute[]
  | {
      routes: ResolveRoute[]
      decision?: string
      rejectionReason?: string
      payload?: Record<string, unknown>
    }

export interface NodeBehaviourTrait {
  name: string
  routingStrategyHint?: TraitRoutingStrategyHint
  beforeArrival?: (context: TraitContext) => BeforeArrivalDecision
  beforeRouting?: (context: TraitContext) => BeforeRoutingDecision
  filterRoutes?: (context: TraitFilterRoutesContext) => FilterRoutesDecision
}

export type TraitResolver = (node: ComponentNode) => readonly NodeBehaviourTrait[]
