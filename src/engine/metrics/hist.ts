/**
 * HDR-style fixed-bucket logarithmic histogram over integer microseconds.
 *
 * Design constraints:
 *   - Domain: integer microseconds in [1, 2^30 - 1] (about 17.9 minutes). A node or request timeout is
 *     configurable up to minutes, so latencies of several seconds are real; values above the top are clamped.
 *   - Resolution: 64 linear sub-buckets per power-of-2 band, 30 bands (2^0 .. 2^29). The first 20 bands
 *     (up to 2^20 us, about 1.05 s) are always allocated: 1280 buckets in a Uint32Array (~5 KB). The 10 bands
 *     above are allocated lazily on the first value over ~1 s, so a run whose latencies stay under a second
 *     pays nothing for the longer range.
 *   - Accuracy: reporting a bucket's midpoint bounds the relative error at
 *     w/2 / value <= (2^b / 64) / 2 / 2^b = 1/128 ~= 0.78% <= 1%, in every band.
 *   - Determinism: bucket assignment is a pure integer function of the value and
 *     merging is integer bucket-wise addition, so it is exact, associative, and
 *     order-independent. This is why we do NOT use t-digest: its merge is
 *     order-dependent and would break the seed-reproducibility guarantee.
 *
 * All arithmetic here is integer arithmetic. Every intermediate product stays
 * well below 2^53, so double-backed integers are exact.
 */

const MIN_VALUE = 1
const MAX_VALUE = 2 ** 30 - 1
const SUB_BUCKETS = 64
/** Highest band index: floor(log2(2^30 - 1)) = 29. */
const MAX_BAND = 29
/** Bands that are always allocated (2^0 .. 2^19, up to ~1.05 s). */
const BASE_BANDS = 20
const BASE_BUCKET_COUNT = BASE_BANDS * SUB_BUCKETS // 1280
const BUCKET_COUNT = (MAX_BAND + 1) * SUB_BUCKETS // 1920
const OVERFLOW_BUCKET_COUNT = BUCKET_COUNT - BASE_BUCKET_COUNT // 640

/** floor(log2(v)) for v in [1, 2^31). Identifies the power-of-2 band. */
function bandOf(v: number): number {
  return 31 - Math.clz32(v)
}

/**
 * Map a clamped integer value to its bucket index.
 * base = 2^band; sub = floor((v - base) * 64 / base); index = band * 64 + sub.
 * The product (v - base) * 64 is an exact integer < 2^26 and the divisor is a
 * power of two, so the division is exact in floating point before the floor.
 */
function bucketIndex(v: number): number {
  const band = bandOf(v)
  const base = 1 << band
  const sub = Math.floor(((v - base) * SUB_BUCKETS) / base)
  return band * SUB_BUCKETS + sub
}

/** The representative (midpoint) value in microseconds for a bucket index. */
function bucketMidpoint(index: number): number {
  const band = Math.floor(index / SUB_BUCKETS)
  const sub = index % SUB_BUCKETS
  const base = 1 << band
  const subWidth = base / SUB_BUCKETS
  return base + (sub + 0.5) * subWidth
}

export class Hist {
  /** Bucket counts for the always-allocated bands. Integer addition only. */
  private readonly buckets: Uint32Array
  /** Bucket counts for the bands above ~1 s, allocated on the first value that needs them. */
  private overflow: Uint32Array | null = null
  private totalCount = 0

  constructor() {
    this.buckets = new Uint32Array(BASE_BUCKET_COUNT)
  }

  /** Number of always-allocated buckets: exposed for tests and merge validation. */
  static get bucketCount(): number {
    return BASE_BUCKET_COUNT
  }

  /** Number of buckets once the long-latency bands are allocated. */
  static get maxBucketCount(): number {
    return BUCKET_COUNT
  }

  /**
   * Record a single observation, in integer microseconds. Values are clamped
   * into [1, 2^30 - 1]; non-finite or negative inputs are treated as the floor.
   */
  record(valueUs: number): void {
    let v = Math.trunc(valueUs)
    if (!Number.isFinite(v) || v < MIN_VALUE) {
      v = MIN_VALUE
    } else if (v > MAX_VALUE) {
      v = MAX_VALUE
    }
    const index = bucketIndex(v)
    if (index < BASE_BUCKET_COUNT) {
      this.buckets[index]++
    } else {
      this.overflow ??= new Uint32Array(OVERFLOW_BUCKET_COUNT)
      this.overflow[index - BASE_BUCKET_COUNT]++
    }
    this.totalCount++
  }

  /** Total number of recorded observations. */
  count(): number {
    return this.totalCount
  }

  /**
   * Merge another histogram into this one by integer bucket-wise addition.
   * Exact and associative: merge(A, B) has the same bucket counts as a single
   * histogram fed A ∪ B.
   */
  merge(other: Hist): void {
    const src = other.buckets
    const dst = this.buckets
    for (let i = 0; i < BASE_BUCKET_COUNT; i++) {
      dst[i] += src[i]
    }
    if (other.overflow) {
      this.overflow ??= new Uint32Array(OVERFLOW_BUCKET_COUNT)
      for (let i = 0; i < OVERFLOW_BUCKET_COUNT; i++) {
        this.overflow[i] += other.overflow[i]
      }
    }
    this.totalCount += other.totalCount
  }

  /**
   * Nearest-rank quantile. Uses rank = floor(q * (count - 1)) to match the
   * exact sorted-array definition used in tests. Returns the bucket midpoint in
   * microseconds, or `null` for an empty histogram — never 0.
   */
  quantile(q: number): number | null {
    if (this.totalCount === 0) {
      return null
    }
    const clampedQ = q < 0 ? 0 : q > 1 ? 1 : q
    const rank = Math.floor(clampedQ * (this.totalCount - 1))
    let cumulative = 0
    for (let i = 0; i < BASE_BUCKET_COUNT; i++) {
      cumulative += this.buckets[i]
      if (cumulative > rank) {
        return bucketMidpoint(i)
      }
    }
    if (this.overflow) {
      for (let i = 0; i < OVERFLOW_BUCKET_COUNT; i++) {
        cumulative += this.overflow[i]
        if (cumulative > rank) {
          return bucketMidpoint(BASE_BUCKET_COUNT + i)
        }
      }
    }
    // Unreachable when totalCount > 0, but keep the return type honest.
    return bucketMidpoint(BUCKET_COUNT - 1)
  }
}
