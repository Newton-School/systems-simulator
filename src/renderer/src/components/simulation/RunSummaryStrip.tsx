import type { RunSummary, RunVerdict } from './runSummaryModel'

const VERDICT_META: Record<RunVerdict, { label: string; cls: string }> = {
  passed: { label: 'Passed', cls: 'border-nss-success/30 bg-nss-success/10 text-nss-success' },
  'needs-work': {
    label: 'Needs work',
    cls: 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
  },
  failed: { label: 'Failed', cls: 'border-nss-danger/30 bg-nss-danger/10 text-nss-danger' }
}

/**
 * Collapsed results: a verdict, a few numbers and the bottleneck. The full tray opens from
 * "See details", so a first run answers "did it work?" before showing any metrics tables.
 */
export function RunSummaryStrip({
  summary,
  running = false,
  progress = 0,
  topologyEdited = false,
  onSeeDetails
}: {
  summary: RunSummary | null
  running?: boolean
  progress?: number
  topologyEdited?: boolean
  onSeeDetails: () => void
}): React.JSX.Element {
  const verdict = summary ? VERDICT_META[summary.verdict] : null
  return (
    <section
      aria-label="Run summary"
      data-testid="run-summary-strip"
      className="pointer-events-auto absolute bottom-4 left-1/2 z-20 w-[min(46rem,calc(100%-2rem))] -translate-x-1/2 space-y-1.5 rounded-lg border border-nss-border bg-nss-panel/95 px-4 py-3 shadow-lg backdrop-blur"
    >
      {running || !summary || !verdict ? (
        <div className="text-xs font-medium text-nss-muted" role="status">
          Running… {Math.round(progress)}%
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span
              className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${verdict.cls}`}
              data-testid="run-summary-verdict"
            >
              {verdict.label}
            </span>
            <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
              {summary.stats.map((stat) => (
                <div key={stat.id} className="flex items-baseline gap-1.5">
                  <dt className="text-nss-muted">{stat.label}</dt>
                  <dd
                    className={`font-semibold tabular-nums ${stat.bad ? 'text-nss-danger' : 'text-nss-text'}`}
                  >
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
            <button
              type="button"
              onClick={onSeeDetails}
              className="ml-auto min-h-8 rounded-md border border-nss-border px-3 text-xs font-semibold text-nss-text transition-colors hover:border-nss-primary/50 hover:text-nss-primary"
            >
              See details
            </button>
          </div>
          {summary.bottleneck && <p className="text-xs text-nss-muted">{summary.bottleneck}</p>}
          {topologyEdited && (
            <p className="text-xs text-nss-warning">
              The canvas changed since this run. Run again to refresh.
            </p>
          )}
        </>
      )}
    </section>
  )
}
