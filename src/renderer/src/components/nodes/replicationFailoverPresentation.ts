import type { AnyNodeData } from '@renderer/types/ui'
import type { ReplicationProjection, StatusWindow } from '../../../../engine/analysis/output'

export type FailoverState = { kind: 'unavailable'; seconds: number } | { kind: 'promoted' } | null

function isFollowerConfig(data: Pick<AnyNodeData, 'sim'>): boolean {
  const role = data.sim?.replicationRole
  return role === 'follower' || role === 'replica'
}

/**
 * Failover state of one replication member derived from run results only:
 * an outage window on the node, or an election that promoted this follower.
 */
export function getFailoverState(
  data: Pick<AnyNodeData, 'sim'>,
  nodeId: string | undefined,
  counters: Record<string, number> | undefined,
  statusWindows: readonly StatusWindow[] | undefined
): FailoverState {
  if (data.sim?.replicationEnabled !== true || !nodeId) return null
  const outage = (statusWindows ?? []).filter((window) => window.componentId === nodeId)
  if (outage.length > 0) {
    const ms = outage.reduce((sum, window) => sum + Math.max(0, window.endMs - window.startMs), 0)
    return { kind: 'unavailable', seconds: ms / 1000 }
  }
  if (isFollowerConfig(data) && (counters?.leaderElected ?? 0) > 0) return { kind: 'promoted' }
  return null
}

export interface QuorumChip {
  label: string
  title: string
  ok: boolean
  /** One entry per member: true when it is healthy and can acknowledge. */
  dots: boolean[]
}

/** Quorum acknowledgement progress for a quorum-acknowledged leader. */
export function getQuorumChip(
  data: Pick<AnyNodeData, 'sim'>,
  nodeId: string | undefined,
  counters: Record<string, number> | undefined,
  projections: readonly ReplicationProjection[] | undefined
): QuorumChip | null {
  if (data.sim?.replicationEnabled !== true || data.sim.writeAckPolicy !== 'quorum' || !nodeId) {
    return null
  }
  const cluster = projections?.find((projection) =>
    projection.members.some((member) => member.id === nodeId)
  )
  if (!cluster) return null
  const total = cluster.members.length
  const healthy = Math.min(total, Math.max(0, cluster.healthyReplicas))
  const lost = !cluster.hasQuorum || (counters?.replicationQuorumFailures ?? 0) > 0
  return {
    label: lost ? `✗ Quorum lost ${healthy}/${total}` : `✓ Acknowledged ${healthy}/${total}`,
    title: `Writes need ${cluster.quorumSize} of ${total} replicas to acknowledge. ${healthy} healthy at the end of the run.`,
    ok: !lost,
    dots: Array.from({ length: total }, (_, index) => index < healthy)
  }
}
