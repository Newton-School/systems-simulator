import { createEvent, type Request } from './core/events'
import { microToMs, msToMicro } from './core/time'
import { EventScheduler, RandomGenerator, WorkloadProfile } from './core/types'
import { Distributions } from './stochastic/distribution'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_BURST_MULTIPLIER = 5
const DEFAULT_BURST_DURATION_MS = 5_000
const DEFAULT_NORMAL_DURATION_MS = 10_000
const DEFAULT_RAMP_DURATION_MS = 10_000

export interface WorkloadGeneratorOptions {
  defaultTimeoutMs?: number
  simulationDurationMs?: number
}

export class WorkloadGenerator {
  /** Upper bound on the per-keyspace Zipf table size (memory guard). */
  private static readonly MAX_ZIPF_TABLE = 100_000

  private readonly distributions: Distributions
  private readonly defaultTimeoutMs: number
  private readonly simulationDurationUs: bigint | null

  private requestCounter = 0
  private startTime = 0n
  private initialized = false

  /**
   * Cache of normalized Zipf cumulative-probability tables, keyed by
   * `${size}:${skew}`. Built once per distinct keyspace shape and reused for
   * every draw, so skewed key selection stays O(log size) per request.
   */
  private readonly zipfTables = new Map<string, Float64Array>()

  constructor(
    private readonly config: WorkloadProfile,
    private readonly rng: RandomGenerator,
    private readonly scheduler: EventScheduler,
    options: WorkloadGeneratorOptions = {}
  ) {
    this.distributions = new Distributions(rng)
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.simulationDurationUs =
      options.simulationDurationMs === undefined ? null : msToMicro(options.simulationDurationMs)
  }

  initialize(startTime: bigint): void {
    this.startTime = startTime
    this.initialized = true
    this.scheduleRequestGeneratedAt(startTime)
  }

  generateNext(currentTime: bigint): Request {
    if (!this.initialized) {
      this.startTime = currentTime
      this.initialized = true
    }

    const request = this.createRequest(currentTime)
    this.scheduleNext(currentTime)
    return request
  }

  private scheduleNext(currentTime: bigint): void {
    const interArrivalMs = this.nextInterArrivalMs(currentTime)
    if (!Number.isFinite(interArrivalMs) || interArrivalMs < 0) {
      return
    }

    const interArrivalUs = BigInt(Math.max(1, Math.round(interArrivalMs * 1000)))
    this.scheduleRequestGeneratedAt(currentTime + interArrivalUs)
  }

  private scheduleRequestGeneratedAt(timestamp: bigint): void {
    if (this.simulationDurationUs !== null) {
      const endExclusive = this.startTime + this.simulationDurationUs
      if (timestamp >= endExclusive) {
        return
      }
    }

    this.scheduler.schedule(
      createEvent('request-generated', this.config.sourceNodeId, '', {}, timestamp)
    )
  }

