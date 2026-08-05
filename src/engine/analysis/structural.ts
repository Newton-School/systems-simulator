import { inferStructuralRole } from '../catalog/componentSpecs'
import type {
  ComponentCategory,
  ComponentNode,
  ComponentType,
  EdgeDefinition,
  TopologyJSON
} from '../core/types'

export const STRUCTURAL_RULES_VERSION = '1.0' as const

interface StructuralRuleBase {
  id: string
  description: string
}

export type StructuralRule =
  | (StructuralRuleBase & {
      kind: 'requires_component'
      componentType: ComponentType
      minCount?: number
    })
  | (StructuralRuleBase & {
      kind: 'requires_category'
      category: ComponentCategory
      minCount?: number
    })
  | (StructuralRuleBase & {
      kind: 'requires_edge'
      fromType: ComponentType
      toType: ComponentType
      mode?: EdgeDefinition['mode']
    })
  | (StructuralRuleBase & {
      kind: 'max_component_count'
      componentType: ComponentType
      maxCount: number
    })
  | (StructuralRuleBase & {
      kind: 'requires_redundancy'
      componentType: ComponentType
      minReplicas: number
    })
  | (StructuralRuleBase & {
      kind: 'forbids_component'
      componentType: ComponentType
    })
  | (StructuralRuleBase & {
      kind: 'requires_connected_graph'
    })
  | (StructuralRuleBase & {
      kind: 'requires_single_source'
    })
  | (StructuralRuleBase & {
      kind: 'min_node_count'
      count: number
    })
  | (StructuralRuleBase & {
      kind: 'max_node_count'
      count: number
    })
  | (StructuralRuleBase & {
      kind: 'requires_path'
      fromType: ComponentType
      toType: ComponentType
    })

export interface StructuralCheckResult {
  id: string
  description: string
  passed: boolean
  detail?: string
}

export interface StructuralEvaluation {
  version: typeof STRUCTURAL_RULES_VERSION
  checks: StructuralCheckResult[]
  passed: boolean
}

function resolvedRole(node: ComponentNode): ComponentNode['role'] | undefined {
  if (node.role) {
    return node.role
  }

  const inferred = inferStructuralRole(node.type)
  return inferred === 'composite' ? undefined : inferred
}

function countNodesOfType(topology: TopologyJSON, componentType: ComponentType): number {
  return topology.nodes.filter((node) => node.type === componentType).length
}

function countNodesInCategory(topology: TopologyJSON, category: ComponentCategory): number {
  return topology.nodes.filter((node) => node.category === category).length
}

function getDirectedAdjacency(topology: TopologyJSON): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const node of topology.nodes) {
    adjacency.set(node.id, [])
  }

  for (const edge of topology.edges) {
    adjacency.get(edge.source)?.push(edge.target)
  }

  return adjacency
}

function getUndirectedAdjacency(topology: TopologyJSON): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const node of topology.nodes) {
    adjacency.set(node.id, [])
  }

  for (const edge of topology.edges) {
    adjacency.get(edge.source)?.push(edge.target)
    adjacency.get(edge.target)?.push(edge.source)
  }

  return adjacency
}

function collectReachable(
  startNodeIds: readonly string[],
  adjacency: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>()
  const queue = [...startNodeIds]

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (visited.has(current)) {
      continue
    }

    visited.add(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor)
      }
    }
  }

  return visited
}

function sourceNodeIds(topology: TopologyJSON): string[] {
  const ids = new Set<string>()
  for (const node of topology.nodes) {
    if (resolvedRole(node) === 'source') {
      ids.add(node.id)
    }
  }

  if (
    typeof topology.workload?.sourceNodeId === 'string' &&
    topology.workload.sourceNodeId.length > 0
  ) {
    ids.add(topology.workload.sourceNodeId)
  }

  return [...ids].sort()
}

