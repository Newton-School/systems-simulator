import { Hist } from './hist'

/**
 * Windowed latency aggregation — the single source of truth for latency
 * statistics.
 *
 * Every terminal request (completed, rejected, timed out, connection-reset) is
 * ingested here exactly once, from inside the engine loop, over the FULL stream
 * — never from the capped replay sample. Observations are bucketed into tumbling
 * 1-second windows aligned to sim t=0 and assigned by *termination time*, so a
 * summary card and a per-window time-series chart read the same numbers and can
 * never disagree.
 *
 * Two honesty rules are structural here:
 *   1. Success latency (`successHist`) is completed-only — it never blends in
 *      the time-to-error of failed requests.
 *   2. Time-to-error is split PER CAUSE (`errorHist`) — reject clusters near the
 *      edge latency, blackhole/hang wall at the timeout, reset-on-recovery
 *      spikes at the outage duration; blending them would erase the lesson.
 *
 * All accumulation is integer arithmetic (histograms are integer buckets, sums
 * are bigint µs), so merges are exact, associative, and order-independent —
 * preserving the seed-reproducibility guarantee.
 */

/**
 * Closed terminal-cause taxonomy. The old single "rejected" bucket blended
 * fundamentally different failures — a full queue (overloaded) vs. a dead node
 * vs. an edge drop — so the UI could not answer the operator's first question:
 * is this thing dead, sick, or overloaded? Splitting them makes that readable.
 *   - queue_full:       admission refused because all K slots were taken (overload)
 *   - node_failed:      node was down and instantly refused the request (dead)
 *   - network_error:    the edge terminated it (connection refused / edge error)
 *   - timeout:          the client's clock ran out (silent failure / packet loss)
 *   - connection_reset: in-flight work explicitly dropped (kill -9 / recovery)
 *   - rejected:         residual policy/app refusals (rate limit, WAF, breaker…)
 */
export type TerminalState =
  | 'completed'
  | 'queue_full'
  | 'node_failed'
  | 'network_error'
  | 'timeout'
  | 'connection_reset'
  | 'rejected'
export type ErrorCause = Exclude<TerminalState, 'completed'>

export const ERROR_CAUSES: readonly ErrorCause[] = [
  'queue_full',
  'node_failed',
  'network_error',
  'timeout',
  'connection_reset',
  'rejected'
]

/**
 * Map a rejection reason string to its closed terminal cause. Timeouts and
 * connection resets classify themselves (their own recording paths); this only
 * disambiguates the many `request-rejected` reasons.
 */
export function classifyRejectionCause(reason: string): ErrorCause {
  switch (reason) {
    case 'capacity_exceeded':
      return 'queue_full'
    case 'node_failed':
      return 'node_failed'
    case 'connection_refused':
    case 'edge_error_rate':
      return 'network_error'
    default:
      // Policy / application refusals: rate_limited, security_blocked,
      // circuit_breaker_open, max_concurrency_exceeded, read_only_node,
      // node_error_rate, trait_invalid_reroute, …
      return 'rejected'
  }
}

/** 1-second tumbling windows, in microseconds. */
const WINDOW_US = 1_000_000n

export interface WindowAggregate {
  /** Window start in microseconds (a multiple of WINDOW_US). */
  windowStart: number
  counts: Record<TerminalState, number>
  /** Completed-only latency. */
  successHist: Hist
  /** Time-to-error per cause; lazily allocated. */
  errorHist: Partial<Record<ErrorCause, Hist>>
  /** Integer µs sums for exact means. */
  sums: { successUs: bigint; errorUs: bigint }
  /** In-flight requests at window close (populated by the engine snapshot path). */
  inFlightAtClose: number
}

function emptyCounts(): Record<TerminalState, number> {
  return {
    completed: 0,
    queue_full: 0,
    node_failed: 0,
    network_error: 0,
    timeout: 0,
    connection_reset: 0,
    rejected: 0
  }
}

function emptyErrorHists(): Record<ErrorCause, Hist> {
  return {
    queue_full: new Hist(),
    node_failed: new Hist(),
    network_error: new Hist(),
    timeout: new Hist(),
    connection_reset: new Hist(),
    rejected: new Hist()
  }
}

export class WindowedLatencyAggregator {
  private readonly warmupUs: bigint
  private readonly windows = new Map<number, WindowAggregate>()

  constructor(warmupUs: bigint) {
    this.warmupUs = warmupUs
  }

  /**
   * Ingest one terminal request. This is the ONE place the warmup gate is
   * applied: terminals before warmup are dropped entirely.
   *
   * @param state           terminal state
   * @param latencyUs       client-observed latency (termination − creation), integer µs
   * @param terminationTimeUs  absolute termination time, used for window assignment + warmup gate
   */
  onTerminal(state: TerminalState, latencyUs: bigint, terminationTimeUs: bigint): void {
    if (terminationTimeUs < this.warmupUs) {
      return
    }

    const windowStartUs = (terminationTimeUs / WINDOW_US) * WINDOW_US
    const window = this.ensureWindow(Number(windowStartUs))
    window.counts[state]++

    const latencyNumber = Number(latencyUs < 0n ? 0n : latencyUs)

    if (state === 'completed') {
      window.successHist.record(latencyNumber)
      window.sums.successUs += latencyUs < 0n ? 0n : latencyUs
      return
    }

    const cause: ErrorCause = state
    let hist = window.errorHist[cause]
    if (!hist) {
      hist = new Hist()
      window.errorHist[cause] = hist
    }
    hist.record(latencyNumber)
    window.sums.errorUs += latencyUs < 0n ? 0n : latencyUs
  }

  /** All windows in ascending start-time order (for time-series consumers). */
  orderedWindows(): WindowAggregate[] {
    return [...this.windows.values()].sort((a, b) => a.windowStart - b.windowStart)
  }

  /** Merged completed-only latency histogram across every window. */
  mergedSuccessHist(): Hist {
    const merged = new Hist()
    for (const window of this.windows.values()) {
      merged.merge(window.successHist)
    }
    return merged
  }

  /** Merged per-cause time-to-error histograms across every window. */
  mergedErrorHistByCause(): Record<ErrorCause, Hist> {
    const result = emptyErrorHists()
    for (const window of this.windows.values()) {
      for (const cause of ERROR_CAUSES) {
        const hist = window.errorHist[cause]
        if (hist) {
          result[cause].merge(hist)
        }
      }
    }
    return result
  }

  /** Exact sum of completed latencies (µs) and their count — for an exact mean. */
  successSummary(): { sumUs: bigint; count: number } {
    let sumUs = 0n
    let count = 0
    for (const window of this.windows.values()) {
      sumUs += window.sums.successUs
      count += window.counts.completed
    }
    return { sumUs, count }
  }

  private ensureWindow(windowStart: number): WindowAggregate {
    const existing = this.windows.get(windowStart)
    if (existing) {
      return existing
    }
    const created: WindowAggregate = {
      windowStart,
      counts: emptyCounts(),
      successHist: new Hist(),
      errorHist: {},
      sums: { successUs: 0n, errorUs: 0n },
      inFlightAtClose: 0
    }
    this.windows.set(windowStart, created)
    return created
  }
}
