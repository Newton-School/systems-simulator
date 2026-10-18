import { memo, useState, useCallback } from 'react'
import { NodeProps, NodeResizer } from 'reactflow'
import { Cloud, Box, LucideIcon, LayoutGrid } from 'lucide-react'
import { useContainerLogic } from './container/useContainerLogic'
import { ContainerToolbar } from './container/ContainerToolbar'
import { ContainerHeader } from './container/ContainerHeader'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { useFlowStore } from '../canvas/hooks/useFlowStore'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import useStore from '@renderer/store/useStore'
import { NodeSymbol } from './symbols/NodeSymbol'
import { SYMBOL_BY_TEMPLATE } from './symbols/symbolRegistry'
import { InlineEditableLabel } from '@renderer/components/properties/InlineEditable'

const VPC_ICON_LOOKUP: Record<string, LucideIcon> = {
  cloud: Cloud,
  az: Box,
  subnet: LayoutGrid
}

const ContainerNode = ({ id, data, selected }: NodeProps) => {
  const { updateNodeData } = useFlowStore()
  const { isUngrouped, hasChildren, minSize, handleUngroup } = useContainerLogic(id)
  const { theme } = resolveNodeConfig(data.templateId || data.iconKey)
  const ContainerIcon = VPC_ICON_LOOKUP[data.iconKey] || Cloud
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const symbolMode = useStore((s) => s.displaySettings.nodeDisplayStyle === 'symbol')
  const symbol = symbolMode ? SYMBOL_BY_TEMPLATE[data.templateId] : undefined

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

  const symbolBoxStyle =
    symbol && !isSuccessState && !selected
      ? { borderColor: symbol.color, backgroundColor: `${symbol.color}14` }
      : undefined

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsMenuOpen(true)
      }}
      className="pointer-events-none relative w-full h-full group transition-all duration-200 ease-in-out"
      style={{ minWidth: minSize.width, minHeight: minSize.height }}
    >
      <ContainerToolbar
        isVisible={selected}
        isUngrouped={isUngrouped}
        hasChildren={hasChildren}
        onUngroup={handleUngroup}
      />

      <div
        className={`pointer-events-none absolute inset-0 rounded-xl border-2 border-dashed transition-all duration-300 overflow-visible ${getContainerStyle()}`}
        style={symbolBoxStyle}
      >
        {symbol ? (
          <div className="pointer-events-auto absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-2">
            <NodeSymbol templateId={data.templateId} size={32} />
            <InlineEditableLabel
              value={data.label || 'Region'}
              onSave={handleLabelChange}
              wrapLines={2}
              textClassName="min-w-0 text-xs font-semibold"
              inputClassName="min-w-[100px] text-xs font-semibold"
            />
            <div className="[&_button[title=Settings]]:hidden">
              <NodeSettingsMenu
                nodeId={id}
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                onToggle={(e) => {
                  e.stopPropagation()
                  setIsMenuOpen((prev) => !prev)
                }}
              />
            </div>
          </div>
        ) : (
          <ContainerHeader
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
          </ContainerHeader>
        )}
      </div>

      <NodeResizer
        color="rgb(var(--nss-primary))"
        isVisible={selected}
        minWidth={minSize.width}
        minHeight={minSize.height}
        lineClassName="pointer-events-auto"
        handleClassName="pointer-events-auto"
        handleStyle={{ width: 12, height: 12, borderRadius: '50%' }}
      />
    </div>
  )
}

export default memo(ContainerNode)
