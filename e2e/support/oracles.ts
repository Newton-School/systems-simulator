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

// ───────────────────── chapter 03: distributions ─────────────────────

/** Standard normal quantiles used by the chapter (one-sided). */
export const Z = { p50: 0, p90: 1.2816, p95: 1.6449, p99: 2.3263, p999: 3.0902 } as const

/** Standard normal CDF and density, for the clamped-normal mean. */
export function normCdf(x: number): number {
  // Abramowitz and Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2))
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-((x / Math.SQRT2) ** 2))
  return 0.5 * (1 + (x >= 0 ? y : -y))
}
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

/** E[max(X, 0)] for X ~ Normal(mean, sd): what a clamped-at-zero normal service time averages. */
export function clampedNormalMean(mean: number, sd: number): number {
  const a = mean / sd
  return mean * normCdf(a) + sd * normPdf(a)
}

function gammaFn(z: number): number {
  // Lanczos approximation
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z))
  const x = z - 1
  let a = c[0]
  const t = x + g + 0.5
  for (let i = 1; i < g + 2; i += 1) a += c[i] / (x + i)
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * a
}

export interface Moments {
  mean: number
  sd: number
}

export const dist = {
  uniform: (min: number, max: number): Moments => ({
    mean: (min + max) / 2,
    sd: (max - min) / Math.sqrt(12)
  }),
  exponential: (mean: number): Moments => ({ mean, sd: mean }),
  expQuantile: (mean: number, p: number): number => -mean * Math.log(1 - p),
  normalQuantile: (mean: number, sd: number, z: number): number => mean + sd * z,
  logNormal: (mu: number, sigma: number): Moments => ({
    mean: Math.exp(mu + (sigma * sigma) / 2),
    sd: Math.sqrt((Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma))
  }),
  logNormalCv: (sigma: number): number => Math.sqrt(Math.exp(sigma * sigma) - 1),
  logNormalQuantile: (mu: number, sigma: number, z: number): number => Math.exp(mu + sigma * z),
  gamma: (k: number, theta: number): Moments => ({ mean: k * theta, sd: Math.sqrt(k) * theta }),
  weibull: (k: number, lambda: number): Moments => ({
    mean: lambda * gammaFn(1 + 1 / k),
    sd: lambda * Math.sqrt(gammaFn(1 + 2 / k) - gammaFn(1 + 1 / k) ** 2)
  }),
  weibullQuantile: (k: number, lambda: number, p: number): number =>
    lambda * (-Math.log(1 - p)) ** (1 / k),
  pareto: (alpha: number, xm: number): Moments => ({
    mean: (alpha * xm) / (alpha - 1),
    sd: Math.sqrt(((xm / (alpha - 1)) ** 2 * alpha) / (alpha - 2))
  }),
  paretoQuantile: (alpha: number, xm: number, p: number): number => xm * (1 - p) ** (-1 / alpha),
  beta: (a: number, b: number): Moments => ({
    mean: a / (a + b),
    sd: Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)))
  }),
  binomial: (n: number, p: number): Moments => ({ mean: n * p, sd: Math.sqrt(n * p * (1 - p)) }),
  poisson: (lambda: number): Moments => ({ mean: lambda, sd: Math.sqrt(lambda) }),
  /** Mixture moments from components {weight, mean, sd}. */
  mixture: (parts: { w: number; mean: number; sd: number }[]): Moments => {
    const mean = parts.reduce((a, p) => a + p.w * p.mean, 0)
    const second = parts.reduce((a, p) => a + p.w * (p.sd * p.sd + p.mean * p.mean), 0)
    return { mean, sd: Math.sqrt(second - mean * mean) }
  }
}

// ───────────────────── chapter 05: workload ─────────────────────

/** Fraction of requests that go to the `topN` hottest of `size` keys under Zipf(s). */
export function zipfTopShare(size: number, s: number, topN: number): number {
  let total = 0
  let top = 0
  for (let r = 1; r <= size; r += 1) {
    const w = r ** -s
    total += w
    if (r <= topN) top += w
  }
  return top / total
}

/** M/G/1 mean queue wait (Pollaczek-Khinchine), chapter 01 section 4.2. */
export function mg1WqSec(lambda: number, serviceSec: number, cs2: number): number {
  const rho = lambda * serviceSec
  return (rho / (1 - rho)) * ((1 + cs2) / 2) * serviceSec
}
