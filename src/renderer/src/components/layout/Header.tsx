import { memo, type ReactNode, useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, FolderKanban, FolderOpen, Save, Sidebar } from 'lucide-react'

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
  onSamples: () => void
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
    onSamples,
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
    const [isFileMenuOpen, setFileMenuOpen] = useState(false)
    const fileMenuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (!isFileMenuOpen) return

      const handlePointerDown = (event: MouseEvent) => {
        if (!fileMenuRef.current?.contains(event.target as Node)) {
          setFileMenuOpen(false)
        }
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setFileMenuOpen(false)
        }
      }

      document.addEventListener('mousedown', handlePointerDown)
      document.addEventListener('keydown', handleKeyDown)
      return () => {
        document.removeEventListener('mousedown', handlePointerDown)
        document.removeEventListener('keydown', handleKeyDown)
      }
    }, [isFileMenuOpen])

    const runFileAction = (action: () => void) => {
      setFileMenuOpen(false)
      action()
    }

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
          <div ref={fileMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setFileMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={isFileMenuOpen}
              className="ml-1 inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-nss-muted transition-colors hover:bg-nss-text/5 hover:text-nss-text focus:outline-none focus:ring-1 focus:ring-nss-primary"
            >
              <FileText size={15} />
              File
              <ChevronDown
                size={14}
                className={`transition-transform ${isFileMenuOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isFileMenuOpen && (
              <div
                role="menu"
                className="absolute left-1 top-9 z-50 w-56 overflow-hidden rounded-md border border-nss-border bg-nss-panel py-1 shadow-xl shadow-black/20"
              >
                <FileMenuItem
                  icon={<FolderOpen size={16} />}
                  label="Open"
                  shortcut="Ctrl+O"
                  onClick={() => runFileAction(onOpen)}
                />
                <FileMenuItem
                  icon={<FolderKanban size={16} />}
                  label="Open Samples"
                  shortcut="Ctrl+Shift+O"
                  onClick={() => runFileAction(onSamples)}
                />
                <FileMenuItem
                  icon={<Save size={16} />}
                  label="Save"
                  shortcut="Ctrl+S"
                  onClick={() => runFileAction(onSave)}
                />
              </div>
            )}
          </div>
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

interface FileMenuItemProps {
  icon: ReactNode
  label: string
  shortcut: string
  onClick: () => void
}

function FileMenuItem({ icon, label, shortcut, onClick }: FileMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-nss-text transition-colors hover:bg-nss-text/5 focus:bg-nss-text/5 focus:outline-none"
    >
      <span aria-hidden="true" className="text-nss-muted">
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      <span className="text-[10px] uppercase tracking-wide text-nss-muted">{shortcut}</span>
    </button>
  )
}
