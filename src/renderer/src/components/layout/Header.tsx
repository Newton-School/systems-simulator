import { memo, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, FolderOpen, Save, Sidebar, Workflow } from 'lucide-react'

import { Divider } from '../ui/Divider'
import { IconButton } from '../ui/IconButton'
import { ToggleButton } from '../ui/ToggleButton'
import { Branding } from './Branding'
import { CostChip } from './CostChip'
import { ModeBadge } from './ModeBadge'
import { FileStatus } from './FileStatus'
import { ThemeToggle } from './ThemeToggle'
import { SimulationControls } from '../simulation/SimulationControls'
import type { FaultTargetOption, ScenarioState, SourceNodeOption } from '@renderer/types/ui'

interface HeaderProps {
  /**
   * Draw a back control at the head of the bar. Set when the Newton host has handed us the
   * job, so the learner gets one control that belongs to this header instead of a separate
   * strip stacked above the frame.
   */
  showBackButton?: boolean
  onBackClick?: () => void

  // Layout
  toggleLeft: () => void
  isLeftOpen: boolean
  toggleRight: () => void
  isRightOpen: boolean

  // File
  onSave: () => void
  onOpen: () => void
  onAutoLayout: () => void
  fileName: string | null
  isUnsaved: boolean

  // Simulation
  onRun: () => void
  onReset: () => void
  isPostRun: boolean
  onPause: () => void
  onResume: () => void
  onStop: () => void
  isRunning: boolean
  isPaused: boolean
  sourceNodes: SourceNodeOption[]
  faultTargets: FaultTargetOption[]
  scenario: ScenarioState
  onScenarioChange: (updater: (current: ScenarioState) => ScenarioState) => void
  simulationDisabled?: boolean
  /** Minimal chrome (EnvironmentProfile ASSIGNMENT/PRACTICE): hide file status chrome. */
  minimal?: boolean
  /** Whether opening an external topology is allowed. False in question mode -
   * loading another topology would bypass (and clear) the active question. */
  canOpen?: boolean
  /** Whether saving the current topology is allowed. Disabled in assignment mode. */
  canSave?: boolean
}

const HEADER_HORIZONTAL_PADDING_PX = 32
const CENTER_CLEARANCE_PX = 16

export const Header = memo(
  ({
    showBackButton = false,
    onBackClick,
    toggleLeft,
    isLeftOpen,
    toggleRight,
    isRightOpen,
    onSave,
    onOpen,
    onAutoLayout,
    fileName,
    isUnsaved,
    onRun,
    onReset,
    isPostRun,
    onPause,
    onResume,
    onStop,
    isRunning,
    isPaused,
    sourceNodes,
    faultTargets,
    scenario,
    onScenarioChange,
    simulationDisabled,
    minimal,
    canOpen = true,
    canSave = true
  }: HeaderProps) => {
    const headerRef = useRef<HTMLElement>(null)
    const leftGroupRef = useRef<HTMLDivElement>(null)
    const centerGroupRef = useRef<HTMLDivElement>(null)
    const rightGroupRef = useRef<HTMLDivElement>(null)
    const [centerControlsPinned, setCenterControlsPinned] = useState(true)

    useLayoutEffect(() => {
      const header = headerRef.current
      const leftGroup = leftGroupRef.current
      const centerGroup = centerGroupRef.current
      const rightGroup = rightGroupRef.current

      if (!header || !leftGroup || !centerGroup || !rightGroup) {
        return
      }

      const updatePinnedState = () => {
        const contentWidth = Math.max(0, header.clientWidth - HEADER_HORIZONTAL_PADDING_PX)
        const widestSideWidth = Math.max(leftGroup.offsetWidth, rightGroup.offsetWidth)
        const requiredWidth =
          widestSideWidth * 2 + centerGroup.offsetWidth + CENTER_CLEARANCE_PX * 2

        setCenterControlsPinned(requiredWidth <= contentWidth)
      }

      updatePinnedState()

      const observer = new ResizeObserver(updatePinnedState)
      observer.observe(header)
      observer.observe(leftGroup)
      observer.observe(centerGroup)
      observer.observe(rightGroup)

      return () => observer.disconnect()
    }, [])

    return (
      <header
        ref={headerRef}
        className="nss-app-header relative flex h-12 shrink-0 items-center justify-between overflow-visible border-b border-nss-border bg-nss-panel px-4 text-nss-text transition-colors duration-200"
      >
        {/* LEFT: Back (host-driven) & branding & left sidebar toggle */}
        <div ref={leftGroupRef} className="flex items-center gap-1 shrink-0">
          {showBackButton && onBackClick && (
            <>
              <button
                type="button"
                onClick={onBackClick}
                aria-label="Back to assignment"
                className="flex items-center gap-1 rounded px-2 py-1 text-sm text-nss-text transition-colors hover:bg-nss-hover"
              >
                <ChevronLeft size={18} />
                <span className="nss-desktop-only">Back</span>
              </button>
              <Divider />
            </>
          )}
          <Branding />
          <Divider />
          <ToggleButton
            onClick={toggleLeft}
            isOpen={isLeftOpen}
            label="Toggle left sidebar"
            icon={<Sidebar size={18} />}
          />
          <div className="nss-desktop-only contents">
            <Divider />
            <CostChip />
          </div>
          <Divider />
          <ModeBadge />
        </div>

        {/* CENTER: File status + simulation controls */}
        <div
          ref={centerGroupRef}
          className={
            centerControlsPinned
              ? 'absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2'
              : 'flex items-center gap-2'
          }
        >
          {!minimal && (
            <div className="nss-desktop-only">
              <FileStatus fileName={fileName} isUnsaved={isUnsaved} />
            </div>
          )}

          <div className="flex items-center gap-1">
            {canOpen && (
              <IconButton onClick={onOpen} icon={<FolderOpen size={18} />} label="Open (Ctrl+O)" />
            )}
            {canSave && (
              <IconButton onClick={onSave} icon={<Save size={18} />} label="Save (Ctrl+S)" />
            )}
            <IconButton onClick={onAutoLayout} icon={<Workflow size={18} />} label="Auto Layout" />
          </div>

          <div className="nss-desktop-only">
            <Divider />
          </div>

          <SimulationControls
            onRun={onRun}
            onReset={onReset}
            isPostRun={isPostRun}
            onPause={onPause}
            onResume={onResume}
            onStop={onStop}
            isRunning={isRunning}
            isPaused={isPaused}
            sourceNodes={sourceNodes}
            faultTargets={faultTargets}
            scenario={scenario}
            onScenarioChange={onScenarioChange}
            disabled={simulationDisabled}
          />
        </div>

        {/* RIGHT: Theme & right sidebar toggle */}
        <div ref={rightGroupRef} className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <Divider />
          <ToggleButton
            onClick={toggleRight}
            isOpen={isRightOpen}
            label="Toggle right sidebar"
            icon={<Sidebar size={18} className="rotate-180" />}
          />
        </div>
      </header>
    )
  }
)

Header.displayName = 'Header'
