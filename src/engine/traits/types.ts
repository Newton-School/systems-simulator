import type { Request } from '../core/events'
import type { ComponentNode, EdgeDefinition } from '../core/types'
import type { ResolveRoute } from '../routing'

export type TraitHookName = 'beforeArrival' | 'beforeRouting' | 'filterRoutes'

export type TraitRoutingStrategyHint = 'round-robin'

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
