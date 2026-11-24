import { useEffect, useRef } from 'react'
import useStore from '@renderer/store/useStore'
import { useReplicationView, type ReplicationViewState } from './replicationViewStore'

const OPTIONS: {
  key: 'routing' | 'replication' | 'lag' | 'animation'
  label: string
  title: string
}[] = [
  { key: 'routing', label: 'Read/write routing', title: 'Show every API → database path' },
  { key: 'replication', label: 'Replication', title: 'Show leader → follower links' },
  { key: 'lag', label: 'Lag', title: 'Show follower lag / synced status' },
  { key: 'animation', label: 'Animation', title: 'Show moving request packets on edges' }
]

/** Display-only toggles; the stored topology, routing and grading never change. */
const REPLAY_WALL_MS = 9_000
const REPLAY_STEP_MS = 100

export function ReplicationViewControls() {
  const view = useReplicationView()
  const timeline = useStore((state) =>
    state.runtimeResultsStale ? undefined : state.lastRunOutput?.replicationTimeline
  )
  const durationMs = useStore((state) => state.lastRunOutput?.simulationDuration ?? 0)
  const frame = useRef<number | null>(null)
  const stopReplay = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    useReplicationView.getState().setReplayMs(null)
  }
  const startReplay = () => {
    if (durationMs <= 0) return
    const begin = performance.now()
    const tick = (now: number) => {
      const progress = (now - begin) / REPLAY_WALL_MS
      if (progress >= 1) return stopReplay()
      const simMs = Math.floor((progress * durationMs) / REPLAY_STEP_MS) * REPLAY_STEP_MS
      if (useReplicationView.getState().replayMs !== simMs) {
        useReplicationView.getState().setReplayMs(simMs)
      }
      frame.current = requestAnimationFrame(tick)
    }
    useReplicationView.getState().setReplayMs(0)
    frame.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => stopReplay(), [])
  // Never leave animation switched off once the controls (and so the toggle) are gone.
  useEffect(() => () => useReplicationView.setState({ animation: true }), [])
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-20 flex flex-col items-end gap-1">
      <div
        role="group"
        aria-label="Replication view"
        className="flex items-center gap-1 rounded-full border border-nss-border bg-nss-panel/95 p-1 shadow backdrop-blur"
      >
        {OPTIONS.map(({ key, label, title }) => {
          const on = view[key as keyof ReplicationViewState] === true
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              title={title}
              onClick={() => view.toggle(key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                on ? 'bg-nss-info/15 text-nss-info' : 'text-nss-muted hover:text-nss-text'
              }`}
            >
              {on ? '✓ ' : ''}
              {label}
            </button>
          )
        })}
      </div>
      {timeline && timeline.length > 0 && (
        <button
          type="button"
          onClick={view.replayMs === null ? startReplay : stopReplay}
          className="rounded-full border border-nss-info/40 bg-nss-panel/95 px-3 py-1 text-[11px] font-medium text-nss-info shadow backdrop-blur hover:bg-nss-info/10"
        >
          {view.replayMs === null
            ? '▶ Replay failover'
            : `■ Stop · t = ${(view.replayMs / 1000).toFixed(1)} s`}
        </button>
      )}
      <div className="flex items-center gap-3 rounded-full border border-nss-border bg-nss-panel/90 px-3 py-1 text-[10px] text-nss-muted backdrop-blur">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-nss-primary" aria-hidden="true" /> Write → leader
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-nss-success" aria-hidden="true" /> Read →
          follower
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-nss-info" aria-hidden="true" /> Replication
        </span>
      </div>
    </div>
  )
}
