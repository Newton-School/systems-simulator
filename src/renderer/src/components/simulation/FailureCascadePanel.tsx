import { useMemo } from 'react'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import type { CausalGraphNode } from '../../../../engine/analysis/output'
import { buildCascadeTrees, cascadeEffectLabel, type CascadeRow } from './failureCascade'
import { useFocusNodeOnCanvas } from './useFocusNodeOnCanvas'

const SECTION_TITLE = 'text-[11px] font-semibold text-nss-muted uppercase tracking-wider'
const SURFACE_CARD = 'bg-nss-surface border border-nss-border rounded-md'

function fmtSimTime(ms: number): string {
  if (ms < 1000) return `t=${ms.toFixed(ms < 10 ? 2 : 0)}ms`
  return `t=${(ms / 1000).toFixed(2)}s`
}

function fmtDuration(ms: number): string {
  if (ms === 0) return '0ms'
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
}

function signalSummary(detail: CausalGraphNode | null): string | null {
  if (!detail) return null
  const parts: string[] = []
  if (detail.rejected > 0) {
    parts.push(
      `${plural(detail.rejected, 'rejection')}${
        detail.dominantReason ? ` (mostly ${detail.dominantReason.replace(/_/g, ' ')})` : ''
      }`
    )
  }
  if (detail.timedOut > 0) parts.push(plural(detail.timedOut, 'timeout'))
  if (detail.circuitOpens > 0) parts.push(`circuit opened ${plural(detail.circuitOpens, 'time')}`)
  return parts.length > 0 ? parts.join(' - ') : 'no failed requests recorded here'
}

function SeverityBadge({ severity }: { severity: CascadeRow['severity'] }) {
  return severity === 'failed' ? (
    <span className="shrink-0 rounded border border-nss-danger/20 bg-nss-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-nss-danger">
      ✗ Failed
    </span>
  ) : (
    <span className="shrink-0 rounded border border-nss-warning/20 bg-nss-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-nss-warning">
      ⚠ Degraded
    </span>
  )
}

function ImpactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${SURFACE_CARD} p-2`}>
      <div className="text-xs text-nss-muted">{label}</div>
      <div className="text-sm font-medium tabular-nums text-nss-text">{value}</div>
    </div>
  )
}

export function FailureCascadePanel({ output }: { output: SimulationOutput }) {
  const focusNode = useFocusNodeOnCanvas()
  const graph = output.causalGraph
  const trees = useMemo(() => (graph ? buildCascadeTrees(graph) : []), [graph])
  const labelFor = (nodeId: string) => output.perNode[nodeId]?.nodeLabel ?? nodeId
  const failedRequests = output.summary.rejectedRequests + output.summary.timedOutRequests

  if (!graph) {
    return (
      <div className="space-y-2">
        <h3 className={SECTION_TITLE}>Failure Cascade</h3>
        <div className="rounded border border-dashed border-nss-border bg-nss-panel px-3 py-4 text-xs text-nss-muted">
          Failure cascade analysis is not available for this run. It needs the event-driven
          simulator; analytic (rate-based) runs do not record when each node started failing.
        </div>
      </div>
    )
  }

  if (trees.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className={SECTION_TITLE}>Failure Cascade</h3>
        <div className="rounded border border-dashed border-nss-border bg-nss-panel px-3 py-4 text-xs text-nss-muted space-y-1">
          <div className="text-nss-text">
            No failures detected. Your system handled the workload without cascading issues.
          </div>
          {failedRequests > 0 && (
            <div>
              {plural(failedRequests, 'request')} still failed without a node being at fault (for
              example edge errors or packet loss on a connection). See Bottlenecks for where they
              failed.
            </div>
          )}
        </div>
      </div>
    )
  }

  const { impactSummary } = graph
  const hasPropagation = graph.propagation.length > 0

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className={SECTION_TITLE}>Impact</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <ImpactTile label="Root causes" value={graph.rootCauses.length.toLocaleString()} />
          <ImpactTile
            label="Nodes affected"
            value={impactSummary.totalNodesAffected.toLocaleString()}
          />
          <ImpactTile
            label="Cascade depth"
            value={`${impactSummary.cascadeDepth} step${impactSummary.cascadeDepth === 1 ? '' : 's'}`}
          />
          <ImpactTile
            label="First failure to last affected"
            value={fmtDuration(impactSummary.timeToFullCascade)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className={SECTION_TITLE}>
          {trees.length === 1 ? 'What broke first' : `${trees.length} independent failures`}
        </h3>
        {trees.map((tree) => (
          <div key={tree.rootNodeId} className={`${SURFACE_CARD} overflow-hidden`}>
            {tree.rows.map((row) => {
              const isRoot = row.depth === 0
              const summary = signalSummary(row.detail)
              return (
                <div
                  key={row.nodeId}
                  className={`flex items-start gap-3 border-b border-nss-border px-3 py-2 last:border-b-0 ${
                    isRoot ? 'bg-nss-danger/10' : ''
                  }`}
                >
                  <span className="w-20 shrink-0 pt-0.5 text-[11px] tabular-nums text-nss-muted">
                    {fmtSimTime(row.timeMs)}
                  </span>
                  <div
                    className="min-w-0 flex-1"
                    style={{ paddingLeft: `${Math.min(row.depth, 6) * 16}px` }}
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {!isRoot && <span className="text-nss-muted">└►</span>}
                      <button
                        type="button"
                        onClick={() => focusNode(row.nodeId)}
                        className={`truncate text-left text-nss-text hover:text-nss-primary hover:underline ${
                          isRoot ? 'text-sm font-semibold' : 'text-xs font-medium'
                        }`}
                        title="Select on canvas"
                      >
                        {labelFor(row.nodeId)}
                      </button>
                      <span
                        className={`text-[11px] ${isRoot ? 'text-nss-danger' : 'text-nss-warning'}`}
                      >
                        {cascadeEffectLabel(row.effect)}
                      </span>
                      {row.fromNodeId && (
                        <span className="text-[10px] text-nss-muted">
                          after {labelFor(row.fromNodeId)}
                        </span>
                      )}
                    </div>
                    {summary && <div className="mt-0.5 text-[10px] text-nss-muted">{summary}</div>}
                  </div>
                  <SeverityBadge severity={row.severity} />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="space-y-1 text-[10px] text-nss-muted">
        <p>
          Inferred from timing and topology: a node is placed under a failing dependency it calls
          (directly or through nodes that did not fail) when its own failures started at or after
          that dependency&apos;s. An injected fault is always a root cause.
        </p>
        {!hasPropagation && (
          <p>
            No caller recorded failures of its own, so nothing cascaded. Requests that failed at a
            broken node are counted on that node; a caller only appears here when it fails itself,
            for example when its circuit breaker opens or its own queue fills.
          </p>
        )}
      </div>
    </div>
  )
}
