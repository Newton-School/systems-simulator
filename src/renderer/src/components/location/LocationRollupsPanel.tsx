import {
  type EdgeLocalityRollup,
  type LocationLevel,
  type NodeLocationRollup,
  type NodeLocationRollups
} from '@renderer/utils/locationTopology'
import { TooltipInfo } from '@renderer/components/ui/Tooltip'

const LEVEL_ORDER: readonly LocationLevel[] = ['region', 'az', 'subnet']

const LEVEL_LABELS: Record<LocationLevel, string> = {
  region: 'Regions',
  az: 'Availability Zones',
  subnet: 'Subnets'
}

function fmtRate(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} rps` : '0.0 rps'
}

function fmtMs(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}ms` : 'N/A'
}

function fmtPct(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : 'N/A'
}

function isSourceOnlyRollup(rollup: NodeLocationRollup): boolean {
  return rollup.activeNodeCount === 0 && rollup.sourceCount > 0
}

function LocationRollupTooltip() {
  return (
    <div className="space-y-1 text-[11px] leading-relaxed">
      <p className="font-semibold text-nss-text">Deployment & locality</p>
      <p className="text-nss-text/80">
        Composite containers are deployment groupings, not simulated hops. These summaries group
        runtime node results by region, availability zone, and subnet.
      </p>
      <p className="text-nss-muted">
        Traffic locality shows which edge path classes were used at runtime, such as same-dc or
        cross-region.
      </p>
    </div>
  )
}

