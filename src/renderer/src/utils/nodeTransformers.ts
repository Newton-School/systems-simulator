import { Node, Edge } from 'reactflow'
import type { ScenarioState } from '@renderer/types/ui'
import type { CanvasAnnotation } from '@renderer/types/annotations'

// --- Types ---
export type NestedNode = Node & {
  nodes?: NestedNode[]
}

export type NestedFileData = {
  nodes: NestedNode[]
  edges: Edge[]
  scenario?: ScenarioState
  /** Teaching marks are presentation-only and never enter the simulation topology. */
  annotations?: CanvasAnnotation[]
}

// --- Transformers ---

/**
 * Converts a Nested JSON structure (Tree) into a Flat Array for React Flow.
 * Handles recursion, parent linking, and z-index layering.
 */
const convertNestedToFlat = (nestedNodes: NestedNode[], parentId?: string): Node[] => {
  const flatList: Node[] = []

  nestedNodes.forEach((node) => {
    // Destructure to separate children from node data
    const { nodes: children, ...nodeData } = node

    // Create the Flat Node
    const currentNode: Node = {
      ...nodeData,
      parentNode: parentId,
      extent: parentId ? 'parent' : undefined, // Trap child in parent
      zIndex: parentId ? 10 : 0, // Layer child above parent
      expandParent: false // Prevent auto-resizing bugs
    }

    flatList.push(currentNode)

    // Recursively flatten children
    if (children && children.length > 0) {
      const flatChildren = convertNestedToFlat(children, currentNode.id)
      flatList.push(...flatChildren)
    }
  })

  return flatList
}

/**
 * Converts a Flat Array from React Flow into a Nested JSON structure (Tree).
 * Useful for saving clean, hierarchical data.
 */
const convertFlatToNested = (flatNodes: Node[]): NestedNode[] => {
  const nodeMap = new Map<string, NestedNode>()
  const nestedNodes: NestedNode[] = []

  //Initialize Map with copies of nodes (prevents mutation)
  flatNodes.forEach((node) => {
    nodeMap.set(node.id, { ...node, nodes: [] })
  })

  //Reconstruct the Tree
  flatNodes.forEach((node) => {
    const current = nodeMap.get(node.id)!
    const parentId = node.parentNode

    if (parentId && nodeMap.has(parentId)) {
      //It's a child: Attach to parent
      const parent = nodeMap.get(parentId)!

      //Clean up: Remove internal React Flow props from the saved JSON
      const { parentNode, ...cleanNode } = current
      void parentNode

      parent.nodes = parent.nodes || []
      parent.nodes.push(cleanNode as NestedNode)
    } else {
      // It's a root node
      nestedNodes.push(current)
    }
  })

  return nestedNodes
}

export { convertFlatToNested, convertNestedToFlat }