  private nextInterArrivalMs(currentTime: bigint): number {
    const baseRps = this.config.baseRps

    switch (this.config.pattern) {
      case 'constant':
      case 'replay':
        return this.intervalForRps(baseRps)

      case 'poisson':
        return this.poissonIntervalForRps(baseRps)

      case 'bursty': {
        const burst = this.config.bursty
        const burstRps = burst?.burstRps ?? baseRps * DEFAULT_BURST_MULTIPLIER
        const burstDuration = burst?.burstDuration ?? DEFAULT_BURST_DURATION_MS
        const normalDuration = burst?.normalDuration ?? DEFAULT_NORMAL_DURATION_MS
        const cycleDuration = burstDuration + normalDuration
        const elapsedMs = this.elapsedMs(currentTime)
        const inBurst = elapsedMs % cycleDuration < burstDuration
        return this.intervalForRps(inBurst ? burstRps : baseRps)
      }

      case 'diurnal': {
        const hourlyMultipliers = this.config.diurnal?.hourlyMultipliers
        if (!hourlyMultipliers) {
          return this.intervalForRps(baseRps)
        }

        let hour = 0
        if (this.simulationDurationUs && this.simulationDurationUs > 0n) {
          const elapsedMs = this.elapsedMs(currentTime)
          const durationMs = microToMs(this.simulationDurationUs)
          const progress = durationMs > 0 ? (elapsedMs % durationMs) / durationMs : 0
          hour = Math.min(23, Math.floor(progress * 24))
        } else {
          const msInDay = 24 * 60 * 60 * 1000
          const msPerHour = 60 * 60 * 1000
          hour = Math.floor((this.elapsedMs(currentTime) % msInDay) / msPerHour)
        }

        const multiplier = hourlyMultipliers[hour] ?? 1
        return this.intervalForRps(baseRps * multiplier)
      }

      case 'spike': {
        const spike = this.config.spike
        if (!spike) {
          return this.intervalForRps(baseRps)
        }

        const elapsedMs = this.elapsedMs(currentTime)
        const inSpike =
          elapsedMs >= spike.spikeTime && elapsedMs < spike.spikeTime + spike.spikeDuration
        return this.intervalForRps(inSpike ? spike.spikeRps : baseRps)
      }

      case 'sawtooth': {
        const sawtooth = this.config.sawtooth
        if (!sawtooth) {
          return this.intervalForRps(baseRps)
        }

        const rampDuration =
          sawtooth.rampDuration > 0 ? sawtooth.rampDuration : DEFAULT_RAMP_DURATION_MS
        const elapsedInRamp = this.elapsedMs(currentTime) % rampDuration
        const t = elapsedInRamp / rampDuration
        const currentRps = baseRps + (sawtooth.peakRps - baseRps) * t
        return this.intervalForRps(currentRps)
      }

      default: {
        const neverPattern: never = this.config.pattern
        throw new Error(`Unsupported workload pattern: ${neverPattern}`)
      }
    }
  }

  private createRequest(currentTime: bigint): Request {
    const requestType = this.pickRequestDistributionEntry()
    const origin = this.pickTrafficOrigin()
    const requestId = `req-${String(++this.requestCounter).padStart(6, '0')}`

    return {
      id: requestId,
      type: requestType.type,
      sizeBytes: requestType.sizeBytes,
      priority: this.rng.boolean(0.1) ? 0 : 1, // 10% high, 90% normal
      createdAt: currentTime,
      deadline: currentTime + msToMicro(this.defaultTimeoutMs),
      path: [],
      spans: [],
      phaseRecord: {
        bornAtUs: currentTime,
        nodes: [],
        edges: []
      },
      retryCount: 0,
      completionSeq: 0,
      timeoutSeq: 0,
      metadata: this.buildRequestMetadata(requestType),
      origin: origin
        ? {
            originId: origin.id,
            label: origin.label,
            location: structuredClone(origin.location)
          }
        : undefined
    }
  }

  private pickTrafficOrigin(): NonNullable<WorkloadProfile['origins']>[number] | undefined {
    const origins = this.config.origins
    if (!origins || origins.length === 0) return undefined

    const totalWeight = origins.reduce((sum, origin) => sum + origin.weight, 0)
    if (totalWeight <= 0) return origins[0]
    const target = this.rng.next() * totalWeight
    let cumulative = 0
    for (const origin of origins) {
      cumulative += origin.weight
      if (target < cumulative) return origin
    }
    return origins[origins.length - 1]
  }

