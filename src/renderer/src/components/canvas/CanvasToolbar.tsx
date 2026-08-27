import { memo, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronUp,
  Hand,
  MousePointer2,
  Redo2,
  RotateCcw,
  Trash2,
  Type,
  Undo2,
  type LucideIcon
} from 'lucide-react'

export type CanvasTool = 'select' | 'pan' | 'text'

interface CanvasToolbarProps {
  activeTool: CanvasTool
  canRedo: boolean
  canUndo: boolean
  editingDisabled?: boolean
  hasCanvasContent: boolean
  hasSelection: boolean
  onToolChange: (tool: CanvasTool) => void
  onRedo: () => void
  onUndo: () => void
  onResetCanvas: () => void
  onDeleteSelection: () => void
}

interface CanvasToolButtonProps {
  icon: LucideIcon
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

const TOOL_ITEMS: ReadonlyArray<{ tool: CanvasTool; label: string; icon: LucideIcon }> = [
  { tool: 'pan', label: 'Move canvas', icon: Hand },
  { tool: 'select', label: 'Select', icon: MousePointer2 },
  { tool: 'text', label: 'Add label', icon: Type }
]

const TOOLBAR_SHELL_CLASS =
  'pointer-events-auto flex flex-col items-center gap-0.5 rounded-md border border-nss-border bg-nss-panel/95 p-0.5 shadow-lg backdrop-blur'

const CanvasToolButton = memo(
  ({ icon: Icon, label, active = false, disabled = false, onClick }: CanvasToolButtonProps) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-8 w-8 items-center justify-center rounded border text-nss-muted transition-all',
        'focus:outline-none focus:ring-2 focus:ring-nss-primary/60',
        active
          ? 'border-nss-primary/50 bg-nss-primary/15 text-nss-primary'
          : 'border-transparent hover:border-nss-border hover:bg-nss-surface hover:text-nss-text',
        disabled && 'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent'
      )}
    >
      <Icon size={16} strokeWidth={2.2} />
    </button>
  )
)

CanvasToolButton.displayName = 'CanvasToolButton'

const CanvasToolbarComponent = ({
  activeTool,
  canRedo,
  canUndo,
  editingDisabled = false,
  hasCanvasContent,
  hasSelection,
  onToolChange,
  onRedo,
  onUndo,
  onResetCanvas,
  onDeleteSelection
}: CanvasToolbarProps) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const activeItem = useMemo(
    () => TOOL_ITEMS.find((item) => item.tool === activeTool) ?? TOOL_ITEMS[0],
    [activeTool]
  )
  const ActiveIcon = activeItem.icon

  if (!isExpanded) {
    return (
      <div className="pointer-events-none absolute bottom-36 left-2 z-30">
        <div className={TOOLBAR_SHELL_CLASS}>
          <button
            type="button"
            aria-label="Show canvas tools"
            title="Show canvas tools"
            aria-expanded={false}
            onClick={() => setIsExpanded(true)}
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded border border-transparent text-nss-muted transition-all',
              'hover:border-nss-border hover:bg-nss-surface focus:outline-none focus:ring-2 focus:ring-nss-primary/60'
            )}
          >
            <ActiveIcon size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute bottom-36 left-2 z-30">
      <div className={TOOLBAR_SHELL_CLASS}>
        {TOOL_ITEMS.map(({ tool, label, icon }) => (
          <CanvasToolButton
            key={tool}
            icon={icon}
            label={label}
            active={activeTool === tool}
            disabled={editingDisabled && tool === 'text'}
            onClick={() => onToolChange(tool)}
          />
        ))}

        <div className="my-0.5 h-px w-5 bg-nss-border" />

        <CanvasToolButton
          icon={Undo2}
          label="Undo (Cmd/Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        />

        <CanvasToolButton
          icon={Redo2}
          label="Redo (Cmd/Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
        />

        <div className="my-0.5 h-px w-5 bg-nss-border" />

        <CanvasToolButton
          icon={RotateCcw}
          label="Reset canvas"
          disabled={editingDisabled || !hasCanvasContent}
          onClick={onResetCanvas}
        />

        <CanvasToolButton
          icon={Trash2}
          label="Delete selection"
          disabled={editingDisabled || !hasSelection}
          onClick={onDeleteSelection}
        />

        <div className="my-0.5 h-px w-5 bg-nss-border" />

        <CanvasToolButton
          icon={ChevronUp}
          label="Collapse toolbar"
          onClick={() => setIsExpanded(false)}
        />
      </div>
    </div>
  )
}

export const CanvasToolbar = memo(CanvasToolbarComponent)
