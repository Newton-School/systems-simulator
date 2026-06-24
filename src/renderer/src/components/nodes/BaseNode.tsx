import React, { memo, useState, useCallback, useMemo } from 'react'
import UniversalHandle from '@renderer/components/ui/UniversalHandle'
import { NODE_OFFSETS, NODE_POSITIONS } from './nodeConstants'
import { NODE_HEALTH_STYLES, type NodeHealthStatus } from './nodePresentation'

export interface NodeMenuBag {
  isMenuOpen: boolean
  onMenuClose: () => void
  onMenuToggle: (e: React.MouseEvent) => void
}

interface BaseNodeProps {
  id?: string
  selected: boolean
  /** Controls the selection ring and hover accent color. Defaults to 'primary'. */
  selectionVariant?: 'primary' | 'warning'
  healthStatus?: NodeHealthStatus
  /**
   * Fully overrides the computed container className when provided.
   * Use this for node types with unique container styling (e.g. ComputeNode's
   * overload pulse), while still inheriting handles and context menu state.
   */
  containerClassName?: string
  /**
   * Render prop — receives menu state so the body can place NodeSettingsMenu
   * wherever it belongs visually (typically inside NodeHeader children).
   */
  children: (bag: NodeMenuBag) => React.ReactNode
}

const BaseNode = ({
  selected,
  selectionVariant = 'primary',
  healthStatus,
  containerClassName,
  children
}: BaseNodeProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsMenuOpen(true)
  }, [])

  const handleMenuClose = useCallback(() => setIsMenuOpen(false), [])

  const handleMenuToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsMenuOpen((prev) => !prev)
  }, [])

  const containerClasses = useMemo(() => {
    const base =
      'group relative w-64 bg-nss-surface rounded-lg transition-all duration-200 overflow-visible'
    const health = healthStatus ? NODE_HEALTH_STYLES[healthStatus] : null

    if (health) {
      return selected
        ? `${base} border ${health.border} ring-2 ${health.ring} ${health.shadow}`
        : `${base} border ${health.border} ${health.hoverBorder} ${health.shadow}`
    }

    if (selected) {
      return selectionVariant === 'warning'
        ? `${base} ring-2 ring-nss-warning shadow-[0_0_20px_rgba(245,158,11,0.3)]`
        : `${base} ring-2 ring-nss-primary shadow-[0_0_20px_rgba(59,130,246,0.3)]`
    }
    return selectionVariant === 'warning'
      ? `${base} border border-nss-border hover:border-nss-warning/30 shadow-xl`
      : `${base} border border-nss-border hover:border-nss-muted/30 shadow-xl`
  }, [healthStatus, selected, selectionVariant])

  const bag: NodeMenuBag = {
    isMenuOpen,
    onMenuClose: handleMenuClose,
    onMenuToggle: handleMenuToggle
  }

  return (
    <div onContextMenu={handleContextMenu} className={containerClassName ?? containerClasses}>
      {/* Connection handles — shared by all node types */}
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

      {/* Node body — render prop receives menu state for placement in NodeHeader */}
      {children(bag)}
    </div>
  )
}

export default memo(BaseNode)
