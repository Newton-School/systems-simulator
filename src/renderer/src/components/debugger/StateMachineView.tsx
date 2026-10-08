import { STATE_HANDLER, STATE_LABEL, type DebugViewProps } from './debuggerUi'
import type { LifecycleState } from './requestLifecycle'

const BOX_W = 112
const BOX_H = 30

const POS: Record<LifecycleState, { x: number; y: number }> = {
  generated: { x: 75, y: 50 },
  'in-flight': { x: 250, y: 50 },
  arrived: { x: 430, y: 50 },
  queued: { x: 610, y: 50 },
  'timed-out': { x: 790, y: 50 },
  routing: { x: 250, y: 175 },
  rejected: { x: 430, y: 175 },
  processing: { x: 610, y: 175 },
  completed: { x: 790, y: 175 },
  held: { x: 250, y: 290 }
}

interface Transition {
  from: LifecycleState
  to: LifecycleState
  guard: string
  /** Optional custom path (curves around boxes). */
  path?: string
  labelAt?: { x: number; y: number; anchor?: 'start' | 'middle' | 'end' }
}

const TRANSITIONS: Transition[] = [
  { from: 'generated', to: 'in-flight', guard: 'edge chosen' },
  { from: 'in-flight', to: 'arrived', guard: 'edge latency elapsed' },
  {
    from: 'in-flight',
    to: 'rejected',
    guard: 'refused / lost on wire',
    labelAt: { x: 345, y: 132, anchor: 'end' }
  },
  { from: 'arrived', to: 'queued', guard: 'active >= c, inSystem < K' },
  {
    from: 'arrived',
    to: 'processing',
    guard: 'active < c',
    labelAt: { x: 528, y: 100, anchor: 'start' }
  },
  {
    from: 'arrived',
    to: 'rejected',
    guard: 'inSystem >= K | trait | policy',
    labelAt: { x: 424, y: 100, anchor: 'end' }
  },
  {
    from: 'arrived',
    to: 'held',
    guard: 'node failed (hang / blackhole)',
    labelAt: { x: 296, y: 262, anchor: 'start' }
  },
  { from: 'queued', to: 'processing', guard: 'worker freed' },
  { from: 'queued', to: 'timed-out', guard: 'now >= deadline' },
  { from: 'processing', to: 'timed-out', guard: 'now >= deadline' },
  { from: 'processing', to: 'completed', guard: 'no next hop' },
  {
    from: 'processing',
    to: 'rejected',
    guard: 'error rate | breaker',
    labelAt: { x: 520, y: 194 }
  },
  {
    from: 'processing',
    to: 'routing',
    guard: 'service done',
    path: 'M 610 190 Q 430 262 250 190',
    labelAt: { x: 430, y: 240 }
  },
  {
    from: 'routing',
    to: 'in-flight',
    guard: 'next edge resolved',
    labelAt: { x: 244, y: 118, anchor: 'end' }
  },
  {
    from: 'held',
    to: 'timed-out',
    guard: 'deadline',
    path: 'M 306 290 L 790 290 L 790 65',
    labelAt: { x: 560, y: 284 }
  }
]

/** Guard label placement: above horizontal arrows, beside vertical / diagonal ones. */
function labelPosition(
  start: { x: number; y: number },
  end: { x: number; y: number }
): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  if (Math.abs(start.y - end.y) < 1) {
    return { x: (start.x + end.x) / 2, y: start.y - BOX_H / 2 - 6, anchor: 'middle' }
  }
  return { x: (start.x + end.x) / 2 + 6, y: (start.y + end.y) / 2, anchor: 'start' }
}

/** Point on a box border facing (tx, ty), so arrows touch the box edge. */
function edgePoint(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return from
  const sx = dx === 0 ? Infinity : BOX_W / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : BOX_H / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: from.x + dx * s, y: from.y + dy * s }
}

/**
 * Finite state machine of a request (#156 view 4). The machine is static; only
 * the highlighting follows the step. Each state is one engine handler.
 */
