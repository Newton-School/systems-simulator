import { clsx } from 'clsx'
import { NotRecorded } from './NotRecorded'
import { STATE_LABEL, VISUAL_CARD_CLASS, phaseVisualState, type DebugViewProps } from './debuggerUi'
import { formatDebugMs, stepForPhase } from './requestLifecycle'

const RESULT_BADGE: Record<string, string> = {
  generated: 'text-nss-muted border-nss-border',
  passed: 'text-nss-success border-nss-success/30',
  completed: 'text-nss-success border-nss-success/30',
  rejected: 'text-nss-danger border-nss-danger/30',
  timeout: 'text-nss-warning border-nss-warning/30',
  'in-flight': 'text-nss-muted border-nss-border'
}

/** Horizontal row of node-visit cards joined by a progress connector (#156 view 1). */
export function LifecycleRail({ lifecycle, stepIndex, onStep, labelFor }: DebugViewProps) {
  const step = lifecycle.steps[stepIndex]
  const phases = lifecycle.phases
  const currentPhase = step?.phaseIndex ?? 0
  const fillPct = phases.length > 1 ? (currentPhase / (phases.length - 1)) * 100 : 100
  const failedHere = step?.failed === true

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto pb-1">
        <div className="relative w-max px-1 pt-4">
          {/* Connector track from the first card's centre to the last card's centre. */}
          <div className="absolute left-[5.25rem] right-[5.25rem] top-1 h-1 rounded-full bg-nss-border" />
          <div
            className={clsx(
              'absolute left-[5.25rem] top-1 h-1 rounded-full transition-all',
              failedHere ? 'bg-nss-danger' : 'bg-nss-primary'
            )}
            style={{ width: `calc((100% - 10.5rem) * ${fillPct / 100})` }}
          />
          <div className="relative flex gap-3">
            {phases.map((phase) => {
              const visual = phaseVisualState(lifecycle, phase.index, stepIndex)
              const state = phase.admission?.state ?? null
              return (
                <button
                  key={`${phase.nodeId}-${phase.index}`}
                  type="button"
                  onClick={() => onStep(stepForPhase(lifecycle, phase.index))}
                  className={clsx(
                    'w-40 shrink-0 rounded-lg border p-2 text-left transition-all',
                    VISUAL_CARD_CLASS[visual]
                  )}
                  aria-current={visual === 'current' || visual === 'failed' ? 'step' : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-semibold text-nss-text">
                      {labelFor(phase.nodeId)}
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 rounded border px-1 text-[9px] font-semibold uppercase',
                        RESULT_BADGE[phase.result]
                      )}
                    >
                      {phase.result}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[10px] text-nss-muted">
                    {phase.nodeId}
                  </div>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 text-[10px]">
                    {phase.kind === 'source' ? (
                      <dd className="col-span-2 text-nss-muted">Traffic source</dd>
                    ) : state ? (
                      <>
                        <dt className="text-nss-muted">queue</dt>
                        <dd className="tabular-nums text-nss-text">{state.queueLength}</dd>
                        <dt className="text-nss-muted">workers</dt>
                        <dd className="tabular-nums text-nss-text">
                          {state.activeWorkers}/{state.workers}
                        </dd>
                        <dt className="text-nss-muted">capacity</dt>
                        <dd className="tabular-nums text-nss-text">
                          {state.totalInSystem}/{state.capacity}
                        </dd>
                      </>
                    ) : (
                      <dd className="col-span-2">
                        <NotRecorded>occupancy not recorded</NotRecorded>
                      </dd>
                    )}
                    {phase.kind === 'node' && (
                      <>
                        <dt className="text-nss-muted">wait</dt>
                        <dd className="tabular-nums text-nss-text">
                          {formatDebugMs(phase.queueMs)}
                        </dd>
                        <dt className="text-nss-muted">service</dt>
                        <dd className="tabular-nums text-nss-text">
                          {phase.serviceMs === null ? 'none' : formatDebugMs(phase.serviceMs)}
                        </dd>
                      </>
                    )}
                  </dl>
                </button>
              )
            })}
            {lifecycle.terminal && lifecycle.terminal.locusKind === 'edge' && (
              <div className="w-32 shrink-0 self-start rounded-lg border border-nss-danger bg-nss-danger/10 p-2 text-[10px] text-nss-danger">
                Ended on connection {labelFor(lifecycle.terminal.locus)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard
          title="Lifecycle state"
          value={step ? STATE_LABEL[step.state] : '-'}
          tone={failedHere ? 'danger' : 'normal'}
        />
        <SummaryCard
          title="Current node"
          value={
            step?.nodeId
              ? labelFor(step.nodeId)
              : step?.edgeId
                ? `edge ${labelFor(step.edgeId)}`
                : '-'
          }
        />
        <SummaryCard
          title="Current event"
          value={step ? `${step.label} @ ${formatDebugMs(step.atMs)}` : '-'}
        />
        <SummaryCard
          title="Terminal reason"
          value={
            lifecycle.terminal
              ? lifecycle.terminal.cause === 'completed'
                ? 'completed'
                : (lifecycle.terminal.reasonCode ?? lifecycle.terminal.cause)
              : 'still in flight at cutoff'
          }
          tone={
            lifecycle.status === 'success'
              ? 'success'
              : lifecycle.status === 'in-flight'
                ? 'normal'
                : 'danger'
          }
        />
      </div>
    </div>
  )
}

function SummaryCard({
  title,
  value,
  tone = 'normal'
}: {
  title: string
  value: string
  tone?: 'normal' | 'danger' | 'success'
}) {
  return (
    <div className="rounded-md border border-nss-border bg-nss-surface px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-nss-muted">{title}</div>
      <div
        className={clsx(
          'truncate text-xs font-semibold',
          tone === 'danger'
            ? 'text-nss-danger'
            : tone === 'success'
              ? 'text-nss-success'
              : 'text-nss-text'
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
