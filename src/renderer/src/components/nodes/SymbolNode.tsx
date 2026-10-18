import React, { memo, useCallback, useState } from 'react'
import type { NodeProps } from 'reactflow'
import UniversalHandle from '@renderer/components/ui/UniversalHandle'
import { InlineEditableLabel } from '@renderer/components/properties/InlineEditable'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import { useClassroomNodeView } from '@renderer/hooks/useClassroom'
import type { StandardNodeData } from '@renderer/types/ui'
import { NODE_OFFSETS, NODE_POSITIONS } from './nodeConstants'
import { NodeSymbol } from './symbols/NodeSymbol'

const SYMBOL_SIZE = 72

/**
 * Architecture-diagram rendering of a node: the component's symbol and its name,
 * and nothing else. No metrics, lens, or health chrome.
 */
const SymbolNode = ({ id, data, selected }: NodeProps<StandardNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const classroomView = useClassroomNodeView(data)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleLabelChange = useCallback(
    (label: string) => updateNodeData(id, { label }),
    [id, updateNodeData]
  )
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsMenuOpen(true)
  }, [])
  const closeMenu = useCallback(() => setIsMenuOpen(false), [])
  const toggleMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsMenuOpen((open) => !open)
  }, [])

  return (
    <div
      onContextMenu={handleContextMenu}
      className="group relative flex w-32 flex-col items-center gap-1.5"
    >
      <div
        className={`relative flex items-center justify-center rounded-xl p-1 transition-shadow duration-150 ${
          selected ? 'ring-2 ring-nss-primary' : 'hover:ring-1 hover:ring-nss-border'
        }`}
        style={{ width: SYMBOL_SIZE + 8, height: SYMBOL_SIZE + 8 }}
      >
        <NodeSymbol templateId={data.templateId} size={SYMBOL_SIZE} />

        {NODE_POSITIONS.map((pos) => (
          <React.Fragment key={pos}>
            {NODE_OFFSETS.map((offset, i) => (
              <UniversalHandle
                key={`${pos}-${i}`}
                id={`${pos}-${i}`}
                position={pos}
                offset={offset}
              />
            ))}
          </React.Fragment>
        ))}

        {/* Right-click opens the menu; its kebab trigger stays hidden. */}
        <div className="absolute right-0 top-0 z-50 [&_button[title=Settings]]:hidden">
          <NodeSettingsMenu
            nodeId={id}
            isOpen={isMenuOpen}
            onClose={closeMenu}
            onToggle={toggleMenu}
          />
        </div>
      </div>

      <InlineEditableLabel
        value={classroomView?.label ?? (data.label || 'Service')}
        onSave={handleLabelChange}
        wrapLines={2}
        textClassName="w-full text-center text-xs font-semibold"
        inputClassName="w-full text-center text-xs font-semibold"
      />
    </div>
  )
}

export default memo(SymbolNode)
