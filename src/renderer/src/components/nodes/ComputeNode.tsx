import { memo, useCallback, useMemo } from 'react'
import { NodeProps } from 'reactflow'
import { ComputeNodeData } from '@renderer/types/ui'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import { useEffectiveSourceWorkload } from '@renderer/hooks/useEffectiveSourceWorkload'
import { useMetricLens } from '@renderer/hooks/useMetricLens'
import BaseNode from '@renderer/components/nodes/BaseNode'
import { InlineEditableLabel } from '@renderer/components/properties/InlineEditable'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import { NodeMetricContent } from './NodeMetricContent'
import {
  NODE_HEALTH_STYLES,
  getRuntimeCapacityStyle,
  getRuntimeReliabilityStatus,
  getIdentityChip,
  getLensCard,
  getPreRunMetric,
  isPreRunMetricLens,
  isRuntimeNodeInactive
} from './nodePresentation'

const ComputeNode = ({ id, data, selected }: NodeProps<ComputeNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const { icon: Icon, theme } = resolveNodeConfig(data.templateId || data.iconKey)
  const effectiveSourceWorkload = useEffectiveSourceWorkload(id, data)
  const identityChip = getIdentityChip(data, effectiveSourceWorkload)

  const handleLabelChange = useCallback(
    (newLabel: string) => {
      updateNodeData(id, { label: newLabel })
    },
    [id, updateNodeData]
  )

  const metrics = useNodeMetrics(id)
  const {
    arrived,
    completed,
    utilization,
    queueDepth,
    errorRate,
    postWarmupArrived,
    successLatencySamples,
    timeToErrorSamples,
    latencyWindowErrorRate,
    timeToErrorByCause,
    postWarmupRejected,
    postWarmupTimedOut,
    hasRuntime,
    active
  } = metrics
  const lens = useMetricLens()
  const lensCard = hasRuntime && lens !== 'traffic' ? getLensCard(lens, data, metrics) : null
  const preRunMetric = isPreRunMetricLens(lens) ? getPreRunMetric(lens, data) : null
  const reliabilityStatus = getRuntimeReliabilityStatus(
    'healthy',
    {
      postWarmupArrived,
      successLatencySamples,
      timeToErrorSamples,
      latencyWindowErrorRate,
      timeToErrorByCause,
      errorRate
    },
    hasRuntime
  )
  const capacityStyle = getRuntimeCapacityStyle({ utilization, queueDepth }, hasRuntime)
  const isInactive = isRuntimeNodeInactive(hasRuntime, active)
  const safeColor = theme.bg || 'bg-nss-primary'

  const containerClassName = useMemo(() => {
    const base = 'group relative min-w-[180px] bg-nss-surface rounded-lg border-2'
    if (isInactive) return `${base} border-nss-border opacity-40 grayscale`
    if (selected) {
      return `${base} ${capacityStyle.border} ring-2 ${capacityStyle.ring} ${capacityStyle.shadow}`
    }
    return `${base} ${capacityStyle.border} ${capacityStyle.shadow}`
  }, [capacityStyle, isInactive, selected])

  return (
    <BaseNode id={id} selected={selected} containerClassName={containerClassName}>
      {() => (
        <>
          <div className="flex items-center gap-3 p-3 border-b border-nss-border bg-nss-panel rounded-t-lg">
            <div
              className={`
                p-2 rounded-md flex items-center justify-center shrink-0
                ${hasRuntime ? capacityStyle.iconAccent : `bg-opacity-50 ${safeColor}`}
              `}
            >
              <Icon size={16} />
            </div>

            <div className="flex flex-col overflow-hidden w-full">
              <InlineEditableLabel
                value={data.label || 'Compute'}
                onSave={handleLabelChange}
                wrapLines={2}
                textClassName="text-xs font-bold uppercase tracking-wide w-full"
                inputClassName="text-xs font-bold uppercase tracking-wide w-full"
              />
              <span className="text-[10px] text-nss-muted px-1">{data.profile}</span>
            </div>
            <div
              className={`w-2 h-2 rounded-full transition-colors duration-300 shrink-0 ${NODE_HEALTH_STYLES[reliabilityStatus].dot}`}
              title={`Reliability: ${reliabilityStatus}`}
            />
          </div>

          <div className="p-3 space-y-3">
            <NodeMetricContent
              isInactive={isInactive}
              hasRuntime={hasRuntime}
              lens={lens}
              arrived={arrived}
              completed={completed}
              rejected={postWarmupRejected}
              timedOut={postWarmupTimedOut}
              lensCard={lensCard}
              identityChip={identityChip}
              preRunMetric={preRunMetric}
              inactiveClassName="text-[10px] text-nss-muted italic text-center py-1"
              identityClassName="min-w-0"
              runtimeClassName="grid grid-cols-2 gap-3"
              preRunClassName="grid grid-cols-1 gap-3"
            />
          </div>
        </>
      )}
    </BaseNode>
  )
}

export default memo(ComputeNode)
