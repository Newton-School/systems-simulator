import { memo, useCallback, useMemo } from 'react'
import { NodeProps } from 'reactflow'
import { ComputeNodeData } from '@renderer/types/ui'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { MetricItem } from '@renderer/components/properties/MetricItem'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import BaseNode from '@renderer/components/nodes/BaseNode'
import { InlineEditableLabel } from '@renderer/components/properties/InlineEditable'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import {
  NODE_HEALTH_STYLES,
  getEffectiveNodeStatus,
  getPreRunSummary,
  isRuntimeNodeInactive
} from './nodePresentation'

const ComputeNode = ({ id, data, selected }: NodeProps<ComputeNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const { icon: Icon, theme } = resolveNodeConfig(data.templateId || data.iconKey)
  const summaryMetrics = getPreRunSummary(data)

  const handleLabelChange = useCallback(
    (newLabel: string) => {
      updateNodeData(id, { label: newLabel })
    },
    [id, updateNodeData]
  )

  const { utilization, queueDepth, errorRate, hasRuntime, active } = useNodeMetrics(id)
  const status = getEffectiveNodeStatus(data, { utilization, errorRate, queueDepth }, hasRuntime)
  const isOverloaded = status === 'critical'
  const isInactive = isRuntimeNodeInactive(hasRuntime, active)
  const safeColor = theme.bg || 'bg-nss-primary'

  const containerClassName = useMemo(() => {
    const base = 'group relative min-w-[180px] bg-nss-surface rounded-lg border-2'
    const statusStyle = NODE_HEALTH_STYLES[status]
    if (isInactive) return `${base} border-nss-border opacity-40 grayscale`
    if (selected) {
      return `${base} ${statusStyle.border} ring-2 ${statusStyle.ring} ${statusStyle.shadow}`
    }
    return `${base} ${statusStyle.border} ${statusStyle.shadow}`
  }, [isInactive, selected, status])

  return (
    <BaseNode id={id} selected={selected} containerClassName={containerClassName}>
      {() => (
        <>
          <div className="flex items-center gap-3 p-3 border-b border-nss-border bg-nss-panel rounded-t-lg">
            <div
              className={`
                p-2 rounded-md flex items-center justify-center shrink-0
                ${
                  isOverloaded
                    ? 'bg-nss-danger/10 border-nss-danger/30 text-nss-danger'
                    : `bg-opacity-50 ${safeColor}`
                }
              `}
            >
              <Icon size={16} />
            </div>

            <div className="flex flex-col overflow-hidden w-full">
              <InlineEditableLabel
                value={data.label || 'Compute'}
                onSave={handleLabelChange}
                textClassName="text-xs font-bold uppercase tracking-wide w-full"
                inputClassName="text-xs font-bold uppercase tracking-wide w-full"
              />
              <span className="text-[10px] text-nss-muted font-mono px-1">{data.profile}</span>
            </div>
            <div
              className={`w-2 h-2 rounded-full transition-colors duration-300 shrink-0 ${NODE_HEALTH_STYLES[status].dot}`}
              title={`Status: ${status}`}
            />
          </div>

          <div className="p-3 space-y-3">
            {isInactive ? (
              <p className="text-[10px] text-nss-muted italic text-center py-1">
                No post-warmup traffic
              </p>
            ) : hasRuntime ? (
              <>
                <ProgressBar label="Utilization" value={utilization} />
                <div className="flex items-center justify-between p-2 rounded bg-nss-bg border border-nss-border">
                  <span className="text-[10px] text-nss-muted font-medium">Queue Depth</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-nss-primary/20 text-nss-primary">
                    {Math.max(0, Math.round(queueDepth ?? 0))} reqs
                  </span>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {summaryMetrics.map((metric) => (
                  <MetricItem
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    unit={metric.unit}
                    textColor={metric.textColor}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </BaseNode>
  )
}

export default memo(ComputeNode)
