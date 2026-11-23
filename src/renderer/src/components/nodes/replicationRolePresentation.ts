import type { AnyNodeData } from '@renderer/types/ui'

export interface ReplicationRolePresentation {
  label: 'LEADER' | 'FOLLOWER'
  title: string
  className: string
  dotClassName: string
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
