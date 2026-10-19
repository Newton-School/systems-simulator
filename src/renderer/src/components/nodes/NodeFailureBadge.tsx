import { HEALTH_META, getHealthPreset, normalizeErrorRate } from '../properties/nodeHealth'

/**
 * Marks a node that has an injected failure (Chaos > Inject failure), so a node you took down
 * or degraded is visible on the canvas before and after a run, whatever the layout or lens.
 */
export function NodeFailureBadge({
  errorRate,
  className = ''
}: {
  errorRate: unknown
  className?: string
}): React.JSX.Element | null {
  const rate = normalizeErrorRate(errorRate)
  if (rate <= 0) return null
  const preset = getHealthPreset(rate)
  if (preset === 'healthy') return null
  const meta = HEALTH_META[preset]
  const percent = Math.round(rate * 100)
  return (
    <span
      data-testid="node-failure-badge"
      title={`Injected failure: ${percent}% of requests to this node fail`}
      className={`pointer-events-none absolute z-10 flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shadow-sm bg-nss-panel ${meta.className} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClassName}`} />
      {preset === 'degraded' ? `${meta.label} ${percent}%` : meta.label}
    </span>
  )
}
