import { msToMicro } from '../core/time'
import type { ComponentType } from '../core/types'
import type {
  BeforeArrivalDecision,
  NodeBehaviourTrait,
  NodeCapabilityModule,
  TraitStateStore
} from './types'

export const RATE_LIMITER_COMPONENT_TYPES = [
  'api-gateway',
  'third-party-api-connector',
  'rate-limiter',
  'throttler'
] as const satisfies readonly ComponentType[]

/**
 * The admission algorithm the node runs. `token-bucket` is the legacy default
 * (burst-tolerant). `fixed-window` and `sliding-window` are the counter
 * algorithms from the rate-limiter lesson; fixed-window intentionally admits up
 * to 2× the limit across a window boundary (the edge-doubling bug), which the
 * shared breach oracle then catches.
 */
export type RateLimitAlgorithm = 'token-bucket' | 'fixed-window' | 'sliding-window'

interface TokenBucketState {
  tokens: number
  lastRefillUs: bigint
}

/** Per-key fixed-window counter: a window origin plus the count inside it. */
interface FixedWindowState {
  windowStartUs: bigint
  count: number
}

/** Per-key sliding-window log: admit timestamps within the trailing window. */
interface SlidingWindowState {
  timestampsUs: bigint[]
}

const TOKEN_STATE_KEY = 'rateLimiter.bucket'
const FIXED_STATE_KEY = 'rateLimiter.fixedWindow'
const SLIDING_STATE_KEY = 'rateLimiter.slidingWindow'
/**
 * Run-scoped, cross-node ledger of admit timestamps per resource key. This is
 * the *physics-truth oracle*: it sums admits across EVERY rate-limiter node so
 * that two uncoordinated local limiters (or a fixed-window edge burst) show up
 * as more than `limit` admits inside one rolling window. Admission never reads
 * this — it only observes, so correctness still has to come from topology
 * (funnel all traffic through a single authority).
 */
const SHARED_LEDGER_STATE_KEY = 'rateLimiter.globalAdmitLedger'
const GLOBAL_KEY = '__global__'
const US_PER_SECOND = 1_000_000

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readAlgorithm(config: Record<string, unknown> | undefined): RateLimitAlgorithm {
  const raw = asNonEmptyString(config?.['algorithm'])
  if (raw === 'fixed-window' || raw === 'sliding-window' || raw === 'token-bucket') {
    return raw
  }
  return 'token-bucket'
}

/** The per-request resource key (per-client/per-user bucketing), or the global bucket. */
function resolveKey(
  request: { metadata: Record<string, unknown> },
  keyField: string | null
): { key: string; keyless: boolean } {
  if (!keyField) {
    return { key: GLOBAL_KEY, keyless: false }
  }
  const value = asNonEmptyString(request.metadata[keyField])
  return value ? { key: value, keyless: false } : { key: GLOBAL_KEY, keyless: true }
}

function mapState<T>(state: TraitStateStore | undefined, storeKey: string): Map<string, T> {
  const existing = state?.get<Map<string, T>>(storeKey)
  if (existing) {
    return existing
  }
  const created = new Map<string, T>()
  state?.set(storeKey, created)
  return created
}

/**
 * Records an admit in the cross-node ledger and returns whether this admit
 * pushed the true rolling-window count above `limit` (a contract breach). When
 * `limit`/`windowUs` are not configured, breach detection is inert (legacy
 * token-bucket-only nodes keep their old behaviour).
 */
function recordGlobalAdmit(
  sharedState: TraitStateStore | undefined,
  key: string,
  clock: bigint,
  windowUs: bigint | null,
  limit: number | null
): boolean {
  if (windowUs === null || limit === null || !sharedState) {
    return false
  }
  const ledger = mapState<bigint[]>(sharedState, SHARED_LEDGER_STATE_KEY)
  const cutoff = clock - windowUs
  const kept = (ledger.get(key) ?? []).filter((t) => t > cutoff)
  kept.push(clock)
  ledger.set(key, kept)
  return kept.length > limit
}

