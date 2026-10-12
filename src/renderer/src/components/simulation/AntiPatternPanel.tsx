import { AlertTriangle, CheckCircle2, OctagonAlert } from 'lucide-react'
import type { AntiPatternWarning } from '../../../../engine/analysis/antiPatterns'

/**
 * List view over `detectAntiPatterns()` output. Static analysis of the
 * topology, so it works before any run. Each warning names the components
 * involved; clicking one selects it on the canvas.
 */
export function AntiPatternPanel({
  warnings,
  labelFor,
  onSelectNode
}: {
  warnings: AntiPatternWarning[]
  labelFor: (nodeId: string) => string
  onSelectNode: (nodeId: string) => void
}): React.JSX.Element {
  if (warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-nss-muted">
        <CheckCircle2 size={14} className="shrink-0 text-nss-success" />
        No anti-patterns detected.
      </div>
    )
  }

  return (
    <ul className="divide-y divide-nss-border/60" data-testid="anti-pattern-list">
      {warnings.map((warning) => {
        const critical = warning.severity === 'critical'
        const Icon = critical ? OctagonAlert : AlertTriangle
        return (
          <li key={warning.id} className="px-3 py-2.5" data-testid="anti-pattern-item">
            <div className="flex items-start gap-2">
              <Icon
                size={14}
                className={`mt-0.5 shrink-0 ${critical ? 'text-nss-danger' : 'text-nss-warning'}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-nss-text">{warning.title}</span>
                  <span
                    className={`rounded border px-1 text-[9px] font-bold uppercase tracking-wide ${
                      critical
                        ? 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger'
                        : 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
                    }`}
                  >
                    {critical ? 'Critical' : 'Warning'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-nss-muted">{warning.message}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-nss-text">
                  <span className="font-semibold">Fix: </span>
                  {warning.recommendation}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {warning.nodeIds.map((nodeId) => (
                    <button
                      key={nodeId}
                      type="button"
                      onClick={() => onSelectNode(nodeId)}
                      title="Select on canvas"
                      className="rounded border border-nss-border bg-nss-surface px-1.5 py-0.5 text-[10px] font-medium text-nss-primary transition-colors hover:border-nss-primary/40"
                    >
                      {labelFor(nodeId)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
