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

// ───────────────────── chapters 06 to 08 ─────────────────────

/** vCPU counts of the EC2 sizes the chapter quotes (docs.aws.amazon.com/ec2 instance types). */
export const VCPU: Record<string, number> = {
  't3.medium': 2,
  'm5.large': 2,
  'm5.xlarge': 4,
  'm5.2xlarge': 8,
  'm5.4xlarge': 16,
  'c5.large': 2,
  'c5.2xlarge': 8
}

/** Workers per vCPU for the two profiles (chapter 06 section 3.1). */
export const WORKERS_PER_VCPU = { 'cpu-bound': 1, 'io-bound': 32 } as const

/** Goetz sizing formula: cores x target utilisation x (1 + wait / service). */
export function goetzThreads(
  cores: number,
  waitMs: number,
  serviceMs: number,
  utilisation = 1
): number {
  return cores * utilisation * (1 + waitMs / serviceMs)
}

/** Concurrency = rate x duration (Little's Law as AWS Lambda states it). */
export function concurrency(rps: number, durationSec: number): number {
  return rps * durationSec
}

/** Amdahl speedup for parallel fraction p on n processors. */
export function amdahl(p: number, n: number): number {
  return 1 / (1 - p + p / n)
}

/** Universal Scalability Law relative capacity and its peak (chapter 06 section 5.2). */
export function usl(alpha: number, beta: number, n: number): number {
  return n / (1 + alpha * (n - 1) + beta * n * (n - 1))
}
export function uslPeak(alpha: number, beta: number): number {
  return Math.sqrt((1 - alpha) / beta)
}

/** Service time on a core of relative speed `perf`; io-bound work only gets 25% of the advantage. */
export function effectiveServiceMs(
  baseMs: number,
  perf: number,
  kind: 'cpu-bound' | 'io-bound'
): number {
  const eff = kind === 'cpu-bound' ? perf : 1 + (perf - 1) * 0.25
  return baseMs / eff
}

/** Origin share of traffic behind a cache of hit ratio h, optionally behind a shield of hit ratio h2. */
export function originShare(h: number, shieldHit = 0): number {
  return (1 - h) * (1 - shieldHit)
}

/** Mean latency through a cache: hit costs the edge; a miss also pays the origin. */
export function cdnMeanMs(h: number, edgeMs: number, originMs: number): number {
  return h * edgeMs + (1 - h) * (edgeMs + originMs)
}

/** Fraction of keys that stay put when hash mod n grows to n + 1 (about 1 / (n + 1)). */
export function modHashMoved(n: number): number {
  return 1 - 1 / (n + 1)
}

/** Transmission time of `bytes` over `mbps`, in ms. */
export function transmissionMs(bytes: number, mbps: number): number {
  return bytes / (mbps * 125)
}

/** Bandwidth-delay product in bytes. */
export function bdpBytes(mbps: number, rttMs: number): number {
  return (mbps * 1e6 * (rttMs / 1000)) / 8
}

/** Round trips before the first response byte on a fresh connection (chapter 08 section 4). */
export function roundTripsToFirstByte(tls: 'none' | '1.2' | '1.3', resumed = false): number {
  const tcp = 1
  const request = 1
  if (tls === 'none') return tcp + request
  if (tls === '1.2') return tcp + (resumed ? 1 : 2) + request
  return tcp + (resumed ? 0 : 1) + request
}

/** Mathis bound on TCP throughput in bits per second. */
export function mathisBps(
  mssBytes: number,
  rttSec: number,
  lossProbability: number,
  c = Math.sqrt(1.5)
): number {
  return ((mssBytes * 8) / rttSec) * (c / Math.sqrt(lossProbability))
}

/** Probability that at least one of `packets` packets is lost. */
export function requestHitByLoss(p: number, packets: number): number {
  return 1 - (1 - p) ** packets
}

/** Connections needed for `rps` at `latencySec` when each connection carries `streams` requests. */
export function connectionsNeeded(rps: number, latencySec: number, streams: number): number {
  return Math.ceil((rps * latencySec) / streams)
}

/** Mean added wait for records in a batch that fills: records wait 0..(n - 1) gaps, average (n - 1) / 2 gaps. */
export function batchMeanWaitMs(recordsPerBatch: number, gapMs: number): number {
  return ((recordsPerBatch - 1) / 2) * gapMs
}

// ───────────────────── chapters 09 to 13: storage, caching, replication, sharding, messaging ─────────────────────

/** Writes a store accepts before it is full: free bytes / (record bytes x write amplification), ch09 section 9. */
export function writesBeforeFull(
  capacityGb: number,
  initialGb: number,
  recordBytes: number,
  writeAmplification: number
): number {
  return Math.floor(((capacityGb - initialGb) * 1e9) / (recordBytes * writeAmplification))
}

/**
 * Che approximation of an LRU cache hit ratio under Zipf(s) over `size` keys with room for `capacity`
 * items (ch10 section 2.3): find t with sum(1 - e^(-q_i t)) = capacity, then hit = sum(p_i (1 - e^(-q_i t))).
 */
export function cheHitRatio(size: number, s: number, capacity: number): number {
  let norm = 0
  for (let r = 1; r <= size; r += 1) norm += r ** -s
  const p = (r: number) => r ** -s / norm
  const filled = (t: number) => {
    let sum = 0
    for (let r = 1; r <= size; r += 1) sum += 1 - Math.exp(-p(r) * t)
    return sum
  }
  let lo = 0
  let hi = 1
  while (filled(hi) < capacity) hi *= 2
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2
    if (filled(mid) < capacity) lo = mid
    else hi = mid
  }
  const t = (lo + hi) / 2
  let hit = 0
  for (let r = 1; r <= size; r += 1) hit += p(r) * (1 - Math.exp(-p(r) * t))
  return hit
}

/** nth harmonic number: the mean of the max of n unit-mean exponentials (ch12 section 7). */
export function harmonic(n: number): number {
  let h = 0
  for (let k = 1; k <= n; k += 1) h += 1 / k
  return h
}

/** p-quantile of the max of n iid exponentials with mean mu: -mu ln(1 - p^(1/n)). */
export function maxExpQuantile(mu: number, n: number, p: number): number {
  return -mu * Math.log(1 - p ** (1 / n))
}

function choose(n: number, k: number): number {
  let c = 1
  for (let i = 1; i <= k; i += 1) c = (c * (n - k + i)) / i
  return c
}

/** Probability that at least `need` of `n` replicas are up when each is up independently with probability p (ch11 section 5). */
export function quorumAvailability(n: number, need: number, p: number): number {
  let total = 0
  for (let i = need; i <= n; i += 1) total += choose(n, i) * p ** i * (1 - p) ** (n - i)
  return total
}

/**
 * Probability that a follower read misses a write to the same key: some write committed less than `lagMs`
 * (minus the read's own execution time) before the read, with writes to the key arriving as a Poisson process.
 */
export function staleReadProbability(
  writesPerSecPerKey: number,
  lagMs: number,
  readMs = 0
): number {
  return 1 - Math.exp((-writesPerSecPerKey * Math.max(0, lagMs - readMs)) / 1000)
}

/** Probability a message with exponential(mean) processing outlives `limitMs`: the redelivery share (ch13). */
export function redeliveryShare(meanMs: number, limitMs: number): number {
  return Math.exp(-limitMs / meanMs)
}
