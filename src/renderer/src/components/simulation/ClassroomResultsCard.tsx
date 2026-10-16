import type { ClassroomRunSummary } from '../../../../engine/classroom/runSummary'
import {
  formatCostPerHour,
  formatPercent,
  formatRps
} from '../../../../engine/classroom/givensTable'

/**
 * Classroom results: one bar per component against the target line, served vs
 * offered, dropped, and cost. Every number here can be checked with the napkin
 * formula: utilization = traffic ÷ (capacity × copies).
 */
export function ClassroomResultsCard({
  summary
}: {
  summary: ClassroomRunSummary
}): React.JSX.Element {
  const target = summary.targetUtilization
  const anyOver = summary.components.some((component) => component.overTarget)
  return (
    <section
      className="space-y-3 rounded-md border border-nss-border bg-nss-surface px-4 py-3"
      aria-labelledby="classroom-results-title"
      data-testid="classroom-results"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="classroom-results-title" className="text-xs font-semibold text-nss-text">
          Classroom results
        </h3>
        {target !== undefined && (
          <span className="text-[10px] uppercase tracking-wide text-nss-muted">
            Target: at or below {formatPercent(target)}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {summary.offeredRps !== undefined && (
          <div>
            <dt className="text-nss-muted">Offered</dt>
            <dd className="font-semibold tabular-nums">{formatRps(summary.offeredRps)}</dd>
          </div>
        )}
        <div>
          <dt className="text-nss-muted">Served</dt>
          <dd className="font-semibold tabular-nums">{formatRps(summary.servedRps)}</dd>
        </div>
        <div>
          <dt className="text-nss-muted">Dropped</dt>
          <dd
            className={`font-semibold tabular-nums ${summary.droppedShare > 0 ? 'text-nss-danger' : ''}`}
          >
            {formatPercent(summary.droppedShare)}
          </dd>
        </div>
        {summary.costPerHour !== undefined && (
          <div>
            <dt className="text-nss-muted">Cost</dt>
            <dd className="font-semibold tabular-nums">{formatCostPerHour(summary.costPerHour)}</dd>
          </div>
        )}
      </dl>

      {summary.components.length > 0 && (
        <ul className="space-y-1.5" aria-label="Utilization per component">
          {summary.components.map((component) => {
            const shown = Math.min(component.utilization, 1)
            return (
              <li key={component.nodeId} className="space-y-0.5">
                <div className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="truncate text-nss-text">
                    {component.label}
                    {component.copies > 1 ? ` ×${component.copies}` : ''}
                  </span>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${component.overTarget ? 'text-nss-danger' : 'text-nss-success'}`}
                  >
                    {formatPercent(component.utilization)}
                  </span>
                </div>
                <div className="relative h-2 rounded bg-nss-border/50">
                  <div
                    className={`h-2 rounded ${component.overTarget ? 'bg-nss-danger' : 'bg-nss-success'}`}
                    style={{ width: `${shown * 100}%` }}
                  />
                  {target !== undefined && (
                    <div
                      className="absolute -top-0.5 h-3 w-0.5 bg-nss-text"
                      style={{ left: `${target * 100}%` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {target !== undefined && summary.components.length > 0 && (
        <p className="text-[11px] leading-relaxed text-nss-muted">
          {anyOver
            ? 'Some components are above the target, so they have no room for a burst.'
            : 'Every component is within the target.'}{' '}
          Utilization = traffic ÷ (capacity × copies).
        </p>
      )}
    </section>
  )
}
