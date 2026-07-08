import type { ComponentType } from '../core/types'

/**
 * Observability is a separate plane: telemetry must never compete with real
 * downstream targets for sync route selection, and must never block or add
 * latency to the request path. Unlike the other traits, this isn't
 * expressible as a NodeBehaviourTrait hook on the *source* node — any node
 * type can emit telemetry — so RoutingTable applies it directly by
 * inspecting each edge's target type.
 */
export const OBSERVABILITY_COMPONENT_TYPES = [
  'centralized-logging',
  'distributed-tracing',
  'metrics-store',
  'alerting-hook',
  'dashboard',
  'rum-monitoring',
  'profiling-service',
  'safety-observability-mesh'
] as const satisfies readonly ComponentType[]

const OBSERVABILITY_COMPONENT_TYPE_SET = new Set<ComponentType>(OBSERVABILITY_COMPONENT_TYPES)

export function isObservabilityComponentType(type: ComponentType): boolean {
  return OBSERVABILITY_COMPONENT_TYPE_SET.has(type)
}
