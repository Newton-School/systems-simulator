import { Play, Square } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { startFailoverReplay, stopFailoverReplay } from '../canvas/failoverReplay'
import { useReplicationView } from '../canvas/replicationViewStore'

/** Replays the run's leader failure and election on the canvas; shown only when the run has one. */
export function ReplicationReplayControl() {
  const timeline = useStore((state) =>
    state.runtimeResultsStale ? undefined : state.lastRunOutput?.replicationTimeline
  )
  const durationMs = useStore((state) => state.lastRunOutput?.simulationDuration ?? 0)
  const replayMs = useReplicationView((state) => state.replayMs)
  if (!timeline || timeline.length === 0) return null
  const playing = replayMs !== null

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-nss-info/25 bg-nss-surface px-3 py-2.5">
      <div className="min-w-0">
        <h3 className="text-xs font-semibold text-nss-text">Leader failover</h3>
        <p className="text-[10px] leading-relaxed text-nss-muted">
          Replay the failure, election and promotion on the canvas.
        </p>
      </div>
      <button
        type="button"
        onClick={() => (playing ? stopFailoverReplay() : startFailoverReplay(durationMs))}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-nss-info/40 px-2.5 py-1.5 text-[11px] font-medium text-nss-info hover:bg-nss-info/10"
      >
        {playing ? <Square size={11} aria-hidden="true" /> : <Play size={11} aria-hidden="true" />}
        {playing ? `Stop · t = ${(replayMs / 1000).toFixed(1)} s` : 'Replay'}
      </button>
    </div>
  )
}
