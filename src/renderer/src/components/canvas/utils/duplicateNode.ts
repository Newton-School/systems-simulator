import type { Edge, Node } from 'reactflow'
import { buildClipboardSelection, materializeClipboardSelection } from '../hooks/useCopyPaste'

const DUPLICATE_OFFSET_PX = 48

/** The selected node copied beside itself, with its settings and no connections. */
export function duplicateSelectedNode(
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } | null {
  const selection = buildClipboardSelection(nodes, edges)
  if (selection.nodes.length !== 1) return null
  const origin = selection.nodes[0].absolutePosition
  return materializeClipboardSelection(
    { nodes: selection.nodes, edges: [] },
    { x: origin.x + DUPLICATE_OFFSET_PX, y: origin.y + DUPLICATE_OFFSET_PX }
  )
}
