import ServiceNode from '../../nodes/ServiceNode'
import VpcNode from '../../nodes/VpcNode'
import ComputeNode from '../../nodes/ComputeNode'
import SecurityNode from '../../nodes/SecurityNode'
import TextLabelNode from '../../nodes/TextLabelNode'
import { PacketEdge } from '@renderer/components/canvas/PacketEdge'
import { TEXT_LABEL_NODE_TYPE } from '../../../../../engine/catalog/canvasAnnotations'

export const GRID_COLOR = '#2A303C'

export const nodeTypes = {
  serviceNode: ServiceNode,
  vpcNode: VpcNode,
  securityNode: SecurityNode,
  computeNode: ComputeNode,
  [TEXT_LABEL_NODE_TYPE]: TextLabelNode
}

// Module-level constants (stable identity for the life of the module) so React
// Flow never sees a new nodeTypes/edgeTypes object — this is React Flow's own
// recommendation and avoids warning #002 even when the canvas remounts (it is
// lazy-loaded), which a per-component useMemo would not.
export const edgeTypes = {
  packet: PacketEdge
}

export const defaultEdgeOptions = {
  type: 'packet',
  animated: true,
  style: { stroke: '#94A3B8', strokeWidth: 2 }
}
