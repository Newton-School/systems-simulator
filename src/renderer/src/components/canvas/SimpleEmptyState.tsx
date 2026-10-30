import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Database, Plus, Server, UserRound } from 'lucide-react'

function GhostTopology(): React.JSX.Element {
  const nodes = [
    { label: 'Client', icon: UserRound },
    { label: 'Service', icon: Server },
    { label: 'Database', icon: Database }
  ]

  return (
    <div
      aria-hidden="true"
      className="mb-5 flex items-center justify-center gap-2 text-nss-primary/55 sm:gap-3"
    >
      {nodes.map(({ label, icon: Icon }, index) => (
        <div key={label} className="contents">
          <div className="flex h-16 w-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-nss-primary/30 bg-nss-primary/[0.04] sm:w-24">
            <Icon size={20} strokeWidth={1.8} />
            <span className="text-[10px] font-semibold tracking-wide">{label}</span>
          </div>
          {index < nodes.length - 1 ? (
            <ArrowRight size={18} strokeWidth={1.5} className="shrink-0 opacity-60" />
          ) : null}
        </div>
      ))}
    </div>
  )
}

type CalloutTarget = 'add' | 'workload' | 'run' | 'file'
type Point = { x: number; y: number }
type MeasuredTargets = {
  width: number
  height: number
  points: Partial<Record<CalloutTarget, Point>>
}

const TARGET_SELECTORS: Record<CalloutTarget, string> = {
  add: 'button[aria-label="Add component"]',
  workload: 'button[aria-label="Workload"]',
  run: 'button[aria-label="Run"], button[aria-label="Run again"]',
  file: 'button[aria-label="More actions"]'
}

const ARROW_TARGET_GAP_PX = 50

function curvedPath(start: Point, end: Point): string {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return `M ${start.x} ${start.y} C ${start.x + dx * 0.35} ${start.y + dy * 0.08}, ${start.x + dx * 0.82} ${start.y + dy * 0.58}, ${end.x} ${end.y}`
}

function endBeforeTarget(start: Point, target: Point): Point {
  const dx = start.x - target.x
  const dy = start.y - target.y
  const distance = Math.hypot(dx, dy)
  if (distance <= ARROW_TARGET_GAP_PX) return start

  return {
    x: target.x + (dx / distance) * ARROW_TARGET_GAP_PX,
    y: target.y + (dy / distance) * ARROW_TARGET_GAP_PX
  }
}

