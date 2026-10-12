import { clsx } from 'clsx'
import { STATE_LABEL, stepVisualState, type DebugViewProps } from './debuggerUi'
import { formatDebugMs, type RequestLifecycle } from './requestLifecycle'

const COL_W = 132
const ROW_H = 34
const HEADER_H = 40

function edgeEnds(lifecycle: RequestLifecycle, edgeId: string): [string, string] | null {
  const ends = lifecycle.edgeEnds[edgeId]
  return ends ? [ends.source, ends.target] : null
}

/**
 * UML-style sequence diagram (#156 view 2): one lifeline per node the request
 * visited, one row per recorded step, arrows for hops between nodes.
 */
export function SequenceDiagram({ lifecycle, stepIndex, onStep, labelFor }: DebugViewProps) {
  // Lifelines: every node visited, plus the target of a connection the request
  // failed on (it never arrived, but the arrow still points at it).
  const actors = [
    ...new Set([
      ...lifecycle.actualPath,
      ...Object.values(lifecycle.edgeEnds).map((ends) => ends.target)
    ])
  ]
  const column = (nodeId: string | null) => (nodeId ? Math.max(0, actors.indexOf(nodeId)) : 0)
  const width = Math.max(actors.length, 1) * COL_W
  const height = lifecycle.steps.length * ROW_H + 12
  const centerX = (col: number) => col * COL_W + COL_W / 2

  return (
    <div className="max-h-[22rem] overflow-auto rounded-md border border-nss-border bg-nss-panel">
      <div className="relative" style={{ width, minWidth: '100%' }}>
        <div
          className="sticky top-0 z-10 flex border-b border-nss-border bg-nss-surface"
          style={{ height: HEADER_H, width }}
        >
          {actors.map((actor) => (
            <div
              key={actor}
              className="flex shrink-0 flex-col items-center justify-center px-1 text-center"
              style={{ width: COL_W }}
            >
              <span className="w-full truncate text-[11px] font-semibold text-nss-text">
                {labelFor(actor)}
              </span>
              <span className="w-full truncate font-mono text-[9px] text-nss-muted">{actor}</span>
            </div>
          ))}
        </div>
        <div className="relative" style={{ height, width }}>
          {actors.map((actor, col) => (
            <div
              key={actor}
              className="absolute top-0 border-l border-dashed border-nss-border"
              style={{ left: centerX(col), height }}
            />
          ))}
          <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
            {lifecycle.steps.map((step) => {
              if (!step.edgeId) return null
              const ends = edgeEnds(lifecycle, step.edgeId)
              if (!ends) return null
              const visual = stepVisualState(lifecycle, step.index, stepIndex)
              const x1 = centerX(column(ends[0]))
              const x2 = centerX(column(ends[1]))
              const y = step.index * ROW_H + ROW_H / 2 + 6
              const color =
                visual === 'failed'
                  ? 'rgb(var(--nss-danger))'
                  : visual === 'default'
                    ? 'var(--nss-muted)'
                    : 'rgb(var(--nss-primary))'
              const dir = x2 >= x1 ? 1 : -1
              return (
                <g key={step.index}>
                  <line x1={x1} y1={y} x2={x2 - dir * 6} y2={y} stroke={color} strokeWidth={1.5} />
                  <path
                    d={`M ${x2} ${y} l ${-dir * 7} -4 l 0 8 z`}
                    fill={color}
                    opacity={x1 === x2 ? 0 : 1}
                  />
                </g>
              )
            })}
          </svg>
          {lifecycle.steps.map((step) => {
            const visual = stepVisualState(lifecycle, step.index, stepIndex)
            const ends = step.edgeId ? edgeEnds(lifecycle, step.edgeId) : null
            const x = ends
              ? (centerX(column(ends[0])) + centerX(column(ends[1]))) / 2
              : centerX(column(step.nodeId))
            return (
              <button
                key={step.index}
                type="button"
                onClick={() => onStep(step.index)}
                className={clsx(
                  'absolute -translate-x-1/2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium transition-transform',
                  visual === 'failed'
                    ? 'scale-105 border-nss-danger bg-nss-danger/15 text-nss-danger ring-2 ring-nss-danger/30'
                    : visual === 'current'
                      ? 'scale-105 border-nss-primary bg-nss-primary/15 text-nss-primary ring-2 ring-nss-primary/30'
                      : visual === 'done'
                        ? 'border-nss-primary/40 bg-nss-surface text-nss-text'
                        : 'border-nss-border bg-nss-surface text-nss-muted'
                )}
                style={{ left: x, top: step.index * ROW_H + (ends ? -1 : 6) }}
                title={step.detail ?? undefined}
              >
                <span className="tabular-nums">{formatDebugMs(step.atMs)}</span> ·{' '}
                {STATE_LABEL[step.state]}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
