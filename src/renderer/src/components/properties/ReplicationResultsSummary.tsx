import { Activity } from 'lucide-react'
import { clsx } from 'clsx'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { AnyNodeData } from '@renderer/types/ui'
import { buildReplicationResultsSummary } from './replicationInspector'

const TONE_STYLES = {
  healthy: 'border-nss-success/35 bg-nss-success/10 text-nss-success',
  info: 'border-nss-info/35 bg-nss-info/10 text-nss-info',
  warning: 'border-nss-warning/35 bg-nss-warning/10 text-nss-warning'
} as const

export function ReplicationResultsSummary({
  nodeId,
  data,
  traitCounters,
  consistency
}: {
  nodeId: string
  data: AnyNodeData
  traitCounters?: Record<string, number>
  consistency?: SimulationOutput['consistency']
}) {
  const summary = buildReplicationResultsSummary({
    nodeId,
    data,
    traitCounters,
    consistency
  })
  if (!summary) return null

  return (
    <section
      aria-label="Replication results"
      className="mb-4 overflow-hidden rounded-lg border border-nss-border bg-nss-surface"
    >
      <div className="flex items-start gap-3 border-b border-nss-border px-3 py-3">
        <div className="mt-0.5 rounded-md bg-nss-info/10 p-1.5 text-nss-info">
          <Activity size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-nss-text">Replication</h3>
            <span
              className={clsx(
                'rounded-full border px-2 py-1 text-[9px] font-bold uppercase leading-none tracking-wide',
                TONE_STYLES[summary.tone]
              )}
            >
              {summary.status}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-nss-muted">{summary.detail}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-nss-border">
        {summary.metrics.map((metric) => (
          <div key={metric.label} className="bg-nss-surface px-3 py-2.5">
            <dt className="text-[9px] font-semibold uppercase tracking-wide text-nss-muted">
              {metric.label}
            </dt>
            <dd className="mt-1 truncate text-sm font-semibold tabular-nums text-nss-text">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