export function StateMachineView({ lifecycle, stepIndex }: DebugViewProps) {
  const visited = lifecycle.steps.slice(0, stepIndex + 1)
  const current = visited[visited.length - 1]
  const visitedStates = new Set(visited.map((step) => step.state))
  const taken = new Set<string>()
  for (let i = 1; i < visited.length; i++) {
    taken.add(`${visited[i - 1].state}>${visited[i].state}`)
  }
  const last = visited.length > 1 ? `${visited[visited.length - 2].state}>${current.state}` : null
  const phase = current ? lifecycle.phases[current.phaseIndex] : null
  const occupancy = phase?.admission?.state ?? null

  const color = (kind: 'active' | 'fail' | 'done' | 'idle') =>
    kind === 'fail'
      ? 'rgb(var(--nss-danger))'
      : kind === 'active'
        ? 'rgb(var(--nss-primary))'
        : kind === 'done'
          ? 'rgb(var(--nss-success))'
          : 'var(--nss-border)'

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border border-nss-border bg-nss-panel">
        <svg viewBox="0 0 870 320" className="h-auto w-full min-w-[680px]" role="img">
          <title>Request lifecycle state machine</title>
          <defs>
            {(['idle', 'done', 'active', 'fail'] as const).map((kind) => (
              <marker
                key={kind}
                id={`nss-sm-arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color(kind)} />
              </marker>
            ))}
          </defs>
          {TRANSITIONS.map((transition) => {
            const key = `${transition.from}>${transition.to}`
            const kind =
              key === last
                ? current?.failed
                  ? 'fail'
                  : 'active'
                : taken.has(key)
                  ? 'done'
                  : 'idle'
            const a = POS[transition.from]
            const b = POS[transition.to]
            const start = edgePoint(a, b)
            const end = edgePoint(b, a)
            const d = transition.path ?? `M ${start.x} ${start.y} L ${end.x} ${end.y}`
            const label = transition.labelAt
              ? { anchor: 'middle' as const, ...transition.labelAt }
              : labelPosition(start, end)
            return (
              <g key={key}>
                <path
                  d={d}
                  fill="none"
                  stroke={color(kind)}
                  strokeWidth={kind === 'idle' ? 1.2 : 2.2}
                  markerEnd={`url(#nss-sm-arrow-${kind})`}
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  fontSize="8.5"
                  fill={kind === 'idle' ? 'var(--nss-muted)' : color(kind)}
                >
                  guard: {transition.guard}
                </text>
              </g>
            )
          })}
          {(Object.keys(POS) as LifecycleState[]).map((state) => {
            const pos = POS[state]
            const isCurrent = current?.state === state
            const kind = isCurrent
              ? current.failed
                ? 'fail'
                : 'active'
              : visitedStates.has(state)
                ? 'done'
                : 'idle'
            return (
              <g key={state}>
                <rect
                  x={pos.x - BOX_W / 2}
                  y={pos.y - BOX_H / 2}
                  width={BOX_W}
                  height={BOX_H}
                  rx={8}
                  fill={
                    kind === 'idle'
                      ? 'var(--nss-surface)'
                      : kind === 'fail'
                        ? 'rgb(var(--nss-danger) / .14)'
                        : kind === 'active'
                          ? 'rgb(var(--nss-primary) / .14)'
                          : 'rgb(var(--nss-success) / .1)'
                  }
                  stroke={color(kind)}
                  strokeWidth={isCurrent ? 2.5 : 1.2}
                />
                <text
                  x={pos.x}
                  y={pos.y + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight={isCurrent ? 700 : 500}
                  fill="var(--nss-text)"
                >
                  {STATE_LABEL[state]}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {current && (
        <p className="text-[11px] text-nss-muted">
          <span className="font-semibold text-nss-text">{STATE_LABEL[current.state]}</span> - engine
          handler <span className="font-mono">{STATE_HANDLER[current.state]}</span>
          {current.detail ? `. ${current.detail}` : ''}
          {occupancy && (current.state === 'queued' || current.state === 'arrived')
            ? `. Guard inputs: active ${occupancy.activeWorkers}, c ${occupancy.workers}, inSystem ${occupancy.totalInSystem}, K ${occupancy.capacity}.`
            : ''}
        </p>
      )}
    </div>
  )
}
