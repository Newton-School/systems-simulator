/**
 * Closed-form expectations from docs/reference/01-queueing-and-performance.md and
 * 02-reliability-patterns.md. These are the oracles: they never read engine output.
 * Times are in seconds unless a name ends in Ms.
 */

export function factorial(n: number): number {
  let f = 1
  for (let i = 2; i <= n; i += 1) f *= i
  return f
}

/** Erlang C: probability an arrival waits in M/M/c with offered load A = lambda/mu (A < c). */
export function erlangC(c: number, A: number): number {
  const rho = A / c
  if (rho >= 1) throw new Error('Erlang C needs rho < 1')
  let sum = 0
  for (let k = 0; k < c; k += 1) sum += A ** k / factorial(k)
  const top = A ** c / factorial(c) / (1 - rho)
  return top / (sum + top)
}

export interface MMcResult {
  rho: number
  pWait: number
  wqSec: number
  wSec: number
  lq: number
  l: number
}

/** M/M/c steady state (chapter 01, section 5.1). */
export function mmc(lambda: number, mu: number, c: number): MMcResult {
  const A = lambda / mu
  const rho = A / c
  const pWait = erlangC(c, A)
  const wqSec = pWait / (c * mu - lambda)
  const wSec = 1 / mu + wqSec
  const lq = (pWait * rho) / (1 - rho)
  return { rho, pWait, wqSec, wSec, lq, l: lambda * wSec }
}

export interface MMcKResult {
  blocking: number
  lambdaEff: number
  l: number
  wSec: number
  /** Busy servers on average = lambdaEff / mu. */
  utilization: number
}

/** M/M/c/K (chapter 01, section 5.3). K is total capacity: servers plus waiting room. */
export function mmcK(lambda: number, mu: number, c: number, K: number): MMcKResult {
  const A = lambda / mu
  const weights: number[] = []
  for (let n = 0; n <= K; n += 1) {
    weights.push(n <= c ? A ** n / factorial(n) : (A ** c / factorial(c)) * (A / c) ** (n - c))
  }
  const total = weights.reduce((a, b) => a + b, 0)
  const probs = weights.map((w) => w / total)
  const blocking = probs[K]
  const lambdaEff = lambda * (1 - blocking)
  const l = probs.reduce((acc, p, n) => acc + n * p, 0)
  return { blocking, lambdaEff, l, wSec: l / lambdaEff, utilization: lambdaEff / mu / c }
}

/** M/D/1 mean queue wait (Pollaczek-Khinchine with c_s^2 = 0), chapter 01 section 4.2. */
export function md1WqSec(lambda: number, serviceSec: number): number {
  const rho = lambda * serviceSec
  return (rho * serviceSec) / (2 * (1 - rho))
}

/** M/M/1 mean time in system (chapter 01 section 4.1). */
export function mm1WSec(lambda: number, mu: number): number {
  return 1 / (mu - lambda)
}

/** Kingman G/G/1 mean queue wait (chapter 01 section 4.3). Approximation only. */
export function kingmanWqSec(rho: number, ca2: number, cs2: number, serviceSec: number): number {
  return (rho / (1 - rho)) * ((ca2 + cs2) / 2) * serviceSec
}

/** Little's Law: L = lambda * W (chapter 01 section 3). */
export function littleL(lambda: number, wSec: number): number {
  return lambda * wSec
}

/** Expected attempts per call, failure probability p each attempt, r retries (chapter 02 section 2). */
export function expectedAttempts(p: number, retries: number): number {
  if (p >= 1) return 1 + retries
  return (1 - p ** (retries + 1)) / (1 - p)
}

/** Worst-case amplification across layers that each make `attempts` attempts (AWS: 3^5 = 243). */
export function layeredAmplification(attemptsPerLayer: number, layers: number): number {
  return attemptsPerLayer ** layers
}

/** Long-run admitted count for a token bucket: capacity burst plus refill over the window. */
export function tokenBucketAdmitted(
  offered: number,
  capacity: number,
  refillPerSec: number,
  secs: number
): number {
  return Math.min(offered, capacity + refillPerSec * secs)
}

/** Max burst duration from a full bucket at peak M > R (chapter 02 section 4). */
export function tokenBucketBurstSec(capacity: number, peak: number, rate: number): number {
  return capacity / (peak - rate)
}

/** Load carried by each survivor after k of n equal servers fail (chapter 01 section 8). */
export function survivorLoadFactor(n: number, failed: number): number {
  return n / (n - failed)
}

/** Servers needed for `rps` at per-server capacity and a hard utilization ceiling. Always rounds up. */
export function serversNeeded(rps: number, perServerRps: number, maxUtilization: number): number {
  return Math.ceil(rps / (maxUtilization * perServerRps))
}

export function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected)
}
