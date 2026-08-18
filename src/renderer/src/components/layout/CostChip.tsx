import { useMemo, useRef, useState, useEffect } from 'react'
import { DollarSign } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import { topologyCost, formatCostPerHour, evaluateBudgets } from '../../../../engine/analysis/cost'

/**
 * Always-on infrastructure cost chip in the header. Cost is a first-class output
 * shown on EVERY topology — regardless of whether a question is loaded or a budget
 * cap exists ("unbounded" means no gate, never no number). Recomputes on every
 * canvas change (pure, no simulation); click to expand a per-node breakdown of
 * which component drives the bill. Provisioned compute only (v1).
 */
export function CostChip(): React.JSX.Element {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const resourceBudget = useStore((s) => s.environmentProfile.capabilities.resourceBudget)
  const costBudget = useStore((s) => s.environmentProfile.capabilities.costBudget)
  const lastRunOutput = useStore((s) => s.lastRunOutput)
  const { serialize } = useTopologySerializer()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { cost, budget } = useMemo(() => {
    try {
      const topology = serialize().topology
      if (!topology) return { cost: null, budget: null }
      // Post-run: switch traffic-dependent estimates (consumption, egress) to the
      // measured figures from the last run's per-node throughput / per-edge bytes.
      const run = lastRunOutput
        ? {
            nodeThroughput: Object.fromEntries(
              Object.entries(lastRunOutput.perNode).map(([id, m]) => [id, m.throughput])
            ),
            edgeBytes: Object.fromEntries(
              Object.entries(lastRunOutput.perEdge).map(([id, m]) => [id, m.bytesTransferred])
            ),
            durationSec: lastRunOutput.summary.postWarmupDurationSec
          }
        : undefined
      return {
        cost: topologyCost(topology, run),
        budget: evaluateBudgets(topology, { resourceBudget, costBudget })
      }
    } catch {
      return { cost: null, budget: null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, serialize, resourceBudget, costBudget, lastRunOutput])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const total = cost?.totalPerHour ?? 0
  const hasNodes = (cost?.items.length ?? 0) > 0
  const hasBudget = Boolean(budget && (budget.vcpu || budget.cost))
  const overBudget = Boolean(budget && !budget.allWithin)

  const tone = overBudget
    ? 'border-nss-danger/40 text-nss-danger'
    : hasBudget
      ? 'border-nss-success/40 text-nss-text'
      : 'border-nss-border text-nss-text'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasNodes}
        title="Provisioned infrastructure cost (per hour)"
        className={`flex items-center gap-1 rounded-md border bg-nss-surface px-2 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-nss-muted disabled:cursor-default disabled:opacity-50 ${tone}`}
      >
        <DollarSign size={13} className={overBudget ? 'text-nss-danger' : 'text-nss-muted'} />
        {total > 0 ? `$${total.toFixed(2)}` : '$0'}
        {budget?.cost ? (
          <span className="text-nss-muted">/ ${budget.cost.cap.toFixed(2)}</span>
        ) : (
          <span className="text-nss-muted">/hr</span>
        )}
      </button>

      {open && cost && hasNodes && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-md border border-nss-border bg-nss-panel shadow-lg">
          <div className="flex items-baseline justify-between border-b border-nss-border px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">
              Cost · provisioned $/hr
            </span>
            <span className="text-[11px] font-semibold text-nss-muted">
              ≈ ${(total * 730).toFixed(0)}/mo
            </span>
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              {cost.items.map((item) => (
                <tr key={item.id} className="border-b border-nss-border/60 last:border-0">
                  <td className="px-3 py-1 text-nss-text">
                    {item.label}
                    <span className="ml-1 text-nss-muted">· {item.kind}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[10px] text-nss-muted">
                    {item.formula}
                  </td>
                  <td className="px-3 py-1 text-right font-semibold tabular-nums text-nss-text">
                    {item.priced ? formatCostPerHour(item.costPerHour) : '—'}
                  </td>
                </tr>
              ))}
              <tr className="bg-nss-surface">
                <td className="px-3 py-1 font-semibold text-nss-text" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-1 text-right font-semibold tabular-nums text-nss-text">
                  {formatCostPerHour(total)}
                </td>
              </tr>
            </tbody>
          </table>
          {budget && hasBudget && (
            <div className="border-t border-nss-border px-3 py-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-nss-muted">
                Budget
              </div>
              <div className="space-y-1 text-[11px]">
                {budget.cost && (
                  <BudgetRow
                    label="Cost"
                    used={`$${budget.cost.used.toFixed(2)}/hr`}
                    cap={`$${budget.cost.cap.toFixed(2)}/hr`}
                    within={budget.cost.within}
                  />
                )}
                {budget.vcpu && (
                  <BudgetRow
                    label="vCPU"
                    used={String(budget.vcpu.used)}
                    cap={String(budget.vcpu.cap)}
                    within={budget.vcpu.within}
                  />
                )}
                {budget.ramGb && (
                  <BudgetRow
                    label="RAM"
                    used={`${budget.ramGb.used} GB`}
                    cap={`${budget.ramGb.cap} GB`}
                    within={budget.ramGb.within}
                  />
                )}
              </div>
            </div>
          )}
          {cost.hasUnpricedNodes && (
            <p className="border-t border-nss-border px-3 py-1.5 text-[10px] leading-relaxed text-nss-muted">
              Components with no instance type are counted as $0.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function BudgetRow({
  label,
  used,
  cap,
  within
}: {
  label: string
  used: string
  cap: string
  within: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-nss-muted">{label}</span>
      <span
        className={`font-semibold tabular-nums ${within ? 'text-nss-text' : 'text-nss-danger'}`}
      >
        {used} <span className="text-nss-muted">/ {cap}</span>
        {!within && <span className="ml-1 text-nss-danger">over</span>}
      </span>
    </div>
  )
}
