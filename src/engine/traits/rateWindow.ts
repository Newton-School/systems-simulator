import type { TraitStateStore } from './types'

/**
 * Admits at most `limitPerSecond` calls in any rolling one-second window. Returns false (and records
 * nothing) when the window is full. State lives in the node's trait state under `key`.
 */
export function admitWithinRate(
  state: TraitStateStore | undefined,
  key: string,
  clockUs: bigint,
  limitPerSecond: number
): boolean {
  if (!state) return true
  const log = state.get<bigint[]>(key) ?? []
  const windowStart = clockUs - 1_000_000n
  while (log.length > 0 && log[0] <= windowStart) log.shift()
  const admitted = log.length < limitPerSecond
  if (admitted) log.push(clockUs)
  state.set(key, log)
  return admitted
}
