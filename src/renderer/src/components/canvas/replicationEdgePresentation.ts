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

export type RoutingPulseKind = 'write' | 'read' | 'replication' | null

function replicationRoleOf(data: AnyNodeData | undefined): 'leader' | 'follower' | null {
  if (data?.sim?.replicationEnabled !== true) return null
  const role = data.sim.replicationRole ?? 'leader'
  if (role === 'leader' || role === 'primary') return 'leader'
  if (role === 'follower' || role === 'replica') return 'follower'
  return null
}

/**
 * Which kind of traffic an edge carries in a read/write-split replication
 * group, from the node roles alone: callers send writes to the leader and
 * reads to followers; leader→follower links carry replication. Edges into a
 * leader with no followers (no split) stay uncoloured.
 */
export function getRoutingPulseKind(
  source: AnyNodeData | undefined,
  target: AnyNodeData | undefined
): RoutingPulseKind {
  if (isReplicationLink(source, target)) return 'replication'
  if (replicationRoleOf(source) !== null) return null
  const targetRole = replicationRoleOf(target)
  if (targetRole === 'follower') return 'read'
  if (targetRole === 'leader') {
    const members = String(target?.sim?.replicaMembers ?? '')
      .split(',')
      .filter((id) => id.trim()).length
    return members > 1 ? 'write' : null
  }
  return null
}
