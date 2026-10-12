import { clsx } from 'clsx'
import { VISUAL_DOT_CLASS, phaseVisualState, type DebugViewProps } from './debuggerUi'
import { diffPaths, stepForPhase, type ExpectedPath } from './requestLifecycle'

/**
 * Vertical hop trail of the debugged request (#158 mini-map): green done, blue
 * current, red rejected, grey pending. Expected stops the request never reached
 * are listed after it, dashed.
 */
export function RequestPathMap({
  lifecycle,
  stepIndex,
  onStep,
  labelFor,
  expected,
  onFocusNode
}: DebugViewProps & { expected: ExpectedPath; onFocusNode: (nodeId: string) => void }) {
  const diff = diffPaths(expected.nodeIds, lifecycle.actualPath)
  const unreached =
    diff.kind === 'stopped-early' && diff.divergenceIndex !== null
      ? expected.nodeIds.slice(diff.divergenceIndex)
      : []

  return (
    <div className="rounded-md border border-nss-border bg-nss-panel p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-nss-muted">
        Request path
      </div>
      <ol className="relative space-y-1.5">
        {lifecycle.phases.map((phase) => {
          const visual = phaseVisualState(lifecycle, phase.index, stepIndex)
          return (
            <li key={`${phase.nodeId}-${phase.index}`}>
              <button
                type="button"
                data-path-state={visual === 'default' ? 'pending' : visual}
                onClick={() => {
                  onFocusNode(phase.nodeId)
                  onStep(stepForPhase(lifecycle, phase.index))
                }}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-nss-surface"
              >
                <span
                  className={clsx(
                    'h-2.5 w-2.5 shrink-0 rounded-full transition-all',
                    VISUAL_DOT_CLASS[visual]
                  )}
                />
                <span
                  className={clsx(
                    'truncate text-[11px]',
                    visual === 'failed'
                      ? 'font-semibold text-nss-danger'
                      : visual === 'current'
                        ? 'font-semibold text-nss-primary'
                        : visual === 'done'
                          ? 'text-nss-text'
                          : 'text-nss-muted'
                  )}
                >
                  {labelFor(phase.nodeId)}
                </span>
              </button>
            </li>
          )
        })}
        {unreached.map((nodeId, index) => (
          <li key={`unreached-${nodeId}-${index}`}>
            <button
              type="button"
              data-path-state="unreached"
              onClick={() => onFocusNode(nodeId)}
              className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-nss-surface"
              title="On the expected path, never reached"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-nss-muted" />
              <span className="truncate text-[11px] italic text-nss-muted">{labelFor(nodeId)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