function admitPayload(
  key: string,
  algorithm: RateLimitAlgorithm,
  breached: boolean
): Record<string, unknown> {
  return {
    rateDecision: 'admitted',
    algorithm,
    resourceKey: key,
    metricCounters: {
      rateAdmitted: 1,
      ...(breached ? { rateLimitBreaches: 1 } : {})
    }
  }
}

function rejectDecision(key: string, algorithm: RateLimitAlgorithm): BeforeArrivalDecision {
  return {
    action: 'rejected',
    reason: 'rate_limited',
    payload: {
      rateDecision: 'rejected',
      algorithm,
      resourceKey: key,
      metricCounters: { rateRejected: 1 }
    }
  }
}

// ── Algorithms ────────────────────────────────────────────────────────────────

/** Token bucket: burst up to `maxTokens`, refill at `refillRatePerSecond`. */
function admitTokenBucket(
  state: TraitStateStore | undefined,
  key: string,
  clock: bigint,
  maxTokens: number,
  refillRatePerSecond: number
): boolean {
  const buckets = mapState<TokenBucketState>(state, TOKEN_STATE_KEY)
  const previous = buckets.get(key) ?? { tokens: maxTokens, lastRefillUs: clock }
  const elapsedSeconds = Number(clock - previous.lastRefillUs) / US_PER_SECOND
  const available = Math.min(
    maxTokens,
    previous.tokens + Math.max(0, elapsedSeconds) * refillRatePerSecond
  )
  if (available < 1) {
    buckets.set(key, { tokens: available, lastRefillUs: clock })
    return false
  }
  buckets.set(key, { tokens: available - 1, lastRefillUs: clock })
  return true
}

/**
 * Fixed window: the window origin is aligned to `floor(clock / windowUs)`, so a
 * burst straddling a boundary can admit `limit` in each of two adjacent windows
 * — the classic 2×-limit edge bug the lesson teaches.
 */
function admitFixedWindow(
  state: TraitStateStore | undefined,
  key: string,
  clock: bigint,
  windowUs: bigint,
  limit: number
): boolean {
  const windows = mapState<FixedWindowState>(state, FIXED_STATE_KEY)
  const alignedStart = (clock / windowUs) * windowUs
  const current = windows.get(key)
  if (!current || current.windowStartUs !== alignedStart) {
    windows.set(key, { windowStartUs: alignedStart, count: 1 })
    return true
  }
  if (current.count < limit) {
    current.count += 1
    return true
  }
  return false
}

/** Sliding-window log: exact — never admits more than `limit` in any trailing window. */
function admitSlidingWindow(
  state: TraitStateStore | undefined,
  key: string,
  clock: bigint,
  windowUs: bigint,
  limit: number
): boolean {
  const logs = mapState<SlidingWindowState>(state, SLIDING_STATE_KEY)
  const cutoff = clock - windowUs
  const existing = logs.get(key)?.timestampsUs ?? []
  const kept = existing.filter((t) => t > cutoff)
  if (kept.length >= limit) {
    logs.set(key, { timestampsUs: kept })
    return false
  }
  kept.push(clock)
  logs.set(key, { timestampsUs: kept })
  return true
}

