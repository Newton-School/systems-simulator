import type { AnyNodeData } from '@renderer/types/ui'
import type { ReplicationTimelineEvent } from '../../../../engine/analysis/output'

export type ReplayNodeState =
  | { kind: 'down' }
  | { kind: 'electing'; remainingMs: number }
  | { kind: 'promoted' }
  | { kind: 'recovered' }
  | null

function followsLeader(data: Pick<AnyNodeData, 'sim'>, leaderId: string): boolean {
  const role = data.sim?.replicationRole
  if (data.sim?.replicationEnabled !== true || (role !== 'follower' && role !== 'replica')) {
    return false
  }
  return String(data.sim?.replicaMembers ?? '')
    .split(',')
    .map((id) => id.trim())
    .includes(leaderId)
}

/**
 * State of one replication member at replay time `tMs`, from the engine's
 * leader failover milestones. Returns null while the node is unaffected.
 */
export function getReplayNodeState(
  timeline: readonly ReplicationTimelineEvent[] | undefined,
  nodeId: string,
  data: Pick<AnyNodeData, 'sim'>,
  tMs: number
): ReplayNodeState {
  if (!timeline?.length) return null
  let state: ReplayNodeState = null
  for (const event of timeline) {
    if (event.atMs > tMs) break
    if (event.type === 'leader-down' && event.nodeId === nodeId) state = { kind: 'down' }
    else if (event.type === 'leader-recovered' && event.nodeId === nodeId) {
      state = { kind: 'recovered' }
    } else if (event.type === 'leader-elected' && event.nodeId === nodeId) {
      state = { kind: 'promoted' }
    }
  }
  if (state) return state

  // Followers wait through the election window of the leader they follow.
  const started = timeline.find(
    (event) =>
      event.type === 'election-started' && event.atMs <= tMs && followsLeader(data, event.nodeId)
  )
  if (!started) return null
  const elected = timeline.find(
    (event) =>
      event.type === 'leader-elected' &&
      event.replacedNodeId === started.nodeId &&
      event.atMs >= started.atMs
  )
  if (!elected) return null
  return tMs < elected.atMs ? { kind: 'electing', remainingMs: elected.atMs - tMs } : null
}

export interface ReplayBadge {
  label: string
  title: string
  className: string
  dotClassName: string
  motion: string
}

export function replayBadge(state: NonNullable<ReplayNodeState>, roleWord: string): ReplayBadge {
  switch (state.kind) {
    case 'down':
      return {
        label: `${roleWord} · DOWN`,
        title: 'The leader failed. Writes are rejected until a new leader is elected.',
        className: 'border-nss-danger/50 bg-nss-danger/10 text-nss-danger',
        dotClassName: 'bg-nss-danger',
        motion: ''
      }
    case 'electing':
      return {
        label: `ELECTING · ${(state.remainingMs / 1000).toFixed(1)} s`,
        title: 'The leader is down; followers are electing a new leader.',
        className: 'border-nss-warning/50 bg-nss-warning/10 text-nss-warning',
        dotClassName: 'bg-nss-warning',
        motion: ''
      }
    case 'promoted':
      return {
        label: 'FOLLOWER → LEADER',
        title: 'This follower was elected leader and now accepts writes.',
        className: 'border-nss-primary/50 bg-nss-primary/10 text-nss-primary',
        dotClassName: 'bg-nss-primary',
        motion: 'nss-role-promote'
      }
    case 'recovered':
      return {
        label: `${roleWord} · RECOVERED`,
        title:
          'The original leader is back. The simulator routes writes to it again; it does not demote it or model log catch-up.',
        className: 'border-nss-success/50 bg-nss-success/10 text-nss-success',
        dotClassName: 'bg-nss-success',
        motion: ''
      }
  }
}
