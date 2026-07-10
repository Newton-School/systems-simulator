import { memo, useState, useCallback } from 'react'
import { NodeProps, NodeResizer } from 'reactflow'
import { Cloud, Box, LucideIcon, LayoutGrid } from 'lucide-react'
import { useVpcLogic } from './vpc/useVpcLogic'
import { VpcToolbar } from './vpc/VpcToolbar'
import { VpcHeader } from './vpc/VpcHeader'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { useFlowStore } from '../canvas/hooks/useFlowStore'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'

const VPC_ICON_LOOKUP: Record<string, LucideIcon> = {
  cloud: Cloud,
  az: Box,
  subnet: LayoutGrid
}

const VpcNode = ({ id, data, selected }: NodeProps) => {
  const { updateNodeData } = useFlowStore()
  const { isUngrouped, hasChildren, minSize, handleUngroup } = useVpcLogic(id)
  const { theme } = resolveNodeConfig(data.templateId || data.iconKey)
  const ContainerIcon = VPC_ICON_LOOKUP[data.iconKey] || Cloud
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleLabelChange = useCallback(
    (newLabel: string) => {
      updateNodeData(id, { label: newLabel })
    },
    [id, updateNodeData]
  )

  const isSuccessState = isUngrouped && !hasChildren

  const getContainerStyle = () => {
    if (isSuccessState)
      return 'border-nss-success bg-nss-success/5 shadow-[0_0_15px_rgba(var(--nss-success),0.15)]'
    if (selected)
      return 'border-[rgb(var(--nss-primary))] bg-[rgb(var(--nss-primary))]/10 shadow-[0_0_15px_rgba(var(--nss-primary),0.2)]'
    return 'border-[var(--nss-vpc-border)] bg-[rgba(var(--nss-vpc-bg),0.3)] hover:border-nss-muted transition-colors'
  }

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsMenuOpen(true)
      }}
      className="relative w-full h-full group transition-all duration-200 ease-in-out"
      style={{ minWidth: minSize.width, minHeight: minSize.height }}
    >
      <VpcToolbar
        isVisible={selected}
        isUngrouped={isUngrouped}
        hasChildren={hasChildren}
        onUngroup={handleUngroup}
      />

      <div
        className={`absolute inset-0 rounded-xl border-2 border-dashed transition-all duration-300 overflow-visible ${getContainerStyle()}`}
      >
        <VpcHeader
          label={data.label}
          isSuccessState={isSuccessState}
          icon={ContainerIcon}
          theme={theme}
          onLabelChange={handleLabelChange}
        >
          <NodeSettingsMenu
            nodeId={id}
            isOpen={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            onToggle={(e) => {
              e.stopPropagation()
              setIsMenuOpen((prev) => !prev)
            }}
          />
        </VpcHeader>
      </div>

      <NodeResizer
        color="rgb(var(--nss-primary))"
        isVisible={selected}
        minWidth={minSize.width}
        minHeight={minSize.height}
        handleStyle={{ width: 12, height: 12, borderRadius: '50%' }}
      />
    </div>
  )
}

export default memo(VpcNode)
