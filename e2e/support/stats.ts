/** Small statistics helpers for turning samples and windows into numbers to compare with theory. */
export function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

export function variance(xs: number[]): number {
  const m = mean(xs)
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)
}

export function sd(xs: number[]): number {
  return Math.sqrt(variance(xs))
}

export function quantile(xs: number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** Student t, two-sided 95%, for the small replication counts the chapter uses. */
const T95: Record<number, number> = {
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  14: 2.145,
  19: 2.093,
  29: 2.045
}

export function confidenceInterval95(xs: number[]): { mean: number; halfWidth: number } {
  const n = xs.length
  const t = T95[n - 1]
  if (t === undefined) throw new Error(`no t value for ${n - 1} degrees of freedom`)
  return { mean: mean(xs), halfWidth: (t * sd(xs)) / Math.sqrt(n) }
}

/** Index of dispersion of counts: variance / mean. 1 for Poisson, much larger for bursty. */
export function indexOfDispersion(counts: number[]): number {
  return variance(counts) / mean(counts)
}
