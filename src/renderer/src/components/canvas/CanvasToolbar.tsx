import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  ArrowUpRight,
  ChevronUp,
  Eraser,
  Hand,
  Highlighter,
  Link2,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Pencil,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  type LucideIcon
} from 'lucide-react'

export type CanvasTool =
  | 'select'
  | 'pan'
  | 'connect'
  | 'text'
  | 'pen'
  | 'laser'
  | 'highlighter'
  | 'arrow'
  | 'note'
  | 'eraser'

interface CanvasToolbarProps {
  activeTool: CanvasTool
  canAnnotate: boolean
  canRedo: boolean
  canUndo: boolean
  editingDisabled?: boolean
  hasAnnotations: boolean
  hasCanvasContent: boolean
  hasSelection: boolean
  onClearAnnotations: () => void
  onToolChange: (tool: CanvasTool) => void
  onRedo: () => void
  onUndo: () => void
  onResetCanvas: () => void
  onDeleteSelection: () => void
}

interface CanvasToolButtonProps {
  icon: LucideIcon
  label: string
  className?: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

const BUILD_TOOLS: ReadonlyArray<{
  tool: CanvasTool
  label: string
  icon: LucideIcon
  shortcut?: string
  touchOnly?: boolean
}> = [
  { tool: 'select', label: 'Select', icon: MousePointer2, shortcut: '1' },
  { tool: 'pan', label: 'Move canvas', icon: Hand, shortcut: '2' },
  { tool: 'connect', label: 'Connect nodes', icon: Link2, touchOnly: true }
]

const ANNOTATION_TOOLS: ReadonlyArray<{
  tool: CanvasTool
  label: string
  icon: LucideIcon
}> = [
  { tool: 'pen', label: 'Pen', icon: Pencil },
  { tool: 'laser', label: 'Laser pen (fades)', icon: Sparkles },
  { tool: 'highlighter', label: 'Highlighter', icon: Highlighter },
  { tool: 'arrow', label: 'Teaching arrow', icon: ArrowUpRight },
  { tool: 'text', label: 'Add text label', icon: Type },
  { tool: 'eraser', label: 'Erase annotation', icon: Eraser }
]

const TOOLBAR_SHELL_CLASS =
  'nss-canvas-toolbar-shell pointer-events-auto flex flex-col items-center gap-0.5 rounded-lg border border-nss-border bg-nss-panel/95 p-1 shadow-lg backdrop-blur'

const CanvasToolButton = memo(
  ({
    icon: Icon,
    label,
    className,
    shortcut,
    active = false,
    disabled = false,
    onClick
  }: CanvasToolButtonProps) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'nss-canvas-tool-button nss-touch-target group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-nss-muted transition-all',
        'focus:outline-none focus:ring-2 focus:ring-nss-primary/60',
        className,
        active
          ? 'border-nss-primary/50 bg-nss-primary/15 text-nss-primary'
          : 'border-transparent hover:border-nss-border hover:bg-nss-surface hover:text-nss-text',
        disabled && 'cursor-not-allowed opacity-40 hover:border-transparent hover:bg-transparent'
      )}
    >
      <Icon size={17} strokeWidth={2.2} />
      {shortcut ? (
        <span className="nss-desktop-only absolute bottom-0.5 right-1 font-mono text-[7px] font-medium leading-none text-current opacity-30 transition-opacity group-hover:opacity-60">
          {shortcut}
        </span>
      ) : null}
    </button>
  )
)

CanvasToolButton.displayName = 'CanvasToolButton'

function ToolbarDivider(): React.JSX.Element {
  return <div className="nss-toolbar-divider my-0.5 h-px w-5 shrink-0 bg-nss-border" />
}