/** Decorative, canvas-edge hints for the controls surrounding an empty topology. */
function EmptyCanvasCallouts(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<MeasuredTargets | null>(null)
  const labelClass = 'nss-handwritten-hint text-base leading-tight text-nss-muted opacity-55'

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return

    const update = () => {
      const rootRect = root.getBoundingClientRect()
      const points: Partial<Record<CalloutTarget, Point>> = {}

      for (const [key, selector] of Object.entries(TARGET_SELECTORS) as Array<
        [CalloutTarget, string]
      >) {
        const control = document.querySelector<HTMLElement>(selector)
        if (!control) continue
        const rect = control.getBoundingClientRect()
        points[key] = {
          x: Math.max(4, Math.min(rootRect.width - 4, rect.left + rect.width / 2 - rootRect.left)),
          y: Math.max(4, Math.min(rootRect.height - 4, rect.top + rect.height / 2 - rootRect.top))
        }
      }

      setMeasured({ width: rootRect.width, height: rootRect.height, points })
    }

    const frame = window.requestAnimationFrame(update)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(root)
    window.addEventListener('resize', update)

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  if (!measured || measured.width < 1024) {
    return <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
  }

  const { width, height, points } = measured
  const callouts: Array<{
    key: CalloutTarget
    label: React.ReactNode
    start: Point
    end: Point
    labelStyle: React.CSSProperties
  }> = []

  if (points.workload) {
    const start = { x: points.workload.x - 150, y: 145 }
    callouts.push({
      key: 'workload',
      label: 'Choose the workload',
      start,
      end: endBeforeTarget(start, points.workload),
      labelStyle: { left: start.x - 178, top: start.y - 10, width: 168, textAlign: 'right' }
    })
  }

  if (points.run) {
    const start = { x: points.run.x + 150, y: 175 }
    callouts.push({
      key: 'run',
      label: 'Run your design!',
      start,
      end: endBeforeTarget(start, points.run),
      labelStyle: { left: start.x + 10, top: start.y - 10, width: 150 }
    })
  }

  if (points.file) {
    const start = { x: points.file.x - 190, y: 140 }
    callouts.push({
      key: 'file',
      label: 'Open or save a file',
      start,
      end: endBeforeTarget(start, points.file),
      labelStyle: { left: start.x - 186, top: start.y - 10, width: 176, textAlign: 'right' }
    })
  }

  if (points.add) {
    const start = {
      x: Math.min(width - 210, points.add.x + 220),
      y: Math.min(height - 55, points.add.y + 150)
    }
    callouts.push({
      key: 'add',
      label: 'Add your first component',
      start,
      end: endBeforeTarget(start, points.add),
      labelStyle: { left: start.x + 10, top: start.y - 10, width: 190 }
    })
  }

  return (
    <div ref={rootRef} aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 h-full w-full fill-none text-nss-muted opacity-45">
        <defs>
          <marker
            id="empty-canvas-arrowhead"
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path
              d="M1 1L10 6L1 11"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.5"
            />
          </marker>
        </defs>
        {callouts.map(({ key, start, end }) => (
          <path
            key={key}
            d={curvedPath(start, end)}
            markerEnd="url(#empty-canvas-arrowhead)"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        ))}
      </svg>
      {callouts.map(({ key, label, labelStyle }) => (
        <p key={key} className={`absolute ${labelClass}`} style={labelStyle}>
          {label}
        </p>
      ))}
    </div>
  )
}

/**
 * Simple shell's empty canvas: a quiet first-run guide that explains the build to run loop.
 * FlowCanvas only mounts it while the topology is empty, so the entire layer disappears after
 * the first component is placed.
 */
export function SimpleEmptyState({
  onAddComponent,
  onLoadStarter
}: {
  onAddComponent: () => void
  /** Offered only when no question is loaded, so a starter can't break a question's rules. */
  onLoadStarter?: () => void
}): React.JSX.Element {
  return (
    <div data-testid="simple-empty-state" className="pointer-events-none absolute inset-0">
      <EmptyCanvasCallouts />

      <div className="absolute inset-0 flex items-center justify-center px-4">
        <div className="pointer-events-auto flex w-full max-w-md flex-col items-center text-center">
          <GhostTopology />
          <div className="space-y-1">
            <p className="nss-handwritten-hint mx-auto max-w-sm text-base leading-relaxed text-nss-muted opacity-60">
              Build systems, run traffic, and discover where they bend.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onAddComponent}
              className="flex min-h-9 items-center gap-1.5 rounded-md border border-nss-primary/50 bg-nss-primary/10 px-3 text-xs font-semibold text-nss-primary transition-colors hover:bg-nss-primary/20 focus:outline-none focus:ring-2 focus:ring-nss-primary/50"
            >
              <Plus size={14} />
              Add component
            </button>
            {onLoadStarter && (
              <button
                type="button"
                onClick={onLoadStarter}
                className="min-h-9 rounded-md border border-nss-border px-3 text-xs font-semibold text-nss-text transition-colors hover:border-nss-primary/50 hover:text-nss-primary focus:outline-none focus:ring-2 focus:ring-nss-primary/50"
              >
                Load starter diagram
              </button>
            )}
          </div>
          <p className="mt-2.5 text-[10px] text-nss-muted/70">
            Press <kbd className="rounded border border-nss-border px-1 py-0.5 font-mono">/</kbd> to
            add a component
          </p>
        </div>
      </div>
    </div>
  )
}