  /**
   * Copies the request type's static metadata and, when a `keyspace` is declared,
   * stamps a per-request key drawn from `size` distinct keys. The draw is uniform
   * by default and Zipf-distributed when `keyspace.skew > 0` (hot keys carry more
   * traffic). A small keyspace — or a skewed one — under high RPS produces the key
   * contention that reservation designs must survive and the hot-key concentration
   * that makes caches and partitions behave realistically.
   */
  private buildRequestMetadata(
    requestType: WorkloadProfile['requestDistribution'][number]
  ): Record<string, unknown> {
    const metadata: Record<string, unknown> =
      requestType.metadata && typeof requestType.metadata === 'object'
        ? { ...requestType.metadata }
        : {}

    const keyspace = requestType.keyspace
    if (keyspace && keyspace.size > 0 && keyspace.field) {
      const size = Math.floor(keyspace.size)
      const skew = keyspace.skew ?? 0
      const index = skew > 0 ? this.drawZipfIndex(size, skew) : this.rng.integer(0, size - 1)
      const key = `${keyspace.field}-${index}`
      metadata[keyspace.field] = key
      // Canonical cache/partition key so downstream nodes (e.g. a derived-LRU
      // cache) can key on the drawn entity without knowing the field name.
      metadata.__key = key
    }

    return metadata
  }

  /**
   * Draws a 0-based key rank under a Zipf(`skew`) distribution over `size` keys,
   * where rank `r` (1-based) has probability ∝ `r^(-skew)`. Index `0` is the
   * hottest key. Uses a cached normalized cumulative table + binary search, so
   * each draw is O(log size). For very large keyspaces the table is capped
   * (`MAX_ZIPF_TABLE`); the tail beyond the cap is folded into uniform selection,
   * which is a faithful approximation because a Zipf tail is already near-flat in
   * probability.
   */
  private drawZipfIndex(size: number, skew: number): number {
    const table = this.getZipfTable(size, skew)
    const u = this.rng.next()
    // Binary search for the first cumulative probability >= u.
    let lo = 0
    let hi = table.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (table[mid]! < u) {
        lo = mid + 1
      } else {
        hi = mid
      }
    }
    if (lo < table.length && size <= WorkloadGenerator.MAX_ZIPF_TABLE) {
      return lo
    }
    // Capped keyspace: `lo` landed in the folded uniform tail — spread it across
    // the ranks the table could not represent individually.
    if (lo >= table.length - 1) {
      const tailStart = table.length - 1
      return tailStart + this.rng.integer(0, size - tailStart - 1)
    }
    return lo
  }

  private getZipfTable(size: number, skew: number): Float64Array {
    const key = `${size}:${skew}`
    const cached = this.zipfTables.get(key)
    if (cached) {
      return cached
    }
    const n = Math.min(size, WorkloadGenerator.MAX_ZIPF_TABLE)
    const table = new Float64Array(n)
    let total = 0
    for (let r = 1; r <= n; r++) {
      total += Math.pow(r, -skew)
      table[r - 1] = total
    }
    // When the keyspace is capped, account for the mass of the un-tabled tail so
    // the folded uniform branch is reachable.
    if (size > n) {
      for (let r = n + 1; r <= size; r++) {
        total += Math.pow(r, -skew)
      }
    }
    for (let i = 0; i < n; i++) {
      table[i] = table[i]! / total
    }
    this.zipfTables.set(key, table)
    return table
  }

  private pickRequestDistributionEntry(): WorkloadProfile['requestDistribution'][number] {
    const entries = this.config.requestDistribution
    if (entries.length === 0) {
      throw new Error('Workload requestDistribution must contain at least one entry')
    }

    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0)
    if (totalWeight <= 0) {
      throw new Error('Workload requestDistribution total weight must be > 0')
    }

    const target = this.rng.next() * totalWeight
    let cumulative = 0

    for (const entry of entries) {
      cumulative += entry.weight
      if (target < cumulative) {
        return entry
      }
    }

    return entries[entries.length - 1]
  }

  private elapsedMs(currentTime: bigint): number {
    return Math.max(0, microToMs(currentTime - this.startTime))
  }

  private intervalForRps(rps: number): number {
    if (rps <= 0 || !Number.isFinite(rps)) {
      return Number.POSITIVE_INFINITY
    }
    return 1000 / rps
  }

  private poissonIntervalForRps(rps: number): number {
    if (rps <= 0 || !Number.isFinite(rps)) {
      return Number.POSITIVE_INFINITY
    }

    const lambdaPerMs = rps / 1000
    return this.distributions.exponential(lambdaPerMs)
  }
}
