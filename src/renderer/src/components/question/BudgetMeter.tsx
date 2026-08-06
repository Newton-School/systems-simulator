import { useMemo, useState } from 'react'
import { budgetBreakdown } from '../../../../engine/analysis/budget'
import type { Budget } from '../../../../engine/analysis/gradingCriteria'
import type { TopologyJSON } from '../../../../engine/core/types'

const SECTION_TITLE = 'text-[10px] font-bold uppercase tracking-widest text-nss-muted'

const UNIT_LABEL: Record<Budget['unit'], string> = {
  cost: 'capacity cost',
  nodes: 'node count',
  edges: 'edge count'
}

/**
 * Live budget meter for the question brief. Recomputes on every topology change
 * (pure, no simulation) so a student sees cost rise as they add/size components,
 * with an expandable breakdown of *why* the cost is what it is. Rendered only
 * when the active question declares a `budget`.
 */
export function BudgetMeter({
  budget,
  topology
}: {
  budget: Budget
  topology: TopologyJSON
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const b = useMemo(() => budgetBreakdown(topology, budget), [topology, budget])

  const ratio = budget.cap > 0 ? b.actual / budget.cap : 0
  const pct = Math.min(100, Math.round(ratio * 100))
  const over = !b.withinBudget
  const near = !over && ratio >= 0.8

  const tone = over
    ? {
        text: 'text-nss-danger',
        bar: 'bg-nss-danger',
        track: 'bg-nss-danger/15',
        border: 'border-nss-danger/30'
      }
    : near
      ? {
          text: 'text-nss-warning',
          bar: 'bg-nss-warning',
          track: 'bg-nss-warning/15',
          border: 'border-nss-warning/30'
        }
      : {
          text: 'text-nss-success',
          bar: 'bg-nss-success',
          track: 'bg-nss-success/15',
          border: 'border-nss-border'
        }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className={SECTION_TITLE}>Budget · {UNIT_LABEL[budget.unit]}</h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] font-semibold uppercase tracking-wider text-nss-muted hover:text-nss-text"
        >
          {open ? 'Hide' : 'Breakdown'}
        </button>
      </div>

      <div className={`rounded-md border ${tone.border} bg-nss-surface px-3 py-2`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className={`text-sm font-semibold tabular-nums ${tone.text}`}>
            {b.actual} <span className="text-nss-muted">/ {budget.cap}</span>
          </span>
          <span className={`text-[11px] font-semibold ${tone.text}`}>
            {over ? 'Over budget' : near ? 'Near cap' : 'Within budget'}
          </span>
        </div>

        <div className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${tone.track}`}>
          <div
            className={`h-full rounded-full transition-all ${tone.bar}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>

        {budget.unit === 'cost' && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-nss-muted">
            Estimated capacity cost (v1 heuristic): each node charges 1 + replicas + ⌈workers/50⌉,
            plus 1 per edge.
          </p>
        )}
      </div>

      {open && (
        <div className="overflow-hidden rounded-md border border-nss-border">
          <table className="w-full text-[11px]">
            <tbody>
              {b.items.map((item) => (
                <tr key={item.id} className="border-b border-nss-border/60 last:border-0">
                  <td className="px-2 py-1 text-nss-text">
                    {item.label}
                    <span className="ml-1 text-nss-muted">· {item.kind}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[10px] text-nss-muted">
                    {item.formula}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-nss-text">
                    {item.cost}
                  </td>
                </tr>
              ))}
              <tr className="bg-nss-surface">
                <td className="px-2 py-1 font-semibold text-nss-text" colSpan={2}>
                  Total
                </td>
                <td className={`px-2 py-1 text-right font-semibold tabular-nums ${tone.text}`}>
                  {b.actual}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
