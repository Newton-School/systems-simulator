/**
 * Single-key register linearizability checker (Wing & Gong search with the
 * Lowe-style memo of already-explored configurations).
 *
 * A history is a set of completed (or indeterminate) operations on ONE register:
 * writes install a value, reads return the value they observed. The history is
 * linearizable when there is a total order of the operations that (a) respects
 * real time - if `a` returned before `b` was invoked, `a` comes first - and (b)
 * is a legal sequential register run: every read returns the most recently
 * written value (or the initial value when nothing was written yet).
 *
 * The search is exponential in the worst case, so it is bounded by `maxSteps`.
 * When the budget runs out the verdict is `inconclusive`: callers must report
 * that as "not checked", never as linearizable.
 */

export interface RegisterOperation {
  kind: 'read' | 'write'
  /** Invocation time (any monotonic unit, e.g. microseconds). */
  start: number
  /**
   * Response time. `Infinity` for an operation whose outcome the client never
   * learned (e.g. a write that committed but then timed out): it may take effect
   * at any point after `start`.
   */
  end: number
  /** Value written, or value the read returned. */
  value: number
}

export type LinearizabilityResult = 'linearizable' | 'violation' | 'inconclusive'

export interface LinearizabilityCheck {
  result: LinearizabilityResult
  /** Search steps spent (each step tries one candidate operation). */
  steps: number
}

export const DEFAULT_LINEARIZABILITY_MAX_STEPS = 100_000

export function checkRegisterLinearizability(
  operations: readonly RegisterOperation[],
  initialValue = 0,
  maxSteps = DEFAULT_LINEARIZABILITY_MAX_STEPS
): LinearizabilityCheck {
  const ops = [...operations].sort((a, b) => a.start - b.start || a.end - b.end)
  const n = ops.length
  if (n === 0) {
    return { result: 'linearizable', steps: 0 }
  }

  // A read can only ever be explained by a write of the same value (or by the
  // initial value). A read of a value nobody wrote is an immediate violation.
  const writtenValues = new Set(ops.filter((op) => op.kind === 'write').map((op) => op.value))
  for (const op of ops) {
    if (op.kind === 'read' && op.value !== initialValue && !writtenValues.has(op.value)) {
      return { result: 'violation', steps: 0 }
    }
  }

  const done = new Uint8Array(n)
  const explored = new Set<string>()
  let steps = 0
  let exhausted = false

  const configurationKey = (state: number): string => {
    let key = ''
    for (let i = 0; i < n; i += 1) key += done[i] === 1 ? '1' : '0'
    return `${key}|${state}`
  }

  const search = (remaining: number, state: number): boolean => {
    if (remaining === 0) return true
    const key = configurationKey(state)
    if (explored.has(key)) return false
    explored.add(key)

    // An operation may be linearized next only if no other pending operation
    // finished strictly before it was invoked.
    let minEnd = Infinity
    for (let i = 0; i < n; i += 1) {
      if (done[i] === 0 && ops[i].end < minEnd) minEnd = ops[i].end
    }

    for (let i = 0; i < n; i += 1) {
      if (done[i] === 1) continue
      const op = ops[i]
      if (op.start > minEnd) break // sorted by start: nothing later is minimal
      steps += 1
      if (steps > maxSteps) {
        exhausted = true
        return false
      }
      if (op.kind === 'read' && op.value !== state) continue
      done[i] = 1
      const nextState = op.kind === 'write' ? op.value : state
      if (search(remaining - 1, nextState)) return true
      done[i] = 0
      if (exhausted) return false
    }
    return false
  }

  const ok = search(n, initialValue)
  if (ok) return { result: 'linearizable', steps }
  return { result: exhausted ? 'inconclusive' : 'violation', steps }
}
