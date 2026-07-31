import { getComponentSpec } from '../catalog/componentSpecs'
import type { ComponentType } from '../core/types'

/**
 * Observability (and other fire-and-forget planes — queues, streams,
 * message brokers, background workers) must never compete with real
 * downstream targets for sync route selection, and must never block or add
 * latency to the request path. `asyncBoundary` on the component spec is
 * already the single source of truth for this — the routing-strategy
 * preview UI (`routingStrategyGraph.ts`) infers edge mode from the exact
 * same flag, so the engine and the UI must read the same signal or their
 * pictures of "is this async" diverge. Unlike the other traits, this isn't
 * expressible as a NodeBehaviourTrait hook on the *source* node — any node
 * type can emit telemetry — so RoutingTable applies it directly by
 * inspecting each edge's target type.
 */
export function isAsyncBoundaryComponentType(type: ComponentType): boolean {
  return getComponentSpec(type)?.asyncBoundary === true
}
