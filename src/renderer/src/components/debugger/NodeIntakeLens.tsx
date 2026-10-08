import { clsx } from 'clsx'
import { explainAdmission, type LensGauge, type LensSlots } from './admissionExplainer'
import { type DebugViewProps } from './debuggerUi'
import { formatDebugMs, stepForPhase } from './requestLifecycle'

const GRID_COLUMNS = 20

function Gauge({ gauge }: { gauge: LensGauge }) {
  const ratio = gauge.max > 0 ? gauge.value / gauge.max : gauge.value > 0 ? 1 : 0
  const full = gauge.max > 0 ? gauge.value >= gauge.max : gauge.value > 0
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-nss-muted">{gauge.label}</span>
        <span className={clsx('tabular-nums', full ? 'text-nss-danger' : 'text-nss-text')}>
          {gauge.text}
        </span>
      </div>
      <div className="mt-0.5 h-2 rounded-full bg-nss-border">
        <div
          className={clsx('h-2 rounded-full', full ? 'bg-nss-danger' : 'bg-nss-primary')}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </div>
  )
}

function SlotGrid({ slots }: { slots: LensSlots }) {
  const per = slots.slotsPerSquare
  const squares = Math.ceil(slots.capacity / per)
  const activeSq = Math.ceil(slots.active / per)
  const queuedSq = Math.ceil((slots.active + slots.queued) / per) - activeSq
  const heldSq = Math.ceil((slots.active + slots.queued + slots.held) / per) - activeSq - queuedSq
  const arrivingSq = slots.arrivingInside ? activeSq + queuedSq + heldSq : -1
  const cells = Array.from({ length: squares }, (_, index) => {
    if (index === arrivingSq) return 'arriving'
    if (index < activeSq) return 'active'
    if (index < activeSq + queuedSq) return 'queued'
    if (index < activeSq + queuedSq + heldSq) return 'held'
    return 'free'
  })
  return (
    <div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${Math.min(GRID_COLUMNS, squares)}, 0.7rem)` }}
        aria-label={`${slots.capacity} capacity slots`}
      >
        {cells.map((cell, index) => (
          <span
            key={index}
            className={clsx(
              'h-[0.7rem] w-[0.7rem] rounded-[2px]',
              cell === 'active'
                ? 'bg-nss-primary'
                : cell === 'queued'
                  ? 'bg-nss-warning'
                  : cell === 'held'
                    ? 'bg-nss-muted'
                    : cell === 'arriving'
                      ? 'bg-nss-success ring-1 ring-nss-success'
                      : 'border border-nss-border bg-nss-surface'
            )}
          />
        ))}
        {!slots.arrivingInside && (
          <span
            className="h-[0.7rem] w-[0.7rem] rounded-[2px] bg-nss-danger ring-2 ring-nss-danger/40"
            title="The arriving request - no slot left"
          />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-nss-muted">
        <Legend className="bg-nss-primary" label={`active ${slots.active}`} />
        <Legend className="bg-nss-warning" label={`queued ${slots.queued}`} />
        {slots.held > 0 && <Legend className="bg-nss-muted" label={`held ${slots.held}`} />}
        <Legend
          className={slots.arrivingInside ? 'bg-nss-success' : 'bg-nss-danger'}
          label={slots.arrivingInside ? 'this request (admitted)' : 'this request (refused)'}
        />
        <span>
          K = {slots.capacity}
          {per > 1 ? ` - 1 square = ${per} slots` : ''}
        </span>
      </div>
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('inline-block h-2 w-2 rounded-[2px]', className)} /> {label}
    </span>
  )
}

/** Picks the node visit to explain: the current one, else the failure, else the last. */
function lensPhaseIndex(props: DebugViewProps): number {
  const { lifecycle, stepIndex } = props
  const current = lifecycle.phases[lifecycle.steps[stepIndex]?.phaseIndex ?? -1]
  if (current && current.kind === 'node') return current.index
  if (lifecycle.failureStepIndex !== null) {
    return lifecycle.steps[lifecycle.failureStepIndex].phaseIndex
  }
  const nodes = lifecycle.phases.filter((phase) => phase.kind === 'node')
  return nodes[nodes.length - 1]?.index ?? 0
}

/** Admission decision explainer for one node visit (#157 view 1). */
export function NodeIntakeLens(props: DebugViewProps) {
  const { lifecycle, onStep, labelFor } = props
  const phaseIndex = lensPhaseIndex(props)
  const phase = lifecycle.phases[phaseIndex]
  if (!phase) return null
  const lens = explainAdmission(
    phase,
    lifecycle.terminal,
    phaseIndex === lifecycle.phases.length - 1
  )
  const rejected = lens.outcome === 'rejected' || lens.outcome === 'dropped'
  const tone = rejected
    ? 'border-nss-danger bg-nss-danger/5'
    : lens.outcome === 'queued'
      ? 'border-nss-warning bg-nss-warning/5'
      : 'border-nss-success bg-nss-success/5'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-nss-muted">Node visit</span>
        {lifecycle.phases
          .filter((candidate) => candidate.kind === 'node')
          .map((candidate) => (
            <button
              key={`${candidate.nodeId}-${candidate.index}`}
              type="button"
              onClick={() => onStep(stepForPhase(lifecycle, candidate.index))}
              className={clsx(
                'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                candidate.index === phaseIndex
                  ? 'border-nss-primary bg-nss-primary/10 text-nss-primary'
                  : 'border-nss-border text-nss-muted hover:text-nss-text'
              )}
            >
              {labelFor(candidate.nodeId)}
            </button>
          ))}
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-semibold text-nss-text">{labelFor(phase.nodeId)}</span>
        <span
          className={clsx(
            'rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
            rejected
              ? 'border-nss-danger/30 text-nss-danger'
              : lens.outcome === 'queued'
                ? 'border-nss-warning/30 text-nss-warning'
                : 'border-nss-success/30 text-nss-success'
          )}
        >
          {lens.outcome}
        </span>
        <span className="text-[11px] text-nss-muted">
          rule: <span className="text-nss-text">{lens.ruleLabel}</span>
          {lens.stage ? ` - checked at the ${lens.stage} stage` : ''}
          {phase.arrivalMs !== null ? ` - arrived at ${formatDebugMs(phase.arrivalMs)}` : ''}
        </span>
      </div>

      {lens.rule === 'node_failed' || lens.rule === 'held_failed' ? (
        <div className="rounded-md border border-nss-danger bg-nss-danger/10 px-3 py-2 text-sm font-bold uppercase tracking-wider text-nss-danger">
          Node status: FAILED
        </div>
      ) : lens.gauges.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-[minmax(10rem,16rem)_1fr]">
          <div className="space-y-2">
            {lens.gauges.map((gauge) => (
              <Gauge key={gauge.label} gauge={gauge} />
            ))}
          </div>
          {lens.slots && <SlotGrid slots={lens.slots} />}
        </div>
      ) : null}

      <div className={clsx('rounded-md border-2 p-3', tone)}>
        {lens.equation && (
          <div className="mb-1.5 font-mono text-xs">
            <div className="text-nss-muted">{lens.equation.expression}</div>
            <div
              className={clsx(
                'text-sm font-semibold',
                lens.equation.holds && rejected ? 'text-nss-danger' : 'text-nss-text'
              )}
            >
              {lens.equation.substituted}
            </div>
          </div>
        )}
        <p className="text-xs text-nss-text">{lens.explanation}</p>
        {lens.afterAdmission && (
          <p className="mt-1 text-xs font-medium text-nss-danger">{lens.afterAdmission}</p>
        )}
        {lens.traitDetail.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-[10px]">
            {lens.traitDetail.map((entry) => (
              <div key={entry.key} className="contents">
                <dt className="font-mono text-nss-muted">{entry.key}</dt>
                <dd className="font-mono text-nss-text">{entry.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="grid gap-2 text-[10px] text-nss-muted md:grid-cols-2">
        {lens.checks.length > 0 && (
          <div>
            <div className="mb-0.5 font-semibold uppercase tracking-wider">
              Admission traits, in order
            </div>
            <ol className="space-y-0.5">
              {lens.checks.map((check, index) => (
                <li key={`${check.traitName}-${index}`} className="font-mono">
                  {check.traitName}:{' '}
                  <span
                    className={check.decision === 'rejected' ? 'text-nss-danger' : 'text-nss-text'}
                  >
                    {check.decision}
                    {check.reasonCode ? ` (${check.reasonCode})` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="space-y-0.5">
          {lens.provenance && (
            <div>
              c and K: <span className="font-mono text-nss-text">{lens.provenance}</span>
            </div>
          )}
          <div>
            Order of checks: security policy, then admission traits, then the G/G/c/K queue (failed
            node, then active + queued &gt;= K, then active &lt; c).
          </div>
          {lens.unavailable.map((item) => (
            <div key={item} className="italic">
              Not recorded: {item}.
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
