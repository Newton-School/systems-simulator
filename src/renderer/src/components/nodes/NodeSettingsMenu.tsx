import { useRef, useEffect, useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { ArrowRightFromLine, SquarePlus, Trash2 } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { useContextualAdd } from '../canvas/hooks/useContextualAdd'
import { contextualAddModesFor } from '../canvas/utils/contextualAdd'

import { MenuTrigger } from '../ui/MenuTrigger'
import { MenuHeader } from '../ui/MenuHeader'
import { MenuOption } from '../ui/MenuOption'

interface NodeSettingsMenuProps {
  nodeId: string
  isOpen: boolean
  onClose: () => void
  onToggle: (e: React.MouseEvent) => void
}

export const NodeSettingsMenu = ({ nodeId, isOpen, onClose, onToggle }: NodeSettingsMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { deleteElements } = useReactFlow()
  const addEnabled = useContextualAdd((state) => state.enabled)
  const openContextualAdd = useContextualAdd((state) => state.open)
  // A stable string so the menu only re-renders when the offered actions change.
  const addModes = useStore((state) =>
    contextualAddModesFor(state.nodes.find((node) => node.id === nodeId)).join(',')
  )
  const canAddChild = addEnabled && addModes.split(',').includes('child')
  const canAddConnected = addEnabled && addModes.split(',').includes('connected')

  const handleAdd = useCallback(
    (mode: 'child' | 'connected') => (e: React.MouseEvent) => {
      e.stopPropagation()
      onClose()
      openContextualAdd({ mode, anchorNodeId: nodeId })
    },
    [nodeId, onClose, openContextualAdd]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteElements({ nodes: [{ id: nodeId }] })
      onClose()
    },
    [nodeId, deleteElements, onClose]
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        (menuRef.current && menuRef.current.contains(target)) ||
        (triggerRef.current && triggerRef.current.contains(target))
      ) {
        return
      }
      onClose()
    }

    document.addEventListener('mousedown', handleClickOutside, { capture: true })
    return () => document.removeEventListener('mousedown', handleClickOutside, { capture: true })
  }, [isOpen, onClose])

  return (
    <div className="relative flex items-center">
      <MenuTrigger ref={triggerRef} isOpen={isOpen} onClick={onToggle} />

      {isOpen && (
        <div
          ref={menuRef}
          className="
            absolute right-0 top-full mt-2 w-48 
            bg-nss-panel border border-nss-border 
            rounded-lg shadow-xl
            overflow-hidden origin-top-right animate-in fade-in zoom-in-95 duration-100
            z-50
          "
          onClick={(e) => e.stopPropagation()}
        >
          <MenuHeader onClose={onClose} />

          <div className="p-1 flex flex-col gap-0.5">
            {canAddChild && (
              <MenuOption icon={SquarePlus} label="Add inside..." onClick={handleAdd('child')} />
            )}
            {canAddConnected && (
              <MenuOption
                icon={ArrowRightFromLine}
                label="Add connected..."
                onClick={handleAdd('connected')}
              />
            )}
            <MenuOption icon={Trash2} label="Delete" onClick={handleDelete} isDestructive />
          </div>
        </div>
      )}
    </div>
  )
}
