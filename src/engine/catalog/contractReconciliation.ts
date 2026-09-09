import type { ComponentType } from '../core/types'
import type {
  CustomNodeDefinition,
  DependencyAction,
  DependencyTargetRole
} from './customDefinitions'

/**
 * Contract ⇄ graph reconciliation (spec §21). Advisory feedback only — this never
 * feeds grading. It flags dependencies a learner declared in the builder contract but
 * did not wire as an edge to a matching component. Grading still keys off actual edges
 * and runtime evidence; this only reconciles the (documentation-only) declared
 * contract with the real graph so the UI can nudge the learner.
 */

export interface ContractReconciliationFinding {
  kind: 'declared-unwired'
  operationId: string
  operationLabel: string
  target: string
  targetRole: DependencyTargetRole
  action: DependencyAction
  message: string
}

/**
 * Component types that satisfy each declared dependency role. Heuristic by design
 * (§21.2): unusual-but-valid backends may not be listed, so findings are suggestions,
 * never errors. `any` matches anything and is never checked. `service` accepts the
 * compute family.
 */
const ROLE_ACCEPTS: Record<DependencyTargetRole, readonly ComponentType[]> = {
  service: ['microservice', 'serverless-function', 'batch-worker', 'container', 'edge-compute'],
  cache: ['in-memory-cache', 'kv-store'],
  database: [
    'relational-db',
    'nosql-db',
    'columnar-db',
    'graph-db',
    'time-series-db',
    'kv-store',
    'event-sourcing-store'
  ],
  queue: ['queue', 'message-broker', 'event-bus'],
  stream: ['stream', 'pub-sub', 'event-bus'],
  'object-store': ['object-storage', 'archive-storage', 'data-lake'],
  'search-index': ['search-index', 'search-service'],
  'external-api': ['third-party-api-connector', 'payment-gateway', 'llm-gateway'],
  'auth-provider': ['auth-service', 'identity-provider', 'iam-rbac'],
  observability: [
    'centralized-logging',
    'metrics-store',
    'distributed-tracing',
    'dashboard',
    'alerting-hook'
  ],
  any: []
}

const ROLE_LABEL: Record<DependencyTargetRole, string> = {
  service: 'service',
  cache: 'cache',
  database: 'database',
  queue: 'queue',
  stream: 'stream',
  'object-store': 'object store',
  'search-index': 'search index',
  'external-api': 'external API',
  'auth-provider': 'auth provider',
  observability: 'observability backend',
  any: 'any node'
}

/** Component types reachable from `startNodeId` by following outgoing edges (excludes the start node). */
function reachableComponentTypes(
  startNodeId: string,
  edges: ReadonlyArray<{ source: string; target: string }>,
  componentTypeByNodeId: ReadonlyMap<string, ComponentType>
): Set<ComponentType> {
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source)
    if (list) list.push(edge.target)
    else outgoing.set(edge.source, [edge.target])
  }

  const reachedTypes = new Set<ComponentType>()
  const visited = new Set<string>([startNodeId])
  const queue = [...(outgoing.get(startNodeId) ?? [])]
  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    const type = componentTypeByNodeId.get(nodeId)
    if (type) reachedTypes.add(type)
    for (const next of outgoing.get(nodeId) ?? []) {
      if (!visited.has(next)) queue.push(next)
    }
  }
  return reachedTypes
}

/**
 * Returns one finding per declared dependency whose role has no reachable node of a
 * matching component type. Roles `any` (and empty accept lists) are skipped. Purely
 * advisory (spec §21).
 */
export function reconcileContractWithGraph(args: {
  definition: CustomNodeDefinition
  nodeId: string
  edges: ReadonlyArray<{ source: string; target: string }>
  componentTypeByNodeId: ReadonlyMap<string, ComponentType>
}): ContractReconciliationFinding[] {
  const { definition, nodeId, edges, componentTypeByNodeId } = args
  const reached = reachableComponentTypes(nodeId, edges, componentTypeByNodeId)
  const findings: ContractReconciliationFinding[] = []

  for (const operation of definition.operations) {
    for (const dependency of operation.dependencies) {
      const role = dependency.targetRole
      if (!role) continue
      const accepts = ROLE_ACCEPTS[role]
      if (accepts.length === 0) continue // `any` or unconstrained — nothing to check
      if (accepts.some((type) => reached.has(type))) continue // satisfied

      const label = operation.label?.trim() || operation.requestType.trim() || operation.id
      findings.push({
        kind: 'declared-unwired',
        operationId: operation.id,
        operationLabel: label,
        target: dependency.target,
        targetRole: role,
        action: dependency.action,
        message: `Operation "${label}" declares a ${ROLE_LABEL[role]} dependency (${dependency.action} → ${dependency.target}), but no edge from this node reaches a matching ${ROLE_LABEL[role]} node.`
      })
    }
  }

  return findings
}
