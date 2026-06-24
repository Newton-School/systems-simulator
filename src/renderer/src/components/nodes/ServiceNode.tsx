import { memo, useCallback } from 'react'
import { NodeProps } from 'reactflow'
import { NodeHeader } from '@renderer/components/nodes/NodeHeader'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { MetricItem } from '@renderer/components/properties/MetricItem'
import { ServiceNodeData } from '@renderer/types/ui'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import BaseNode from '@renderer/components/nodes/BaseNode'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import { getEffectiveNodeStatus, getPreRunSummary, isRuntimeNodeInactive } from './nodePresentation'

const ServiceNode = ({ id, data, selected }: NodeProps<ServiceNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const { icon: IconComponent, theme } = resolveNodeConfig(data.templateId || data.iconKey)

  const handleLabelChange = useCallback(
    (newLabel: string) => {
      updateNodeData(id, { label: newLabel })
    },
    [id, updateNodeData]
  )

  const { throughput, errorRate, queueDepth, utilization, hasRuntime, active } = useNodeMetrics(id)
  const summaryMetrics = getPreRunSummary(data)
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
            {isInactive ? (
              <p className="text-[10px] text-nss-muted italic text-center py-2">
                No post-warmup traffic
              </p>
            ) : hasRuntime ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <MetricItem
                    label="Throughput"
                    value={throughput !== undefined ? String(throughput) : undefined}
                    unit="req/s"
                  />
                  <MetricItem
                    label="Error Rate"
                    value={errorRate !== undefined ? String(errorRate) : undefined}
                    unit="%"
                    textColor="text-nss-danger"
                  />
                  <MetricItem
                    label="Queue Depth"
                    value={queueDepth !== undefined ? String(queueDepth) : undefined}
                    unit="req"
                    textColor="text-nss-warning"
                  />
                </div>
                <ProgressBar label="Utilization" value={utilization} />
              </>
            ) : (
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
            )}
          </div>
        </div>
      )}
    </BaseNode>
  )
}

export default memo(ServiceNode)