function CompactLevelCard({
  level,
  rollups
}: {
  level: LocationLevel
  rollups: NodeLocationRollup[]
}) {
  const primary = rollups.find((rollup) => !isSourceOnlyRollup(rollup)) ?? rollups[0]

  return (
    <div className="rounded-lg border border-nss-border bg-nss-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
          {LEVEL_LABELS[level]}
        </div>
        <div className="text-[10px] text-nss-muted">{rollups.length} group(s)</div>
      </div>

      {!primary ? (
        <div className="mt-2 text-[11px] text-nss-muted">No nodes are grouped at this level.</div>
      ) : (
        <div className="mt-2 space-y-1">
          <div className="truncate text-xs font-medium text-nss-text">{primary.label}</div>
          {isSourceOnlyRollup(primary) ? (
            <>
              <div className="text-[10px] text-nss-muted">
                {primary.sourceCount} source(s) only. Runtime arrivals begin on downstream nodes.
              </div>
              {rollups.length > 1 && (
                <div className="text-[10px] text-nss-muted">
                  +{(rollups.length - 1).toLocaleString()} more group(s)
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-nss-muted tabular-nums">
                <span>
                  {primary.activeNodeCount}/{primary.nodeCount} active
                </span>
                <span>{fmtRate(primary.totalThroughput)}</span>
                <span>p95 {fmtMs(primary.worstP95)}</span>
                <span>err {fmtPct(primary.errorRate)}</span>
              </div>
              {(primary.sourceCount > 0 || rollups.length > 1) && (
                <div className="text-[10px] text-nss-muted">
                  {primary.sourceCount > 0 ? `${primary.sourceCount} source(s)` : 'runtime only'}
                  {rollups.length > 1 ? ` · +${(rollups.length - 1).toLocaleString()} more` : ''}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface LocationRollupsPanelProps {
  nodeRollups: NodeLocationRollups
  edgeRollups: EdgeLocalityRollup[]
  compact?: boolean
  title?: string
}

export function LocationRollupsPanel({
  nodeRollups,
  edgeRollups,
  compact = false,
  title = 'Location Rollups'
}: LocationRollupsPanelProps) {
  const nodeRollupCount = LEVEL_ORDER.reduce((sum, level) => sum + nodeRollups[level].length, 0)
  if (nodeRollupCount === 0 && edgeRollups.length === 0) return null

  const nodeLimit = compact ? 2 : 4
  const edgeLimit = compact ? 4 : 6

  if (compact) {
    const primaryEdgeRollup = edgeRollups[0]

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-nss-text">{title}</h3>
          <TooltipInfo label={`Explain ${title}`} content={<LocationRollupTooltip />} width={320} />
        </div>

        <div className="space-y-2">
          {LEVEL_ORDER.map((level) => (
            <CompactLevelCard key={level} level={level} rollups={nodeRollups[level]} />
          ))}

          {primaryEdgeRollup && (
            <div className="rounded-lg border border-nss-border bg-nss-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Traffic Locality
                </div>
                <div className="text-[10px] text-nss-muted">{edgeRollups.length} group(s)</div>
              </div>
              <div className="mt-2 truncate text-xs font-medium text-nss-text">
                {primaryEdgeRollup.pathType} · {primaryEdgeRollup.label}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-nss-muted tabular-nums">
                <span>{primaryEdgeRollup.edgeCount} edge(s)</span>
                <span>{primaryEdgeRollup.attempts.toLocaleString()} attempts</span>
                <span>p95 {fmtMs(primaryEdgeRollup.worstP95)}</span>
                <span>err {fmtPct(primaryEdgeRollup.errorRate)}</span>
              </div>
              {edgeRollups.length > 1 && (
                <div className="mt-1 text-[10px] text-nss-muted">
                  +{(edgeRollups.length - 1).toLocaleString()} more locality group(s)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-nss-text">{title}</h3>
        <TooltipInfo label={`Explain ${title}`} content={<LocationRollupTooltip />} width={320} />
      </div>
      <p className="text-[11px] text-nss-muted">
        Containers group runtime results by placement. They do not add extra simulated hops.
      </p>

      <div className="grid gap-3 xl:grid-cols-3">
        {LEVEL_ORDER.map((level) => {
          const rollups = nodeRollups[level]
          return (
            <div key={level} className="rounded-lg border border-nss-border bg-nss-surface p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-nss-muted">
                  {LEVEL_LABELS[level]}
                </div>
                <div className="text-[10px] text-nss-muted">{rollups.length} group(s)</div>
              </div>

              {rollups.length === 0 ? (
                <div className="text-[11px] text-nss-muted">
                  No nodes are grouped at this level.
                </div>
              ) : (
                <div className="space-y-2">
                  {rollups.slice(0, nodeLimit).map((rollup) => {
                    const sourceOnly = isSourceOnlyRollup(rollup)

                    return (
                      <div
                        key={`${rollup.level}:${rollup.containerId}`}
                        className="rounded border border-nss-border bg-nss-panel px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="truncate text-xs font-medium text-nss-text">
                            {rollup.label}
                          </div>
                          {sourceOnly && (
                            <span className="shrink-0 rounded-full border border-nss-border bg-nss-surface px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-nss-muted">
                              Source only
                            </span>
                          )}
                        </div>

                        {sourceOnly ? (
                          <div className="mt-1 space-y-1 text-[10px] text-nss-muted">
                            <div>{rollup.sourceCount} source(s)</div>
                            <div>Traffic is counted once it reaches the next runtime node.</div>
                          </div>
                        ) : (
                          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-nss-muted tabular-nums">
                            <div>
                              {rollup.activeNodeCount}/{rollup.nodeCount} active
                            </div>
                            <div className="text-right">{fmtRate(rollup.totalThroughput)}</div>
                            <div>
                              {rollup.sourceCount > 0
                                ? `${rollup.sourceCount} source(s)`
                                : `${rollup.totalArrived.toLocaleString()} arrived`}
                            </div>
                            <div className="text-right">p95 {fmtMs(rollup.worstP95)}</div>
                            <div>{rollup.totalArrived.toLocaleString()} arrived</div>
                            <div className="text-right">err {fmtPct(rollup.errorRate)}</div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {rollups.length > nodeLimit && (
                    <div className="text-[10px] text-nss-muted">
                      +{(rollups.length - nodeLimit).toLocaleString()} more{' '}
                      {LEVEL_LABELS[level].toLowerCase()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {edgeRollups.length > 0 && (
        <div className="rounded-lg border border-nss-border bg-nss-surface p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-nss-muted">
              Traffic Locality
            </div>
            <div className="text-[10px] text-nss-muted">{edgeRollups.length} group(s)</div>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {edgeRollups.slice(0, edgeLimit).map((rollup) => (
              <div
                key={rollup.key}
                className="rounded border border-nss-border bg-nss-panel px-2.5 py-2"
              >
                <div className="truncate text-xs font-medium text-nss-text">
                  {rollup.pathType} · {rollup.label}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-nss-muted tabular-nums">
                  <div>{rollup.edgeCount} edge(s)</div>
                  <div className="text-right">{rollup.attempts.toLocaleString()} attempts</div>
                  <div>err {fmtPct(rollup.errorRate)}</div>
                  <div className="text-right">p95 {fmtMs(rollup.worstP95)}</div>
                </div>
              </div>
            ))}
          </div>
          {edgeRollups.length > edgeLimit && (
            <div className="mt-2 text-[10px] text-nss-muted">
              +{(edgeRollups.length - edgeLimit).toLocaleString()} more locality groups
            </div>
          )}
        </div>
      )}
    </div>
  )
}
