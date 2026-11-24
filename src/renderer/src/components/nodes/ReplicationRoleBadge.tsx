import type { AnyNodeData } from '@renderer/types/ui'
import useStore from '@renderer/store/useStore'
import { useReplicationView } from '@renderer/components/canvas/replicationViewStore'
import { getReplayNodeState, replayBadge } from './replicationReplay'
import { getFailoverState, getQuorumChip } from './replicationFailoverPresentation'
import {
  getReplicationLagChip,
  getReplicationRateChip,
  getReplicationRuntimePresentation
} from './replicationRolePresentation'

export function ReplicationRoleBadge({
  data,
  nodeId
}: {
  data: Pick<AnyNodeData, 'sim'>
  nodeId?: string
}) {
  const liveMetricsVisible = useStore((state) => state.environmentProfile.visibility.liveMetrics)
  const resultsStale = useStore((state) => state.runtimeResultsStale)
  const metrics = useStore((state) =>
    liveMetricsVisible && !resultsStale && nodeId
      ? state.simulationMetricsByNode[nodeId]
      : undefined
  )
  const consistency = useStore((state) =>
    liveMetricsVisible && !resultsStale && nodeId ? state.lastRunOutput?.consistency : undefined
  )
  const statusWindows = useStore((state) =>
    liveMetricsVisible && !resultsStale ? state.lastRunOutput?.statusTimeline : undefined
  )
  const projections = useStore((state) =>
    liveMetricsVisible && !resultsStale ? state.lastRunOutput?.replicationProjection : undefined
  )
  const windowMs = useStore((state) => state.edgeFlowRunConfig?.simulationDurationMs ?? 0)
  const timeline = useStore((state) =>
    liveMetricsVisible && !resultsStale ? state.lastRunOutput?.replicationTimeline : undefined
  )
  const replayMs = useReplicationView((state) => state.replayMs)
  const showLag = useReplicationView((state) => state.lag)
  const clusterCollapsed = useReplicationView((state) => state.clusterCollapsed)
  const presentation = getReplicationRuntimePresentation(data, nodeId, metrics, consistency)
  if (!presentation) return null
  const replaying = replayMs !== null && timeline !== undefined
  const replayState =
    replaying && nodeId ? getReplayNodeState(timeline, nodeId, data, replayMs) : null
  // While replaying, the badge follows the replay clock instead of the end-of-run state.
  const failover = replaying
    ? null
    : getFailoverState(data, nodeId, metrics?.traitCounters, statusWindows)
  const quorum = getQuorumChip(data, nodeId, metrics?.traitCounters, projections)
  const roleWord = presentation.label.split(' ')[0]
  const badge = replayState
    ? replayBadge(replayState, roleWord)
    : failover?.kind === 'unavailable'
      ? {
          label: `${roleWord} · UNAVAILABLE`,
          title: `${roleWord === 'LEADER' ? 'Leader' : 'Follower'} was down for ${failover.seconds.toFixed(1)} s during the run.`,
          className: 'border-nss-danger/50 bg-nss-danger/10 text-nss-danger',
          dotClassName: 'bg-nss-danger',
          motion: ''
        }
      : failover?.kind === 'promoted'
        ? {
            label: 'FOLLOWER → LEADER',
            title: 'This follower was elected leader and now accepts writes.',
            className: 'border-nss-primary/50 bg-nss-primary/10 text-nss-primary',
            dotClassName: 'bg-nss-primary',
            motion: 'nss-role-promote'
          }
        : { ...presentation, motion: '' }
  const hiddenFollowers =
    roleWord === 'LEADER'
      ? Math.max(
          0,
          String(data.sim?.replicaMembers ?? '')
            .split(',')
            .filter((id) => id.trim()).length - 1
        )
      : 0
  const rateChip = getReplicationRateChip(data, nodeId, metrics, consistency, windowMs)
  const lagChip = showLag ? getReplicationLagChip(data, nodeId, metrics, consistency) : null

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-[0.08em] shadow-sm ${badge.className} ${badge.motion}`}
        title={badge.title}
        aria-label={badge.title}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${badge.dotClassName}`} aria-hidden="true" />
        {badge.label}
      </span>
      {clusterCollapsed && hiddenFollowers > 0 && (
        <span
          className="whitespace-nowrap rounded-full border border-nss-info/40 bg-nss-info/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-nss-info"
          title="The followers are hidden while the replication group is collapsed."
        >
          Cluster · +{hiddenFollowers} follower{hiddenFollowers === 1 ? '' : 's'}
        </span>
      )}
      {rateChip && (
        <span
          className="whitespace-nowrap rounded-full border border-nss-border bg-nss-panel px-1.5 py-0.5 text-[9px] font-semibold leading-none text-nss-text"
          title={rateChip.title}
        >
          {rateChip.label}
        </span>
      )}
      {quorum && (
        <span
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none ${
            quorum.ok
              ? 'border-nss-success/30 bg-nss-success/10 text-nss-success'
              : 'border-nss-danger/40 bg-nss-danger/10 text-nss-danger'
          }`}
          title={quorum.title}
        >
          <span className="inline-flex gap-0.5" aria-hidden="true">
            {quorum.dots.map((up, index) => (
              <span
                key={index}
                className={`h-1 w-1 rounded-full ${up ? 'bg-current nss-quorum-ack' : 'border border-current'}`}
                style={up ? { animationDelay: `${index * 140}ms` } : undefined}
              />
            ))}
          </span>
          {quorum.label}
        </span>
      )}
      {lagChip && (
        <span
          className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold leading-none ${lagChip.className}`}
          title={lagChip.title}
        >
          {lagChip.label}
        </span>
      )}
    </span>
  )
}
