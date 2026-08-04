import { memo, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ChevronUp,
  Hand,
  MousePointer2,
  Trash2,
  Type,
  type LucideIcon
} from 'lucide-react'

export type CanvasTool = 'select' | 'pan' | 'text'

interface CanvasToolbarProps {
  activeTool: CanvasTool
  hasSelection: boolean
  onToolChange: (tool: CanvasTool) => void
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
  { tool: 'select', label: 'Select', icon: MousePointer2 },
  { tool: 'pan', label: 'Move canvas', icon: Hand },
  { tool: 'text', label: 'Add label', icon: Type }
]

const TOOLBAR_SHELL_CLASS =
  'pointer-events-auto flex items-center gap-1 rounded-lg border border-nss-border bg-nss-panel/95 p-1 shadow-xl backdrop-blur'

const CanvasToolButton = memo(
  ({ icon: Icon, label, active = false, disabled = false, onClick }: CanvasToolButtonProps) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'flex h-9 w-9 items-center justify-center rounded-md border text-nss-muted transition-all',
        'focus:outline-none focus:ring-2 focus:ring-nss-primary/60',
        active
          ? 'border-nss-primary bg-nss-primary text-white shadow-sm'
          : 'border-transparent hover:border-nss-border hover:bg-nss-surface hover:text-nss-text',
        disabled && 'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent'
      )}
    >
      <Icon size={18} strokeWidth={2.2} />
    </button>
  )
)

CanvasToolButton.displayName = 'CanvasToolButton'

const CanvasToolbarComponent = ({
  activeTool,
  hasSelection,
  onToolChange,
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
      <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
        <div className={TOOLBAR_SHELL_CLASS}>
          <button
            type="button"
            aria-label="Show canvas tools"
            title="Show canvas tools"
            aria-expanded={false}
            onClick={() => setIsExpanded(true)}
            className={clsx(
              'flex h-9 items-center gap-1 rounded-md border border-transparent px-2 text-nss-text transition-all',
              'hover:border-nss-border hover:bg-nss-surface focus:outline-none focus:ring-2 focus:ring-nss-primary/60'
            )}
          >
            <ActiveIcon size={18} strokeWidth={2.2} />
            <ChevronDown size={14} strokeWidth={2.2} className="text-nss-muted" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
      <div className={TOOLBAR_SHELL_CLASS}>
        {TOOL_ITEMS.map(({ tool, label, icon }) => (
          <CanvasToolButton
            key={tool}
            icon={icon}
            label={label}
            active={activeTool === tool}
            onClick={() => onToolChange(tool)}
          />
        ))}

        <div className="mx-1 h-6 w-px bg-nss-border" />

        <CanvasToolButton
          icon={Trash2}
          label="Delete selection"
          disabled={!hasSelection}
          onClick={onDeleteSelection}
        />

        <div className="mx-1 h-6 w-px bg-nss-border" />

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
