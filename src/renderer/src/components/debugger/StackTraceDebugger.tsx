import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { NotRecorded } from './NotRecorded'
import {
  STATE_HANDLER,
  STATE_LABEL,
  phaseVisualState,
  statusTone,
  type DebugViewProps
} from './debuggerUi'
import { formatDebugMs, stepForPhase } from './requestLifecycle'

/**
 * IDE-debugger metaphor (#156 view 3): call stack of node visits on the left,
 * the current frame's locals in the middle, raw step metadata and a timing
 * waterfall on the right.
 */
export function StackTraceDebugger({ lifecycle, stepIndex, onStep, labelFor }: DebugViewProps) {
  const step = lifecycle.steps[stepIndex]
  const phase = step ? lifecycle.phases[step.phaseIndex] : null
  const state = phase?.admission?.state ?? null
  const progressPct =
    lifecycle.steps.length > 1 ? (stepIndex / (lifecycle.steps.length - 1)) * 100 : 100
  const where = step?.nodeId
    ? labelFor(step.nodeId)
    : step?.edgeId
      ? `connection ${labelFor(step.edgeId)}`
      : '-'
  const headline = step ? `${STATE_LABEL[step.state]} at ${where}` : '-'
  const reason =
    step?.failed && lifecycle.terminal
      ? (lifecycle.terminal.reasonCode ?? lifecycle.terminal.cause)
      : (phase?.admission?.reasonCode ?? null)
  const totalMs = lifecycle.totalMs || 1

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(10rem,14rem)_1fr_minmax(12rem,16rem)]">
      <div className="rounded-md border border-nss-border bg-nss-panel">
        <div className="border-b border-nss-border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Call stack
        </div>
        <ol className="max-h-72 overflow-y-auto">
          {[...lifecycle.phases].reverse().map((frame) => {
            const visual = phaseVisualState(lifecycle, frame.index, stepIndex)
            const lastStep = lifecycle.steps[frame.lastStep]
            return (
              <li key={`${frame.nodeId}-${frame.index}`}>
                <button
                  type="button"
                  onClick={() => onStep(stepForPhase(lifecycle, frame.index))}
                  className={clsx(
                    'block w-full border-l-2 px-2 py-1.5 text-left',
                    visual === 'failed'
                      ? 'border-nss-danger bg-nss-danger/10'
                      : visual === 'current'
                        ? 'border-nss-primary bg-nss-primary/10'
                        : visual === 'done'
                          ? 'border-nss-success/60'
                          : 'border-transparent opacity-60'
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-semibold text-nss-text">
                      #{frame.index} {labelFor(frame.nodeId)}
                    </span>
                    <span className="shrink-0 text-[9px] uppercase text-nss-muted">
                      {frame.result}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10px] text-nss-muted">
                    {frame.nodeId}
                  </div>
                  {lastStep && (
                    <div className="truncate text-[10px] text-nss-muted">
                      {STATE_LABEL[lastStep.state]} @ {formatDebugMs(lastStep.atMs)}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="space-y-2 rounded-md border border-nss-border bg-nss-surface p-3">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'rounded border px-1.5 py-0.5 font-mono text-[10px]',
              statusTone(lifecycle.status)
            )}
          >
            {lifecycle.requestId}
          </span>
          <span className="text-[10px] text-nss-muted">
            step {stepIndex + 1} / {lifecycle.steps.length}
          </span>
        </div>
        <div
          className={clsx(
            'text-base font-semibold',
            step?.failed ? 'text-nss-danger' : 'text-nss-text'
          )}
        >
          {headline}
        </div>
        <div className="h-1.5 rounded-full bg-nss-border">
          <div
            className={clsx(
              'h-1.5 rounded-full transition-all',
              step?.failed ? 'bg-nss-danger' : 'bg-nss-primary'
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Locals
        </div>
        <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <Local name="nodeId" value={step?.nodeId ?? step?.edgeId ?? null} mono />
          <Local name="eventType" value={step ? step.state : null} mono />
          <Local name="reason" value={reason} mono emptyText="none" />
          <Local
            name="queueLength"
            value={state ? String(state.queueLength) : null}
            emptyText="not recorded"
          />
          <Local
            name="workers"
            value={state ? `${state.activeWorkers}/${state.workers}` : null}
            emptyText="not recorded"
          />
          <Local
            name="capacity"
            value={state ? `${state.totalInSystem}/${state.capacity}` : null}
            emptyText="not recorded"
          />
        </dl>
        {phase?.kind === 'node' && state && (
          <p className="text-[10px] text-nss-muted">
            Occupancy is the node&apos;s counters when this request reached admission at{' '}
            {formatDebugMs(phase.arrivalMs)}, before it was counted.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-nss-border bg-nss-panel p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Event metadata
        </div>
        {step && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px]">
            <Meta name="step">{step.index}</Meta>
            <Meta name="state">{step.state}</Meta>
            <Meta name="handler">{STATE_HANDLER[step.state]}</Meta>
            <Meta name="time">{formatDebugMs(step.atMs)}</Meta>
            <Meta name="node">{step.nodeId ?? '-'}</Meta>
            <Meta name="edge">{step.edgeId ?? '-'}</Meta>
            <Meta name="detail">{step.detail ?? '-'}</Meta>
            {phase?.admission && (
              <>
                <Meta name="admission">
                  {phase.admission.stage} / {phase.admission.outcome}
                </Meta>
                {phase.admission.traitName && <Meta name="trait">{phase.admission.traitName}</Meta>}
              </>
            )}
          </dl>
        )}
        <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Waterfall
        </div>
        <div className="space-y-1">
          {lifecycle.phases
            .filter((frame) => frame.kind === 'node')
            .map((frame) => {
              const start = frame.arrivalMs ?? 0
              const queue = frame.queueMs ?? 0
              const service = frame.serviceMs ?? 0
              const failed = frame.result === 'rejected' || frame.result === 'timeout'
              return (
                <div key={`${frame.nodeId}-${frame.index}`}>
                  <div className="truncate text-[9px] text-nss-muted">{labelFor(frame.nodeId)}</div>
                  <div className="relative h-2 rounded bg-nss-surface">
                    {queue > 0 && (
                      <div
                        className="absolute inset-y-0 bg-nss-primary/30"
                        style={{
                          left: `${(start / totalMs) * 100}%`,
                          width: `${Math.max(0.8, (queue / totalMs) * 100)}%`
                        }}
                      />
                    )}
                    <div
                      className={clsx(
                        'absolute inset-y-0 rounded',
                        failed ? 'bg-nss-danger' : 'bg-nss-primary'
                      )}
                      style={{
                        left: `${((start + queue) / totalMs) * 100}%`,
                        width: `${Math.max(0.8, (service / totalMs) * 100)}%`
                      }}
                    />
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

function Local({
  name,
  value,
  mono = false,
  emptyText = 'not recorded'
}: {
  name: string
  value: string | null
  mono?: boolean
  emptyText?: string
}) {
  return (
    <div className="rounded border border-nss-border bg-nss-panel px-2 py-1">
      <dt className="text-[9px] text-nss-muted">{name}</dt>
      <dd className={clsx('truncate text-[11px] text-nss-text', mono && 'font-mono')}>
        {value ?? <NotRecorded>{emptyText}</NotRecorded>}
      </dd>
    </div>
  )
}

function Meta({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-nss-muted">{name}</dt>
      <dd className="break-words font-mono text-nss-text">{children}</dd>
    </>
  )
}
