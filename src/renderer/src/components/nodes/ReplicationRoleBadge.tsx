import type { AnyNodeData } from '@renderer/types/ui'
import useStore from '@renderer/store/useStore'
import { useReplicationView } from '@renderer/components/canvas/replicationViewStore'
import {
  getReplicationLagChip,
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
  const showLag = useReplicationView((state) => state.lag)
  const presentation = getReplicationRuntimePresentation(data, nodeId, metrics, consistency)
  if (!presentation) return null
  const lagChip = showLag ? getReplicationLagChip(data, nodeId, metrics, consistency) : null

  return (
    <span className="inline-flex flex-col items-center gap-0.5">
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
