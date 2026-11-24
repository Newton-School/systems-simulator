import useStore from '@renderer/store/useStore'
import { getClusterRates } from './replicationClusterSummary'

/** Group-level line under a collapsed cluster: size, then reads/s and writes/s after a run. */
export function ClusterSummaryChips({
  leaderId,
  followerIds
}: {
  leaderId: string
  followerIds: readonly string[]
}) {
  const liveMetricsVisible = useStore((state) => state.environmentProfile.visibility.liveMetrics)
  const resultsStale = useStore((state) => state.runtimeResultsStale)
  const metricsByNode = useStore((state) => state.simulationMetricsByNode)
  const consistency = useStore((state) => state.lastRunOutput?.consistency)
  const windowMs = useStore((state) => state.edgeFlowRunConfig?.simulationDurationMs ?? 0)
  const rates =
    liveMetricsVisible && !resultsStale
      ? getClusterRates(leaderId, followerIds, metricsByNode, consistency, windowMs)
      : null

  return (
    <div className="pointer-events-none flex flex-col items-center gap-0.5">
      <span className="whitespace-nowrap rounded-full border border-nss-info/40 bg-nss-info/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-nss-info">
        Cluster of {followerIds.length + 1} · 1 leader · {followerIds.length} follower
        {followerIds.length === 1 ? '' : 's'}
      </span>
      {rates && (
        <span className="whitespace-nowrap rounded-full border border-nss-border bg-nss-panel px-1.5 py-0.5 text-[9px] font-semibold leading-none text-nss-text">
          {Math.round(rates.writesPerSec).toLocaleString()} writes/s ·{' '}
          {Math.round(rates.readsPerSec).toLocaleString()} reads/s
        </span>
      )}
    </div>
  )
}
