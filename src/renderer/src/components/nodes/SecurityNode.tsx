import { memo, useCallback } from 'react'
import { NodeProps } from 'reactflow'
import { NodeHeader } from '@renderer/components/nodes/NodeHeader'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { MetricItem } from '@renderer/components/properties/MetricItem'
import { SecurityNodeData } from '@renderer/types/ui'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import { useMetricLens } from '@renderer/hooks/useMetricLens'
import BaseNode from '@renderer/components/nodes/BaseNode'
import { RuntimeNodeMetrics } from '@renderer/components/nodes/RuntimeNodeMetrics'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import { LensMetricCard } from './LensMetricCard'
import {
  getEffectiveNodeStatus,
  getIdentityChip,
  getLensCard,
  getPreRunSummary,
  isRuntimeNodeInactive
} from './nodePresentation'

const SecurityNode = ({ id, data, selected }: NodeProps<SecurityNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const { icon: IconComponent, theme } = resolveNodeConfig(data.templateId || data.iconKey)
  const identityChip = getIdentityChip(data)
  const summaryMetrics = getPreRunSummary(data)

  const handleLabelChange = useCallback(
    (newLabel: string) => {
      updateNodeData(id, { label: newLabel })
    },
    [id, updateNodeData]
  )

  const metrics = useNodeMetrics(id)
  const { arrived, completed, errorRate, queueDepth, utilization, hasRuntime, active } = metrics
  const lens = useMetricLens()
  const lensCard = hasRuntime && lens !== 'results' ? getLensCard(lens, data, metrics) : null
  const status = getEffectiveNodeStatus(data, { utilization, errorRate, queueDepth }, hasRuntime)
  const isInactive = isRuntimeNodeInactive(hasRuntime, active)

  return (
    <BaseNode
      id={id}
      selected={selected}
      selectionVariant="warning"
      healthStatus={isInactive ? undefined : status}
    >
      {({ isMenuOpen, onMenuClose, onMenuToggle }) => (
        <div className={isInactive ? 'opacity-40 grayscale' : undefined}>
          <NodeHeader
            label={data.label || 'Security Element'}
            icon={IconComponent}
            status={status}
            color={theme}
            onLabelChange={handleLabelChange}
          >
            <NodeSettingsMenu
              nodeId={id}
              isOpen={isMenuOpen}
              onClose={onMenuClose}
              onToggle={onMenuToggle}
            />
          </NodeHeader>

          <div className="p-4">
            {isInactive ? (
              <p className="text-[10px] text-nss-muted italic text-center py-2">
                No post-warmup traffic
              </p>
            ) : lens === 'results' && hasRuntime ? (
              <RuntimeNodeMetrics arrived={arrived} completed={completed} failureRate={errorRate} />
            ) : lensCard ? (
              <LensMetricCard card={lensCard} />
            ) : hasRuntime ? null : (
              <>
                {identityChip ? (
                  <div className="flex items-baseline gap-1.5 mb-3">
                    <span className="text-[10px] text-nss-muted uppercase tracking-wider font-semibold">
                      {identityChip.label}
                    </span>
                    <span className="font-mono text-xs text-nss-text">{identityChip.value}</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-4">
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
              </>
            )}
          </div>
        </div>
      )}
    </BaseNode>
  )
}

export default memo(SecurityNode)
