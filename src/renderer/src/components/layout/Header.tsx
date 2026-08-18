import { memo } from 'react'
import { FolderOpen, Save, Sidebar, Workflow } from 'lucide-react'

import { Divider } from '../ui/Divider'
import { IconButton } from '../ui/IconButton'
import { ToggleButton } from '../ui/ToggleButton'
import { Branding } from './Branding'
import { CostChip } from './CostChip'
import { FileStatus } from './FileStatus'
import { ThemeToggle } from './ThemeToggle'
import { SimulationControls } from '../simulation/SimulationControls'
import type { FaultTargetOption, ScenarioState, SourceNodeOption } from '@renderer/types/ui'

interface HeaderProps {
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

export const Header = memo(
  ({
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
    return (
      <header className="h-12 bg-nss-panel text-nss-text flex items-center justify-between px-4 shrink-0 border-b border-nss-border transition-colors duration-200 overflow-visible">
        {/* LEFT: Branding & left sidebar toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <Branding />
          <Divider />
          <ToggleButton
            onClick={toggleLeft}
            isOpen={isLeftOpen}
            label="Toggle left sidebar"
            icon={<Sidebar size={18} />}
          />
          <Divider />
          <CostChip />
        </div>

        {/* CENTER: File status + simulation controls */}
        <div className="flex items-center gap-3">
          {!minimal && <FileStatus fileName={fileName} isUnsaved={isUnsaved} />}

          <div className="flex items-center gap-1">
            {canOpen && (
              <IconButton onClick={onOpen} icon={<FolderOpen size={18} />} label="Open (Ctrl+O)" />
            )}
            {canSave && (
              <IconButton onClick={onSave} icon={<Save size={18} />} label="Save (Ctrl+S)" />
            )}
            <IconButton onClick={onAutoLayout} icon={<Workflow size={18} />} label="Auto Layout" />
          </div>

          <Divider />

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
        <div className="flex items-center gap-3 shrink-0">
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
