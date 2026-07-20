import { memo, useCallback } from 'react'
import { NodeProps } from 'reactflow'
import { NodeHeader } from '@renderer/components/nodes/NodeHeader'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { ServiceNodeData } from '@renderer/types/ui'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import { useEffectiveSourceWorkload } from '@renderer/hooks/useEffectiveSourceWorkload'
import { useMetricLens } from '@renderer/hooks/useMetricLens'
import BaseNode from '@renderer/components/nodes/BaseNode'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import { NodeMetricContent } from './NodeMetricContent'
import {
  getEffectiveNodeStatus,
  getIdentityChip,
  getLensCard,
  getPreRunMetric,
  isPreRunMetricLens,
  isRuntimeNodeInactive
} from './nodePresentation'

const ServiceNode = ({ id, data, selected }: NodeProps<ServiceNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const { icon: IconComponent, theme } = resolveNodeConfig(data.templateId || data.iconKey)
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
    errorRate,
    queueDepth,
    utilization,
    postWarmupRejected,
    postWarmupTimedOut,
    hasRuntime,
    active
  } = metrics
  const lens = useMetricLens()
  const lensCard = hasRuntime && lens !== 'traffic' ? getLensCard(lens, data, metrics) : null
  const preRunMetric = isPreRunMetricLens(lens) ? getPreRunMetric(lens, data) : null
  const status = getEffectiveNodeStatus(data, { utilization, errorRate, queueDepth }, hasRuntime)

  // After a simulation run, nodes that received zero post-warmup traffic are
  // visually muted so users can see at a glance which nodes stayed inactive.
  const isInactive = isRuntimeNodeInactive(hasRuntime, active)

  return (
    <BaseNode
      id={id}
      selected={selected}
      selectionVariant="primary"
      healthStatus={isInactive ? undefined : status}
    >
      {({ isMenuOpen, onMenuClose, onMenuToggle }) => (
        <div className={isInactive ? 'opacity-40 grayscale' : undefined}>
          <NodeHeader
            label={data.label || 'Service'}
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
            />
          </div>
        </div>
      )}
    </BaseNode>
  )
}

export default memo(ServiceNode)
