import { useReplicationView } from './replicationViewStore'

const REPLAY_WALL_MS = 9_000
const REPLAY_STEP_MS = 100

let frame: number | null = null

/** Stops the failover replay and returns the canvas to the end-of-run view. */
export function stopFailoverReplay(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  frame = null
  useReplicationView.getState().setReplayMs(null)
}

/**
 * Plays simulated time 0..durationMs over a few seconds by stepping the replay
 * clock. Module-level so it keeps running when the inspector selection changes.
 */
export function startFailoverReplay(durationMs: number): void {
  if (durationMs <= 0) return
  stopFailoverReplay()
  const begin = performance.now()
  const tick = (now: number): void => {
    const progress = (now - begin) / REPLAY_WALL_MS
    if (progress >= 1) return stopFailoverReplay()
    const simMs = Math.floor((progress * durationMs) / REPLAY_STEP_MS) * REPLAY_STEP_MS
    if (useReplicationView.getState().replayMs !== simMs) {
      useReplicationView.getState().setReplayMs(simMs)
    }
    frame = requestAnimationFrame(tick)
  }
  useReplicationView.getState().setReplayMs(0)
  frame = requestAnimationFrame(tick)
}
