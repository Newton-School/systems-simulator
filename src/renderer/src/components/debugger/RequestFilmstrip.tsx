import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Cog,
  Hourglass,
  LogIn,
  Pause,
  Route,
  Sparkles,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import { STATE_LABEL, stepVisualState, type DebugViewProps } from './debuggerUi'
import { formatDebugMs, type LifecycleState } from './requestLifecycle'

const ICON: Record<LifecycleState, LucideIcon> = {
  generated: Sparkles,
  'in-flight': ArrowRightLeft,
  arrived: LogIn,
  queued: Hourglass,
  processing: Cog,
  routing: Route,
  held: Pause,
  completed: CheckCircle2,
  rejected: XCircle,
  'timed-out': Clock
}

/** One frame per recorded step, scrolled to keep the current frame centred (#156 view 5). */
export function RequestFilmstrip({ lifecycle, stepIndex, onStep, labelFor }: DebugViewProps) {
  const stripRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const strip = stripRef.current
    const frame = strip?.querySelector<HTMLElement>(`[data-frame="${stepIndex}"]`)
    if (!strip || !frame) return
    // Centre horizontally inside the strip only (scrollIntoView would also
    // scroll the surrounding tray vertically).
    const target = frame.offsetLeft - strip.clientWidth / 2 + frame.clientWidth / 2
    if (typeof strip.scrollTo === 'function') {
      strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
    } else {
      strip.scrollLeft = Math.max(0, target)
    }
  }, [stepIndex])

  return (
    <div
      ref={stripRef}
      className="relative flex gap-2 overflow-x-auto rounded-md border border-nss-border bg-nss-panel p-3"
      data-testid="request-filmstrip"
    >
      {lifecycle.steps.map((step) => {
        const visual = stepVisualState(lifecycle, step.index, stepIndex)
        const Icon = ICON[step.state]
        const where = step.nodeId
          ? labelFor(step.nodeId)
          : step.edgeId
            ? labelFor(step.edgeId)
            : '-'
        return (
          <button
            key={step.index}
            type="button"
            data-frame={step.index}
            onClick={() => onStep(step.index)}
            className={clsx(
              'flex w-28 shrink-0 flex-col gap-1 rounded-md border-2 p-2 text-left transition-transform',
              visual === 'failed'
                ? 'scale-105 border-nss-danger bg-nss-danger/10'
                : visual === 'current'
                  ? 'scale-105 border-nss-primary bg-nss-primary/10'
                  : visual === 'done'
                    ? 'border-nss-border bg-nss-surface'
                    : 'border-nss-border/60 bg-nss-surface opacity-60'
            )}
            title={step.detail ?? undefined}
          >
            <div className="flex items-center justify-between">
              <Icon
                size={16}
                className={
                  step.failed
                    ? 'text-nss-danger'
                    : step.state === 'completed'
                      ? 'text-nss-success'
                      : 'text-nss-primary'
                }
              />
              <span className="text-[9px] tabular-nums text-nss-muted">#{step.index + 1}</span>
            </div>
            <div className="truncate text-[11px] font-semibold text-nss-text">
              {STATE_LABEL[step.state]}
            </div>
            <div className="truncate text-[10px] text-nss-muted">{where}</div>
            <div className="flex items-center justify-between text-[9px]">
              <span className="tabular-nums text-nss-muted">{formatDebugMs(step.atMs)}</span>
              <span
                className={clsx(
                  'rounded px-1 font-semibold uppercase',
                  step.failed
                    ? 'bg-nss-danger/15 text-nss-danger'
                    : step.state === 'completed'
                      ? 'bg-nss-success/15 text-nss-success'
                      : 'bg-nss-border/60 text-nss-muted'
                )}
              >
                {step.failed ? 'fail' : step.state === 'completed' ? 'ok' : 'step'}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