const CanvasToolbarComponent = ({
  activeTool,
  canAnnotate,
  canRedo,
  canUndo,
  editingDisabled = false,
  hasAnnotations,
  hasCanvasContent,
  hasSelection,
  onClearAnnotations,
  onToolChange,
  onRedo,
  onUndo,
  onResetCanvas,
  onDeleteSelection
}: CanvasToolbarProps) => {
  const [isExpanded, setIsExpanded] = useState(true)
  const [annotationsExpanded, setAnnotationsExpanded] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreMenuPosition, setMoreMenuPosition] = useState<{ left: number; bottom: number } | null>(
    null
  )
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const allTools = useMemo(
    () => (canAnnotate ? [...BUILD_TOOLS, ...ANNOTATION_TOOLS] : BUILD_TOOLS),
    [canAnnotate]
  )
  const activeItem = allTools.find((item) => item.tool === activeTool) ?? BUILD_TOOLS[0]
  const ActiveIcon = activeItem.icon

  useEffect(() => {
    if (!moreOpen) {
      setMoreMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const anchor = moreAnchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const menuWidth = 192
      const gutter = 8
      setMoreMenuPosition({
        left: Math.min(
          Math.max(gutter, rect.right - menuWidth),
          window.innerWidth - menuWidth - gutter
        ),
        bottom: Math.max(gutter, window.innerHeight - rect.top + gutter)
      })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (moreAnchorRef.current?.contains(target) || moreMenuRef.current?.contains(target)) return
      setMoreOpen(false)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('orientationchange', updatePosition)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('orientationchange', updatePosition)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [moreOpen])

  if (!isExpanded) {
    return (
      <div className="nss-canvas-toolbar-position pointer-events-none absolute bottom-36 left-2 z-30">
        <div className={TOOLBAR_SHELL_CLASS}>
          <CanvasToolButton
            icon={ActiveIcon}
            label="Show canvas tools"
            onClick={() => setIsExpanded(true)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="nss-canvas-toolbar-position pointer-events-none absolute bottom-36 left-2 z-30">
      <div className={TOOLBAR_SHELL_CLASS}>
        {BUILD_TOOLS.map(({ tool, label, icon, shortcut, touchOnly }) => (
          <CanvasToolButton
            key={tool}
            icon={icon}
            label={label}
            className={touchOnly ? 'nss-touch-only-tool' : undefined}
            shortcut={shortcut}
            active={activeTool === tool}
            disabled={editingDisabled && tool === 'connect'}
            onClick={() => onToolChange(tool)}
          />
        ))}

        {canAnnotate ? (
          <>
            <ToolbarDivider />
            <CanvasToolButton
              icon={Palette}
              label={annotationsExpanded ? 'Hide annotation tools' : 'Show annotation tools'}
              active={ANNOTATION_TOOLS.some((item) => item.tool === activeTool)}
              onClick={() => setAnnotationsExpanded((expanded) => !expanded)}
            />
            {annotationsExpanded
              ? ANNOTATION_TOOLS.map(({ tool, label, icon }) => (
                  <CanvasToolButton
                    key={tool}
                    icon={icon}
                    label={label}
                    active={activeTool === tool}
                    disabled={editingDisabled}
                    onClick={() => onToolChange(tool)}
                  />
                ))
              : null}
          </>
        ) : null}

        <ToolbarDivider />
        <CanvasToolButton icon={Undo2} label="Undo" disabled={!canUndo} onClick={onUndo} />
        <CanvasToolButton icon={Redo2} label="Redo" disabled={!canRedo} onClick={onRedo} />

        <div ref={moreAnchorRef} className="relative">
          <CanvasToolButton
            icon={MoreHorizontal}
            label="More canvas actions"
            active={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          />
          {moreOpen && moreMenuPosition
            ? createPortal(
                <div
                  ref={moreMenuRef}
                  role="menu"
                  style={moreMenuPosition}
                  className="fixed z-[100] w-48 rounded-lg border border-nss-border bg-nss-panel p-1 shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={editingDisabled || !hasSelection}
                    onClick={() => {
                      onDeleteSelection()
                      setMoreOpen(false)
                    }}
                    className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs text-nss-text hover:bg-nss-surface disabled:opacity-40"
                  >
                    <Trash2 size={15} /> Delete selection
                  </button>
                  {canAnnotate ? (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!hasAnnotations}
                      onClick={() => {
                        onClearAnnotations()
                        setMoreOpen(false)
                      }}
                      className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs text-nss-text hover:bg-nss-surface disabled:opacity-40"
                    >
                      <Eraser size={15} /> Clear annotations
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={editingDisabled || !hasCanvasContent}
                    onClick={() => {
                      onResetCanvas()
                      setMoreOpen(false)
                    }}
                    className="flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-left text-xs text-nss-danger hover:bg-nss-danger/10 disabled:opacity-40"
                  >
                    <RotateCcw size={15} /> Reset topology
                  </button>
                </div>,
                document.body
              )
            : null}
        </div>

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
