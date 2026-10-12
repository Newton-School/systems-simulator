import { Fragment } from 'react'
import { clsx } from 'clsx'
import type { DebugViewProps } from './debuggerUi'
import { diffPaths, stepForPhase, type ExpectedPath } from './requestLifecycle'

type StopTone = 'ok' | 'fail' | 'pending' | 'off'

const CONNECTOR_CLASS: Record<StopTone, string> = {
  ok: 'bg-nss-success',
  fail: 'bg-nss-danger',
  pending: 'bg-nss-border',
  off: 'bg-nss-warning'
}

const STOP_CLASS: Record<StopTone, string> = {
  ok: 'border-nss-success/50 bg-nss-success/10 text-nss-success',
  fail: 'border-nss-danger bg-nss-danger/10 text-nss-danger',
  pending: 'border-dashed border-nss-border text-nss-muted',
  off: 'border-nss-warning/50 bg-nss-warning/10 text-nss-warning'
}

function Chain({
  stops,
  onClick
}: {
  stops: Array<{ key: string; label: string; tone: StopTone; badge?: string }>
  onClick?: (index: number) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {stops.map((stop, index) => (
        <Fragment key={stop.key}>
          {index > 0 && <span className={clsx('h-0.5 w-6', CONNECTOR_CLASS[stop.tone])} />}
          <button
            type="button"
            disabled={!onClick}
            onClick={() => onClick?.(index)}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              STOP_CLASS[stop.tone],
              onClick ? 'hover:brightness-110' : 'cursor-default'
            )}
          >
            {stop.label}
            {stop.badge && (
              <span className="rounded bg-nss-danger px-1 text-[9px] font-bold text-white">
                {stop.badge}
              </span>
            )}
          </button>
        </Fragment>
      ))}
    </div>
  )
}

/** Expected route vs the route the request actually took (#157 view 2). */
export function PathDiff({
  lifecycle,
  onStep,
  labelFor,
  expected,
  topologyEdited
}: DebugViewProps & { expected: ExpectedPath; topologyEdited: boolean }) {
  const actual = lifecycle.actualPath
  const diff = diffPaths(expected.nodeIds, actual)
  const failed = lifecycle.status === 'rejected' || lifecycle.status === 'timeout'
  const terminalOnNode = lifecycle.terminal?.locusKind === 'node'

  const actualStops = actual.map((nodeId, index) => {
    const isLast = index === actual.length - 1
    const isFail = failed && isLast && terminalOnNode
    const off = diff.kind === 'diverged' && index >= (diff.divergenceIndex ?? 0)
    return {
      key: `${nodeId}-${index}`,
      label: labelFor(nodeId),
      tone: (isFail ? 'fail' : off ? 'off' : 'ok') as StopTone,
      badge: isFail ? 'STOP' : undefined
    }
  })
  if (failed && !terminalOnNode && lifecycle.terminal) {
    actualStops.push({
      key: 'edge-terminal',
      label: `connection ${labelFor(lifecycle.terminal.locus)}`,
      tone: 'fail',
      badge: 'STOP'
    })
  }
  const expectedStops = expected.nodeIds.map((nodeId, index) => ({
    key: `${nodeId}-${index}`,
    label: labelFor(nodeId),
    tone: 'ok' as StopTone
  }))

  const terminal = lifecycle.terminal
  const terminalLine = terminal
    ? `${terminal.cause === 'completed' ? 'request-completed' : terminal.cause === 'timeout' ? 'request-timed-out' : 'request-rejected'} - ${terminal.locusKind}Id = ${terminal.locus}${
        terminal.cause !== 'completed' ? ` - reason = ${terminal.reasonCode ?? terminal.cause}` : ''
      }`
    : 'no terminal step - the request was still in flight when the run ended'

  let summary: string
  switch (diff.kind) {
    case 'match':
      summary =
        failed && terminal
          ? `The request took the expected route, but it ended at ${labelFor(terminal.locus)} (${terminal.reasonCode ?? terminal.cause}): the route was right and that stop refused it.`
          : lifecycle.status === 'in-flight'
            ? 'The request was on the expected route when the run ended.'
            : 'The request followed the expected path end to end.'
      break
    case 'stopped-early':
      summary = `The request stopped at ${labelFor(diff.actualNodeId ?? '-')} and never reached ${labelFor(diff.expectedNodeId ?? '-')}.`
      break
    case 'diverged':
      summary = `The paths split at hop ${diff.divergenceIndex}: expected ${labelFor(diff.expectedNodeId ?? '-')}, went to ${labelFor(diff.actualNodeId ?? '-')}.`
      break
    case 'went-further':
      summary = `The request went beyond the expected path, on to ${labelFor(diff.actualNodeId ?? '-')}.`
      break
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Expected path
        </div>
        {expected.nodeIds.length > 0 ? (
          <Chain stops={expectedStops} />
        ) : (
          <p className="text-[11px] italic text-nss-muted">
            The request&apos;s source is not on the canvas, so no expected path can be walked.
          </p>
        )}
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
          Actual path
        </div>
        <Chain
          stops={actualStops}
          onClick={(index) => {
            if (index < lifecycle.phases.length) onStep(stepForPhase(lifecycle, index))
          }}
        />
      </div>
      <div
        className={clsx(
          'rounded-md border p-2.5 text-xs',
          diff.kind === 'match' && !failed
            ? 'border-nss-success/40 bg-nss-success/5'
            : 'border-nss-danger/40 bg-nss-danger/5'
        )}
      >
        <div className="font-semibold text-nss-text">Difference</div>
        <p className="text-nss-text">{summary}</p>
        <p className="mt-1 font-mono text-[11px] text-nss-muted">{terminalLine}</p>
      </div>
      {!expected.deterministic && expected.nodeIds.length > 0 && (
        <p className="rounded border border-nss-warning/30 bg-nss-warning/10 px-2 py-1 text-[11px] text-nss-warning">
          Expected path is non-deterministic - a node on it has several outgoing or non-synchronous
          connections (weighted, random or conditional routing), so the actual path may differ even
          without failures. The expected walk takes the synchronous, highest-weight connection at
          each node.
        </p>
      )}
      {topologyEdited && (
        <p className="text-[11px] text-nss-warning">
          The canvas changed since this run; the expected path is walked on the current canvas.
        </p>
      )}
    </div>
  )
}