export const rateLimiterTrait: NodeBehaviourTrait = {
  name: 'rate-limiter',
  beforeArrival: ({ node, request, clock, state, sharedState }): BeforeArrivalDecision => {
    const config = node.config
    const algorithm = readAlgorithm(config)
    const keyField = asNonEmptyString(config?.['rateLimitKeyField'])
    const limit = asPositiveNumber(config?.['limit'])
    const windowMs = asPositiveNumber(config?.['windowMs'])
    const windowUs = windowMs !== null ? msToMicro(windowMs) : null

    const { key, keyless } = resolveKey(request, keyField)

    // Window algorithms need both `limit` and `windowMs`.
    if (
      (algorithm === 'fixed-window' || algorithm === 'sliding-window') &&
      (limit === null || windowUs === null)
    ) {
      return { action: 'continue' }
    }

    // Token bucket needs its two legacy params; without them the node is a no-op
    // (matches the historical behaviour so existing questions are unaffected).
    const maxTokens = asPositiveNumber(config?.['maxTokens'])
    const refillRatePerSecond = asNonNegativeNumber(config?.['refillRatePerSecond'])
    if (algorithm === 'token-bucket' && (maxTokens === null || refillRatePerSecond === null)) {
      return { action: 'continue' }
    }

    if (keyless) {
      return {
        action: 'continue',
        payload: { rateDecision: 'keyless', algorithm, metricCounters: { rateKeyless: 1 } }
      }
    }

    let admitted: boolean
    if (algorithm === 'fixed-window') {
      admitted = admitFixedWindow(state, key, clock, windowUs!, limit!)
    } else if (algorithm === 'sliding-window') {
      admitted = admitSlidingWindow(state, key, clock, windowUs!, limit!)
    } else {
      admitted = admitTokenBucket(state, key, clock, maxTokens!, refillRatePerSecond!)
    }

    if (!admitted) {
      return rejectDecision(key, algorithm)
    }

    const breached = recordGlobalAdmit(sharedState, key, clock, windowUs, limit)
    return { action: 'continue', payload: admitPayload(key, algorithm, breached) }
  }
}

export const rateLimiterCapabilityModule: NodeCapabilityModule = {
  name: 'rate-limiter',
  appliesTo: RATE_LIMITER_COMPONENT_TYPES,
  hooks: rateLimiterTrait,
  config: {
    sections: [
      {
        id: 'rate-limiting',
        title: 'Rate Limiting',
        note: 'Admission control per request. Choose an algorithm; for the window algorithms set the limit and window. Bucketing per client/user needs a key field. Two uncoordinated limiters for the same key (local counters) let a client exceed the limit — surfaced as rateLimit.breaches.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.algorithm',
            type: 'select',
            label: 'Algorithm',
            options: ['token-bucket', 'fixed-window', 'sliding-window'],
            altitude: 'primary',
            why: 'token-bucket tolerates bursts; fixed-window is simple but admits up to 2× at a window boundary; sliding-window is exact.'
          },
          {
            path: 'sim.limit',
            type: 'input',
            label: 'Limit',
            step: 1,
            unit: 'req/window',
            altitude: 'primary',
            why: 'The contracted cap per key per window. Also the ceiling the breach oracle measures true admits against (window algorithms).'
          },
          {
            path: 'sim.windowMs',
            type: 'input',
            label: 'Window',
            unit: 'ms',
            step: 1,
            altitude: 'primary',
            why: 'The rolling window the limit applies over (window algorithms).'
          },
          {
            path: 'sim.rateLimitKeyField',
            type: 'input',
            label: 'Key field',
            inputType: 'text',
            altitude: 'primary',
            placeholder: 'global bucket if empty',
            why: 'Reads the per-client/per-user key from request.metadata.<field>. Empty ⇒ one global bucket for the node.'
          },
          {
            path: 'sim.maxTokens',
            type: 'input',
            label: 'Bucket size',
            step: 1,
            unit: 'tokens',
            altitude: 'advanced',
            why: 'Token-bucket burst size before it starts rejecting.'
          },
          {
            path: 'sim.refillRatePerSecond',
            type: 'input',
            label: 'Refill rate',
            step: 1,
            unit: 'tokens/s',
            altitude: 'advanced',
            why: 'Token-bucket steady-state replenishment rate.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['rateAdmitted', 'rateRejected', 'rateLimitBreaches', 'rateKeyless'],
    rejectionReasons: ['rate_limited']
  },
  honesty: {
    simulates: [
      'per-key admission control (token-bucket / fixed-window / sliding-window)',
      'the fixed-window edge-doubling bug and uncoordinated-limiter over-admission, both surfaced as rateLimit.breaches against a shared rolling-window oracle'
    ],
    notModeled: [
      'per-tenant quota hierarchies and rule config (domain/descriptor formats)',
      'the exact read-modify-write interleaving inside a single counter (admission is atomic per event)',
      'HTTP 429 semantics and X-RateLimit response headers'
    ]
  }
}
