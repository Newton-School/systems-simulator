import type { AnyNodeData } from '@renderer/types/ui'
import useStore from '@renderer/store/useStore'
import { getReplicationRuntimePresentation } from './replicationRolePresentation'

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
  const presentation = getReplicationRuntimePresentation(data, nodeId, metrics, consistency)
  if (!presentation) return null

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-[0.08em] shadow-sm ${presentation.className}`}
      title={presentation.title}
      aria-label={presentation.title}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${presentation.dotClassName}`}
        aria-hidden="true"
      />
      {presentation.label}
    </span>
  )
}
