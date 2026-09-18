/**
 * Closed-form M/M/c queueing latency for the analytic (fluid) tier.
 *
 * The fluid model (`fluidModel.ts`) answers throughput/utilization/headroom from
 * rates alone. This adds the other half a designer cares about at scale: how long
 * requests wait. For a node modelled as an M/M/c queue — `c` parallel servers,
 * each serving at rate `μ`, Poisson arrivals at rate `λ` — the Erlang-C formula
 * gives the probability an arrival must queue, and from it the mean wait and mean
 * response time in closed form. No events, valid for any `λ` including millions/s.
 *
 * Percentiles (p50/p95/p99) are an *approximation*: the sojourn time is treated as
 * exponential with the exact analytic mean, which is the standard teaching-grade
 * estimate (exact for c=1, close for higher c away from saturation). The means and
 * the wait probability are exact; only the percentile shape is approximated. As
 * ρ = λ/(cμ) → 1 the wait grows without bound — the honest signal that a tier is
 * out of headroom even before it drops requests.
 */

export interface MMcLatency {
  /** Utilization ρ = λ / (c·μ). */
  utilization: number
  /** Erlang-C: probability an arriving request has to wait for a free server. */
  waitProbability: number
  /** Mean time spent queued before service (ms). */
  meanWaitMs: number
  /** Mean end-to-end time = queue wait + service (ms). */
  meanResponseMs: number
  /** False when ρ ≥ 1 (unstable: unbounded queue). Means are Infinity then. */
  stable: boolean
}

/**
 * Erlang-B blocking probability B(c, a) for `c` servers and offered load `a`
 * (Erlangs). Computed with the numerically stable recurrence
 * `B(k) = a·B(k−1) / (k + a·B(k−1))`, which avoids the huge factorials/powers of
 * the closed form and is accurate for large `c`.
 */
export function erlangB(c: number, a: number): number {
  if (c <= 0) return 1
  let b = 1 // B(0) = 1
  for (let k = 1; k <= c; k++) {
    b = (a * b) / (k + a * b)
  }
  return b
}

/**
 * Erlang-C probability of waiting C(c, a), derived from Erlang-B:
 * `C = B / (1 − ρ·(1 − B))`, with ρ = a/c. Returns 1 when the system is at or
 * over capacity (ρ ≥ 1), where every arrival eventually queues.
 */
export function erlangC(c: number, a: number): number {
  if (c <= 0) return 1
  const rho = a / c
  if (rho >= 1) return 1
  const b = erlangB(c, a)
  const denom = 1 - rho * (1 - b)
  if (denom <= 0) return 1
  return b / denom
}

/**
 * M/M/c latency for arrival rate `lambdaRps`, `servers` parallel servers each at
 * `serviceRatePerServerRps`. Returns exact means + wait probability; `stable` is
 * false (means Infinity) when ρ ≥ 1.
 */
export function mmcLatency(
  lambdaRps: number,
  servers: number,
  serviceRatePerServerRps: number
): MMcLatency {
  const c = Math.max(1, Math.floor(servers))
  const mu = serviceRatePerServerRps
  const serviceMs = mu > 0 ? 1000 / mu : Number.POSITIVE_INFINITY

  if (mu <= 0 || lambdaRps <= 0) {
    return {
      utilization: 0,
      waitProbability: 0,
      meanWaitMs: 0,
      meanResponseMs: Number.isFinite(serviceMs) ? serviceMs : 0,
      stable: true
    }
  }

  const a = lambdaRps / mu // offered load in Erlangs
  const rho = a / c

  if (rho >= 1) {
    return {
      utilization: rho,
      waitProbability: 1,
      meanWaitMs: Number.POSITIVE_INFINITY,
      meanResponseMs: Number.POSITIVE_INFINITY,
      stable: false
    }
  }

  const pWait = erlangC(c, a)
  // Wq = C / (cμ − λ), in seconds → ms.
  const meanWaitMs = (pWait / (c * mu - lambdaRps)) * 1000
  return {
    utilization: rho,
    waitProbability: pWait,
    meanWaitMs,
    meanResponseMs: meanWaitMs + serviceMs,
    stable: true
  }
}

/**
 * Approximate a response-time percentile from the analytic mean, treating the
 * sojourn time as exponential: `q`-quantile = `-mean · ln(1 − q)`. Exact for a
 * single-server queue; a reasonable teaching estimate otherwise. Returns the mean
 * when it is not finite (unstable) or `q` is out of range.
 */
export function approxResponsePercentileMs(meanResponseMs: number, q: number): number {
  if (!Number.isFinite(meanResponseMs)) return meanResponseMs
  if (q <= 0) return 0
  if (q >= 1) return Number.POSITIVE_INFINITY
  return -meanResponseMs * Math.log(1 - q)
}
