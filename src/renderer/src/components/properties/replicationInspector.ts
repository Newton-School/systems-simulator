import type { AnyNodeData } from '@renderer/types/ui'
import type { ConsistencyReport } from '../../../../engine/traits/consistencyModel'
import { parseReplicaMemberIds } from './replicaMembers'

export type ReplicationMemberRole = 'leader' | 'follower' | 'unconfigured'

export interface ReplicationConfigSummaryModel {
  role: Exclude<ReplicationMemberRole, 'unconfigured'>
  memberCount: number
  leaderCount: number
  followerCount: number
  unavailableMemberCount: number
  behavior: string
  settingLabel: 'Write acknowledgement' | 'Replica lag'
  settingValue: string
  warning: string | null
}

export interface ReplicationResultMetric {
  label: string
  value: string
}

export interface ReplicationResultsSummaryModel {
  role: Exclude<ReplicationMemberRole, 'unconfigured'>
  status: string
  tone: 'healthy' | 'info' | 'warning'
  metrics: ReplicationResultMetric[]
  detail: string
}

type CanvasNode = { id: string; data: unknown }

function replicationRole(data: Partial<AnyNodeData> | undefined): ReplicationMemberRole {
  if (data?.sim?.replicationEnabled !== true) return 'unconfigured'
  const role = data.sim.replicationRole ?? 'leader'
  return role === 'follower' || role === 'replica' ? 'follower' : 'leader'
}

export function buildReplicationConfigSummary(
  nodeId: string,
  data: AnyNodeData,
  nodes: readonly CanvasNode[]
): ReplicationConfigSummaryModel | null {
  if (data.sim?.replicationEnabled !== true) return null

  const role = replicationRole(data)
  if (role === 'unconfigured') return null

  const memberIds = Array.from(new Set([nodeId, ...parseReplicaMemberIds(data.sim.replicaMembers)]))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const memberRoles = memberIds.map((id) => {
    const node = nodeById.get(id)
    return node ? replicationRole(node.data as Partial<AnyNodeData>) : 'unconfigured'
  })
  const leaderCount = memberRoles.filter((memberRole) => memberRole === 'leader').length
  const followerCount = memberRoles.filter((memberRole) => memberRole === 'follower').length
  const unavailableMemberCount = memberIds.filter((id) => !nodeById.has(id)).length

  let warning: string | null = null
  if (memberIds.length < 2) {
    warning = 'Add at least one follower to make this a replication group.'
  } else if (unavailableMemberCount > 0) {
    warning = `${unavailableMemberCount} configured member${unavailableMemberCount === 1 ? '' : 's'} cannot be found on the canvas.`
  } else if (leaderCount !== 1) {
    warning =
      leaderCount === 0
        ? 'This group has no leader. Assign one member to accept writes.'
        : `This group has ${leaderCount} leaders. A replication group should have exactly one.`
  } else if (followerCount === 0) {
    warning = 'This group has no follower to receive replicated changes.'
  }

  if (role === 'leader') {
    const writeAckPolicy = data.sim.writeAckPolicy === 'quorum' ? 'Quorum' : 'Leader only'
    return {
      role,
      memberCount: memberIds.length,
      leaderCount,
      followerCount,
      unavailableMemberCount,
      behavior: `Accepts writes and publishes changes to ${followerCount} follower${followerCount === 1 ? '' : 's'}.`,
      settingLabel: 'Write acknowledgement',
      settingValue: writeAckPolicy,
      warning
    }
  }

  const lag = Number(data.sim.replicationLagMs)
  return {
    role,
    memberCount: memberIds.length,
    leaderCount,
    followerCount,
    unavailableMemberCount,
    behavior: 'Serves reads, rejects writes, and applies changes received from the leader.',
    settingLabel: 'Replica lag',
    settingValue: `${Number.isFinite(lag) && lag >= 0 ? lag : 0} ms`,
    warning
  }
}

function count(value: number | undefined): number {
  return Math.max(0, Math.round(value ?? 0))
}

export function buildReplicationResultsSummary({
  nodeId,
  data,
  traitCounters,
  consistency
}: {
  nodeId: string
  data: AnyNodeData
  traitCounters?: Record<string, number>
  consistency?: ConsistencyReport
}): ReplicationResultsSummaryModel | null {
  if (data.sim?.replicationEnabled !== true) return null
  const role = replicationRole(data)
  if (role === 'unconfigured') return null
  const counters = traitCounters ?? {}

  if (role === 'leader') {
    const committedWrites =
      count(counters.replicationPrimaryAcks) + count(counters.replicationQuorumWrites)
    const quorumFailures = count(counters.replicationQuorumFailures)
    const failoverRejects = count(counters.replicationFailoverRejects)
    const promotions = count(counters.replicationLeaderPromotions)
    const affectedWrites = quorumFailures + failoverRejects
    return {
      role,
      status:
        affectedWrites > 0
          ? `${affectedWrites.toLocaleString()} write${affectedWrites === 1 ? '' : 's'} affected`
          : committedWrites > 0
            ? 'Replication healthy'
            : 'No writes observed',
      tone: affectedWrites > 0 ? 'warning' : committedWrites > 0 ? 'healthy' : 'info',
      metrics: [
        { label: 'Committed writes', value: committedWrites.toLocaleString() },
        {
          label: 'Acknowledgement',
          value: data.sim.writeAckPolicy === 'quorum' ? 'Quorum' : 'Leader only'
        },
        { label: 'Quorum failures', value: quorumFailures.toLocaleString() },
        { label: 'Leader promotions', value: promotions.toLocaleString() }
      ],
      detail:
        affectedWrites > 0
          ? 'Some writes could not complete while quorum or failover was unavailable.'
          : committedWrites > 0
            ? 'Committed writes were published to the configured replication group.'
            : 'Run a workload containing writes to observe replication activity.'
    }
  }

  const nodeReport = consistency?.nodes.find((node) => node.nodeId === nodeId)
  const reads = count(nodeReport?.reads ?? counters.replicationReplicaReads)
  const staleReads = count(nodeReport?.staleReads)
  const catchUpWaits = count(nodeReport?.catchUpWaits)
  const stalePercent = reads > 0 ? (staleReads / reads) * 100 : 0
  const configuredLag = Number(data.sim.replicationLagMs)
  const lagMs = nodeReport?.replicationLagMs ?? (Number.isFinite(configuredLag) ? configuredLag : 0)
  return {
    role,
    status:
      reads === 0
        ? 'No replica reads observed'
        : staleReads > 0
          ? 'Replica served stale reads'
          : 'Replica reads up to date',
    tone: reads === 0 ? 'info' : staleReads > 0 ? 'warning' : 'healthy',
    metrics: [
      { label: 'Replica reads', value: reads.toLocaleString() },
      {
        label: 'Stale reads',
        value: `${staleReads.toLocaleString()}${reads > 0 ? ` · ${stalePercent.toFixed(1)}%` : ''}`
      },
      { label: 'Configured lag', value: `${lagMs.toLocaleString()} ms` },
      { label: 'Catch-up waits', value: catchUpWaits.toLocaleString() }
    ],
    detail:
      staleReads > 0
        ? 'These reads returned an older committed version while the follower was behind the leader.'
        : reads > 0
          ? 'This follower served reads without returning an older tracked version.'
          : 'Route read traffic to this follower to observe replica behavior.'
  }
}
