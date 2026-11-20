import type { AnyNodeData } from '@renderer/types/ui'
import { isReplicationLink } from '../../../../engine/defaults/edgeDefaults'

export const REPLICATION_EDGE_PRESENTATION = {
  label: 'REPLICATION',
  stroke: 'rgb(var(--nss-info))',
  strokeDasharray: '8 6'
} as const

export function getReplicationEdgePresentation(
  source: AnyNodeData | undefined,
  target: AnyNodeData | undefined
): typeof REPLICATION_EDGE_PRESENTATION | null {
  return isReplicationLink(source, target) ? REPLICATION_EDGE_PRESENTATION : null
}
