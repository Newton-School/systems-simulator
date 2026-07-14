import { memo } from 'react'
import { FolderOpen, Save, Sidebar } from 'lucide-react'

import { Divider } from '../ui/Divider'
import { IconButton } from '../ui/IconButton'
import { ToggleButton } from '../ui/ToggleButton'
import { Branding } from './Branding'
import { FileStatus } from './FileStatus'
import { ThemeToggle } from './ThemeToggle'
import { SimulationControls } from '../simulation/SimulationControls'
import type { ScenarioState, SourceNodeOption } from '@renderer/types/ui'

interface HeaderProps {
  // Layout
  toggleLeft: () => void
  isLeftOpen: boolean
  toggleRight: () => void
  isRightOpen: boolean

  // File
  onSave: () => void
  onOpen: () => void
  fileName: string | null
  isUnsaved: boolean

  // Simulation
  onRun: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  isRunning: boolean
  isPaused: boolean
  sourceNodes: SourceNodeOption[]
  scenario: ScenarioState
  onScenarioChange: (updater: (current: ScenarioState) => ScenarioState) => void
  simulationDisabled?: boolean
}

export const Header = memo(
  ({
    toggleLeft,
    isLeftOpen,
    toggleRight,
    isRightOpen,
    onSave,
    onOpen,
    fileName,
    isUnsaved,
    onRun,
    onPause,
    onResume,
    onStop,
    isRunning,
    isPaused,
    sourceNodes,
    scenario,
    onScenarioChange,
    simulationDisabled
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
        </div>

        {/* CENTER: File status + simulation controls */}
        <div className="flex items-center gap-3">
          <FileStatus fileName={fileName} isUnsaved={isUnsaved} />

          <div className="flex items-center gap-1">
            <IconButton onClick={onOpen} icon={<FolderOpen size={18} />} label="Open (Ctrl+O)" />
            <IconButton onClick={onSave} icon={<Save size={18} />} label="Save (Ctrl+S)" />
          </div>

          <Divider />

          <SimulationControls
            onRun={onRun}
            onPause={onPause}
            onResume={onResume}
            onStop={onStop}
            isRunning={isRunning}
            isPaused={isPaused}
            sourceNodes={sourceNodes}
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
