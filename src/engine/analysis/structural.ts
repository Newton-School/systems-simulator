import { inferStructuralRole } from '../catalog/componentSpecs'
import {
  componentTypeSatisfies,
  describeFamilyMismatch,
  describeSubtypeMatch
} from '../catalog/componentFamilies'
import { getInstanceCount } from '../core/types'
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

/** Nodes a rule naming `componentType` matches (family-aware: generic accepts subtypes). */
function nodesOfType(topology: TopologyJSON, componentType: ComponentType): ComponentNode[] {
  return topology.nodes.filter((node) => componentTypeSatisfies(node.type, componentType))
}

function countNodesOfType(topology: TopologyJSON, componentType: ComponentType): number {
  return nodesOfType(topology, componentType).length
}

function presentTypes(topology: TopologyJSON): Set<string> {
  return new Set(topology.nodes.map((node) => node.type))
}

/** Pass note when only subtypes satisfied a generic rule. */
function subtypeNote(topology: TopologyJSON, componentType: ComponentType): string | undefined {
  return describeSubtypeMatch(presentTypes(topology), componentType)
}

/** Fail note when a sibling / generic stands in for a specific rule's type. */
function mismatchNote(topology: TopologyJSON, componentType: ComponentType): string {
  const note = describeFamilyMismatch(presentTypes(topology), componentType)
  return note ? ` ${note}` : ''
}

/** " (counting its subtypes load-balancer-l7)" when subtypes were counted toward a generic cap. */
function countedSubtypesNote(topology: TopologyJSON, componentType: ComponentType): string {
  const subtypes = [
    ...new Set(
      nodesOfType(topology, componentType)
        .map((node) => node.type)
        .filter((type) => type !== componentType)
    )
  ].sort()
  return subtypes.length > 0
    ? ` (counting its subtype${subtypes.length === 1 ? '' : 's'} ${subtypes.join(', ')})`
    : ''
}

function withPassNote(...notes: (string | undefined)[]): { detail?: string } {
  const present = notes.filter((note): note is string => note !== undefined)
  return present.length > 0 ? { detail: present.join(' ') } : {}
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
          ? withPassNote(subtypeNote(topology, rule.componentType))
          : {
              detail: `expected at least ${minCount} ${rule.componentType} component${
                minCount === 1 ? '' : 's'
              }, found ${count}.${mismatchNote(topology, rule.componentType)}`
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
          sourceNode !== undefined &&
          targetNode !== undefined &&
          componentTypeSatisfies(sourceNode.type, rule.fromType) &&
          componentTypeSatisfies(targetNode.type, rule.toType) &&
          (rule.mode ? edge.mode === rule.mode : true)
        )
      })

      return {
        id: rule.id,
        description: rule.description,
        passed: matched,
        ...(matched
          ? withPassNote(subtypeNote(topology, rule.fromType), subtypeNote(topology, rule.toType))
          : {
              detail: `expected ${
                rule.mode ? `${rule.mode} ` : ''
              }edge from ${rule.fromType} to ${rule.toType}.${mismatchNote(
                topology,
                rule.fromType
              )}${mismatchNote(topology, rule.toType)}`
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
              }, found ${count}${countedSubtypesNote(topology, rule.componentType)}.`
            })
      }
    }

    case 'requires_redundancy': {
      const replicas = nodesOfType(topology, rule.componentType).reduce(
        (sum, node) => sum + getInstanceCount(node.resources),
        0
      )
      return {
        id: rule.id,
        description: rule.description,
        passed: replicas >= rule.minReplicas,
        ...(replicas >= rule.minReplicas
          ? withPassNote(subtypeNote(topology, rule.componentType))
          : {
              detail: `expected at least ${rule.minReplicas} total replica${
                rule.minReplicas === 1 ? '' : 's'
              } across ${rule.componentType}, found ${replicas}.${mismatchNote(
                topology,
                rule.componentType
              )}`
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
              }${countedSubtypesNote(topology, rule.componentType)}.`
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
      const fromNodeIds = nodesOfType(topology, rule.fromType)
        .map((node) => node.id)
        .sort()
      const toNodeIds = new Set(nodesOfType(topology, rule.toType).map((node) => node.id))

      if (fromNodeIds.length === 0) {
        return {
          id: rule.id,
          description: rule.description,
          passed: false,
          detail: `no source nodes of type ${rule.fromType} found for path check.${mismatchNote(
            topology,
            rule.fromType
          )}`
        }
      }

      if (toNodeIds.size === 0) {
        return {
          id: rule.id,
          description: rule.description,
          passed: false,
          detail: `no target nodes of type ${rule.toType} found for path check.${mismatchNote(
            topology,
            rule.toType
          )}`
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
          ? withPassNote(subtypeNote(topology, rule.fromType), subtypeNote(topology, rule.toType))
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