function evaluateRule(topology: TopologyJSON, rule: StructuralRule): StructuralCheckResult {
  switch (rule.kind) {
    case 'requires_component': {
      const minCount = rule.minCount ?? 1
      const count = countNodesOfType(topology, rule.componentType)
      return {
        id: rule.id,
        description: rule.description,
        passed: count >= minCount,
        ...(count >= minCount
          ? {}
          : {
              detail: `expected at least ${minCount} ${rule.componentType} component${
                minCount === 1 ? '' : 's'
              }, found ${count}.`
            })
      }
    }

    case 'requires_category': {
      const minCount = rule.minCount ?? 1
      const count = countNodesInCategory(topology, rule.category)
      return {
        id: rule.id,
        description: rule.description,
        passed: count >= minCount,
        ...(count >= minCount
          ? {}
          : {
              detail: `expected at least ${minCount} node${
                minCount === 1 ? '' : 's'
              } in category ${rule.category}, found ${count}.`
            })
      }
    }

    case 'requires_edge': {
      const matched = topology.edges.some((edge) => {
        const sourceNode = topology.nodes.find((node) => node.id === edge.source)
        const targetNode = topology.nodes.find((node) => node.id === edge.target)
        return (
          sourceNode?.type === rule.fromType &&
          targetNode?.type === rule.toType &&
          (rule.mode ? edge.mode === rule.mode : true)
        )
      })

      return {
        id: rule.id,
        description: rule.description,
        passed: matched,
        ...(matched
          ? {}
          : {
              detail: `expected ${
                rule.mode ? `${rule.mode} ` : ''
              }edge from ${rule.fromType} to ${rule.toType}.`
            })
      }
    }

    case 'max_component_count': {
      const count = countNodesOfType(topology, rule.componentType)
      return {
        id: rule.id,
        description: rule.description,
        passed: count <= rule.maxCount,
        ...(count <= rule.maxCount
          ? {}
          : {
              detail: `expected at most ${rule.maxCount} ${rule.componentType} component${
                rule.maxCount === 1 ? '' : 's'
              }, found ${count}.`
            })
      }
    }

    case 'requires_redundancy': {
      const replicas = topology.nodes
        .filter((node) => node.type === rule.componentType)
        .reduce((sum, node) => sum + (node.resources?.replicas ?? 1), 0)
      return {
        id: rule.id,
        description: rule.description,
        passed: replicas >= rule.minReplicas,
        ...(replicas >= rule.minReplicas
          ? {}
          : {
              detail: `expected at least ${rule.minReplicas} total replica${
                rule.minReplicas === 1 ? '' : 's'
              } across ${rule.componentType}, found ${replicas}.`
            })
      }
    }

    case 'forbids_component': {
      const count = countNodesOfType(topology, rule.componentType)
      return {
        id: rule.id,
        description: rule.description,
        passed: count === 0,
        ...(count === 0
          ? {}
          : {
              detail: `forbidden component ${rule.componentType} is present ${count} time${
                count === 1 ? '' : 's'
              }.`
            })
      }
    }

    case 'requires_connected_graph': {
      if (topology.nodes.length <= 1) {
        return { id: rule.id, description: rule.description, passed: true }
      }

      const adjacency = getUndirectedAdjacency(topology)
      const visited = collectReachable([topology.nodes[0].id], adjacency)
      const disconnected = topology.nodes
        .map((node) => node.id)
        .filter((nodeId) => !visited.has(nodeId))
        .sort()

      return {
        id: rule.id,
        description: rule.description,
        passed: disconnected.length === 0,
        ...(disconnected.length === 0
          ? {}
          : {
              detail: `disconnected node ids: ${disconnected.join(', ')}.`
            })
      }
    }

    case 'requires_single_source': {
      const ids = sourceNodeIds(topology)
      return {
        id: rule.id,
        description: rule.description,
        passed: ids.length === 1,
        ...(ids.length === 1
          ? {}
          : ids.length === 0
            ? { detail: 'expected exactly 1 source node, found 0.' }
            : { detail: `expected exactly 1 source node, found ${ids.length}: ${ids.join(', ')}.` })
      }
    }

    case 'min_node_count': {
      const count = topology.nodes.length
      return {
        id: rule.id,
        description: rule.description,
        passed: count >= rule.count,
        ...(count >= rule.count
          ? {}
          : {
              detail: `expected at least ${rule.count} total node${rule.count === 1 ? '' : 's'}, found ${count}.`
            })
      }
    }

    case 'max_node_count': {
      const count = topology.nodes.length
      return {
        id: rule.id,
        description: rule.description,
        passed: count <= rule.count,
        ...(count <= rule.count
          ? {}
          : {
              detail: `expected at most ${rule.count} total node${rule.count === 1 ? '' : 's'}, found ${count}.`
            })
      }
    }

    case 'requires_path': {
      const fromNodeIds = topology.nodes
        .filter((node) => node.type === rule.fromType)
        .map((node) => node.id)
        .sort()
      const toNodeIds = new Set(
        topology.nodes.filter((node) => node.type === rule.toType).map((node) => node.id)
      )

      if (fromNodeIds.length === 0) {
        return {
          id: rule.id,
          description: rule.description,
          passed: false,
          detail: `no source nodes of type ${rule.fromType} found for path check.`
        }
      }

      if (toNodeIds.size === 0) {
        return {
          id: rule.id,
          description: rule.description,
          passed: false,
          detail: `no target nodes of type ${rule.toType} found for path check.`
        }
      }

      const adjacency = getDirectedAdjacency(topology)
      const visited = collectReachable(fromNodeIds, adjacency)
      const hasPath = [...toNodeIds].some((nodeId) => visited.has(nodeId))

      return {
        id: rule.id,
        description: rule.description,
        passed: hasPath,
        ...(hasPath
          ? {}
          : { detail: `no directed path found from ${rule.fromType} to ${rule.toType}.` })
      }
    }
  }
}

export function evaluateStructuralRules(
  topology: TopologyJSON,
  rules: readonly StructuralRule[]
): StructuralEvaluation {
  const checks = rules.map((rule) => evaluateRule(topology, rule))
  return {
    version: STRUCTURAL_RULES_VERSION,
    checks,
    passed: checks.every((check) => check.passed)
  }
}
