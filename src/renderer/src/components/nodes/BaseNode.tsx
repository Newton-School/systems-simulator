import React, { memo, useState, useCallback, useMemo } from 'react'
import { Anchor, AlertTriangle, Lock, XCircle } from 'lucide-react'
import UniversalHandle from '@renderer/components/ui/UniversalHandle'
import useStore from '@renderer/store/useStore'
import { NODE_OFFSETS, NODE_POSITIONS } from './nodeConstants'
import { NODE_HEALTH_STYLES, type NodeHealthStatus } from './nodePresentation'
import type { NodeVisualStyle } from '@renderer/utils/liveVisualization'

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
   * Render prop - receives menu state so the body can place NodeSettingsMenu
   * wherever it belongs visually (typically inside NodeHeader children).
   */
  children: (bag: NodeMenuBag) => React.ReactNode
}

const STATUS_LABEL: Record<NodeVisualStyle['statusIcon'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failed: 'Failed'
}

/**
 * Live run overlay: a utilization-coloured accent, a waiting-room fill bar, and
 * a measured readout chip. Utilization and rps are time-weighted over the
 * trailing window; queue fill is the current level.
 */
const LiveNodeIndicator = ({ style }: { style: NodeVisualStyle }) => {
  const windowS = Math.round(style.windowMs / 100) / 10
  const title = [
    `${STATUS_LABEL[style.statusIcon]}.`,
    style.utilization !== null
      ? `${(style.utilization * 100).toFixed(1)}% busy, time-weighted over the last ${windowS}s of simulated time.`
      : 'No utilization measured yet.',
    style.throughputRps !== null ? `${style.throughputRps.toFixed(1)} requests/s completed.` : '',
    style.queueFillPercent !== null
      ? `Queue ${Math.round(style.queueFillPercent)}% full right now.`
      : 'Unbounded queue.'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-0 top-2 w-1 rounded-r"
        style={{ backgroundColor: style.color }}
      />
      {style.queueFillPercent !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 overflow-hidden rounded-b-lg bg-nss-border/40"
        >
          <div
            className="h-full transition-[width] duration-300"
            style={{ width: `${style.queueFillPercent}%`, backgroundColor: style.color }}
          />
        </div>
      )}
      {style.overlayText && (
        <div
          data-live-status={style.statusIcon}
          data-live-utilization={style.utilization ?? ''}
          title={title}
          className="absolute -bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border bg-nss-panel px-2 py-0.5 text-[10px] font-semibold leading-none text-nss-text shadow"
          style={{ borderColor: style.borderColor }}
        >
          {style.statusIcon === 'failed' ? (
            <XCircle size={10} style={{ color: style.color }} />
          ) : (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: style.color }}
            />
          )}
          {style.overlayText}
        </div>
      )}
    </>
  )
}

const BaseNode = ({
  id,
  selected,
  selectionVariant = 'primary',
  healthStatus,
  containerClassName,
  children
}: BaseNodeProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  // Scaffold provenance cues (EnvironmentProfile). A node is scaffold-provided if
  // its id is in the active question's scaffold; it is locked when the profile
  // disallows editing scaffold nodes.
  const isScaffoldNode = useStore((s) => (id ? s.scaffoldNodeIds.includes(id) : false))
  const canEditScaffoldNodes = useStore(
    (s) => s.environmentProfile.capabilities.canEditScaffoldNodes
  )
  const showScaffoldSource = useStore((s) => s.environmentProfile.visibility.scaffoldSourceNodes)
  const isScaffoldLocked = isScaffoldNode && !canEditScaffoldNodes
  const showScaffoldBadge = isScaffoldNode && (isScaffoldLocked || showScaffoldSource)

  // Single-point-of-failure marker from the most recent run (structural analysis).
  const spofReason = useStore((s) =>
    id
      ? (s.lastRunOutput?.singlePointsOfFailure?.find((f) => f.nodeId === id)?.reason ?? null)
      : null
  )
  const showSpofBadges = useStore((s) => s.displaySettings.showSpofBadges)

  // Live run styling (#70): measured, time-weighted values; null outside a run.
  const liveMetricsVisible = useStore((s) => s.environmentProfile.visibility.liveMetrics)
  const liveStyle = useStore((s) =>
    id && liveMetricsVisible ? s.liveVisualization?.nodeStyles.get(id) : undefined
  )
  const isSpof = showSpofBadges && spofReason !== null

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
    <div
      onContextMenu={handleContextMenu}
      className={`${containerClassName ?? containerClasses}${isSpof ? ' ring-2 ring-nss-danger/70' : ''}`}
    >
      {isSpof && (
        <div
          className="absolute -top-2 -right-2 z-10 flex items-center gap-1 rounded-full border border-nss-primary bg-nss-primary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow"
          title={`Single point of failure. ${spofReason}`}
        >
          <AlertTriangle size={9} />
          SPOF
        </div>
      )}
      {showScaffoldBadge && (
        <div
          className={`absolute -top-2 -left-2 z-10 flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shadow ${
            isScaffoldLocked
              ? 'border-nss-warning/40 bg-nss-warning/15 text-nss-warning'
              : 'border-nss-border bg-nss-surface text-nss-muted'
          }`}
          title={
            isScaffoldLocked
              ? 'Provided by the question - locked'
              : 'Provided by the question scaffold'
          }
        >
          {isScaffoldLocked ? <Lock size={9} /> : <Anchor size={9} />}
          {isScaffoldLocked ? 'Locked' : 'Scaffold'}
        </div>
      )}

      {liveStyle && <LiveNodeIndicator style={liveStyle} />}

      {/* Connection handles - shared by all node types */}
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

      {/* Node body - render prop receives menu state for placement in NodeHeader */}
      {children(bag)}
    </div>
  )
}

export default memo(BaseNode)
