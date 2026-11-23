import type { AnyNodeData } from '@renderer/types/ui'
import { isReplicationLink } from '../../../../engine/defaults/edgeDefaults'

export const REPLICATION_EDGE_PRESENTATION = {
  label: 'REPLICATION',
  stroke: 'rgb(var(--nss-info))',
  strokeDasharray: '8 6',
  idleStrokeWidth: 1.75,
  idleOpacity: 0.62,
  packetRadius: 4.25
} as const

export function getReplicationEdgePresentation(
  source: AnyNodeData | undefined,
  target: AnyNodeData | undefined
): typeof REPLICATION_EDGE_PRESENTATION | null {
  return isReplicationLink(source, target) ? REPLICATION_EDGE_PRESENTATION : null
}

export function shouldShowInactiveEdgeState({
  runComplete,
  hasFlowRecord,
  isReplicationLink
}: {
  runComplete: boolean
  hasFlowRecord: boolean
  isReplicationLink: boolean
}): boolean {
  // Replication is executed by the datastore trait using replica membership,
  // rather than as ordinary request traffic on the visual leader→follower edge.
  // Missing request-flow telemetry therefore does not mean the replication link
  // was inactive.
  return runComplete && !hasFlowRecord && !isReplicationLink
}

export function replicationWriteRate(
  metrics: { traitCounters?: Record<string, number> } | undefined,
  observationWindowMs: number
): number {
  if (!Number.isFinite(observationWindowMs) || observationWindowMs <= 0) return 0
  const counters = metrics?.traitCounters ?? {}
  const committedWrites =
    Math.max(0, counters.replicationPrimaryAcks ?? 0) +
    Math.max(0, counters.replicationQuorumWrites ?? 0)
  return committedWrites / (observationWindowMs / 1000)
}
