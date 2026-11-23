import type { AnyNodeData } from '@renderer/types/ui'
import type { NodeSimulationMetrics } from '@renderer/types/ui'
import type { SimulationOutput } from '../../../../engine/analysis/output'

export interface ReplicationRolePresentation {
  label: string
  title: string
  className: string
  dotClassName: string
}

export function getReplicationRuntimePresentation(
  data: Pick<AnyNodeData, 'sim'>,
  nodeId: string | undefined,
  metrics: NodeSimulationMetrics | undefined,
  consistency: SimulationOutput['consistency'] | undefined
): ReplicationRolePresentation | null {
  const role = getReplicationRolePresentation(data)
  if (!role || !nodeId || !metrics) return role

  const counters = metrics.traitCounters ?? {}
  const failureCount =
    (counters.replicationQuorumFailures ?? 0) + (counters.replicationFailoverRejects ?? 0)
  if (role.label === 'LEADER') {
    if (failureCount > 0) {
      return {
        label: 'LEADER · DEGRADED',
        title: `Replication leader: ${Math.round(failureCount).toLocaleString()} writes were affected by quorum or failover`,
        className: 'border-nss-warning/40 bg-nss-warning/10 text-nss-warning',
        dotClassName: 'bg-nss-warning'
      }
    }
    const committedWrites =
      (counters.replicationPrimaryAcks ?? 0) + (counters.replicationQuorumWrites ?? 0)
    if (committedWrites > 0) {
      return {
        ...role,
        label: 'LEADER · REPLICATING',
        title: `Replication leader: ${Math.round(committedWrites).toLocaleString()} committed writes published to the group`
      }
    }
    return role
  }

  const nodeReport = consistency?.nodes.find((node) => node.nodeId === nodeId)
  if ((nodeReport?.staleReads ?? 0) > 0) {
    return {
      label: 'FOLLOWER · STALE',
      title: `Replication follower: ${nodeReport?.staleReads.toLocaleString()} reads returned an older committed version`,
      className: 'border-nss-warning/40 bg-nss-warning/10 text-nss-warning',
      dotClassName: 'bg-nss-warning'
    }
  }
  if ((nodeReport?.catchUpWaits ?? 0) > 0) {
    return {
      label: 'FOLLOWER · CATCHING UP',
      title: `Replication follower: ${nodeReport?.catchUpWaits.toLocaleString()} reads waited for replication catch-up`,
      className: 'border-nss-info/40 bg-nss-info/10 text-nss-info',
      dotClassName: 'bg-nss-info'
    }
  }
  if ((nodeReport?.reads ?? counters.replicationReplicaReads ?? 0) > 0) {
    return {
      ...role,
      label: 'FOLLOWER · SERVING',
      title: `Replication follower: ${Math.round(nodeReport?.reads ?? counters.replicationReplicaReads ?? 0).toLocaleString()} reads served without observed staleness`
    }
  }
  return role
}

export function getReplicationRolePresentation(
  data: Pick<AnyNodeData, 'sim'>
): ReplicationRolePresentation | null {
  if (data.sim?.replicationEnabled !== true) return null

  const role = data.sim.replicationRole ?? 'leader'
  if (role === 'leader' || role === 'primary') {
    return {
      label: 'LEADER',
      title: 'Replication leader: accepts writes and publishes changes to followers',
      className: 'border-nss-primary/40 bg-nss-primary/10 text-nss-primary',
      dotClassName: 'bg-nss-primary'
    }
  }
  if (role === 'follower' || role === 'replica') {
    return {
      label: 'FOLLOWER',
      title: 'Replication follower: serves reads and rejects writes',
      className: 'border-nss-success/40 bg-nss-success/10 text-nss-success',
      dotClassName: 'bg-nss-success'
    }
  }
  return null
}
