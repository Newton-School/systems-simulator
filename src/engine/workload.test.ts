import { describe, expect, it } from 'vitest'
import { SimulationEvent, type Request } from './core/events'
import { msToMicro } from './core/time'
import { EventScheduler, WorkloadProfile } from './core/types'
import { createRandom } from './stochastic/random'
import { WorkloadGenerator } from './workload'

function makeWorkload(overrides: Partial<WorkloadProfile> = {}): WorkloadProfile {
  return {
    sourceNodeId: 'source-1',
    pattern: 'constant',
    baseRps: 100,
    requestDistribution: [
      { type: 'GET', weight: 0.7, sizeBytes: 200 },
      { type: 'POST', weight: 0.2, sizeBytes: 1500 },
      { type: 'PUT', weight: 0.1, sizeBytes: 800 }
    ],
    ...overrides
  }
}

function makeHourlyMultipliers(
  defaultValue = 1
): NonNullable<WorkloadProfile['diurnal']>['hourlyMultipliers'] {
  return Array.from({ length: 24 }, () => defaultValue) as NonNullable<
    WorkloadProfile['diurnal']
  >['hourlyMultipliers']
}

function makeScheduler(): EventScheduler & {
  events: SimulationEvent[]
  popNext: () => SimulationEvent | undefined
  clear: () => void
} {
  const events: SimulationEvent[] = []

  const compare = (a: SimulationEvent, b: SimulationEvent): number => {
    if (a.timestamp < b.timestamp) return -1
    if (a.timestamp > b.timestamp) return 1
    if (a.priority < b.priority) return -1
    if (a.priority > b.priority) return 1
    return 0
  }

  return {
    events,
    schedule(event: SimulationEvent) {
      events.push(event)
    },
    popNext() {
      if (events.length === 0) return undefined
      events.sort(compare)
      return events.shift()
    },
    clear() {
      events.length = 0
    }
  }
}

function mean(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0) / values.length
}

function stdDev(values: number[]): number {
  const avg = mean(values)
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function intervalScheduledByGenerate(
  generator: WorkloadGenerator,
  scheduler: ReturnType<typeof makeScheduler>,
  currentMs: number
): number {
  scheduler.clear()
  const now = msToMicro(currentMs)
  generator.generateNext(now)
  const next = scheduler.popNext()
  if (!next) {
    throw new Error('Expected a next request-generated event to be scheduled')
  }
  return Number(next.timestamp - now) / 1000
}

function collectSequence(seed: string, count = 200): Request[] {
  const scheduler = makeScheduler()
  const generator = new WorkloadGenerator(
    makeWorkload({ pattern: 'poisson' }),
    createRandom(seed),
    scheduler,
    { defaultTimeoutMs: 5000 }
  )

  generator.initialize(0n)
  let current = scheduler.popNext()
  if (!current) {
    throw new Error('Expected initialize() to schedule the first event')
  }

  const requests: Request[] = []

  for (let i = 0; i < count; i++) {
    const request = generator.generateNext(current.timestamp)
    requests.push(request)
    const next = scheduler.popNext()
    if (!next) break
    current = next
  }

  return requests
}

describe('WorkloadGenerator', () => {
  it('selects weighted traffic origins deterministically and stamps each request', () => {
    const sequence = collectSequence('weighted-origins', 1000)
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload({
        origins: [
          {
            id: 'us',
            label: 'US users',
            weight: 0.75,
            location: { kind: 'coordinates', latitude: 38.9, longitude: -77 }
          },
          {
            id: 'in',
            label: 'India users',
            weight: 0.25,
            location: { kind: 'coordinates', latitude: 19, longitude: 72.8 }
          }
        ]
      }),
      createRandom('weighted-origins'),
      scheduler,
      { defaultTimeoutMs: 5000 }
    )
    generator.initialize(0n)
    let event = scheduler.popNext()!
    const ids: string[] = []
    for (let index = 0; index < sequence.length; index++) {
      ids.push(generator.generateNext(event.timestamp).origin?.originId ?? '')
      event = scheduler.popNext()!
    }

    expect(ids.filter((id) => id === 'us').length).toBeGreaterThan(700)
    expect(ids.filter((id) => id === 'us').length).toBeLessThan(800)
    expect(ids).toEqual(
      (() => {
        const replayScheduler = makeScheduler()
        const replay = new WorkloadGenerator(
          makeWorkload({
            origins: [
              {
                id: 'us',
                label: 'US users',
                weight: 0.75,
                location: { kind: 'coordinates', latitude: 38.9, longitude: -77 }
              },
              {
                id: 'in',
                label: 'India users',
                weight: 0.25,
                location: { kind: 'coordinates', latitude: 19, longitude: 72.8 }
              }
            ]
          }),
          createRandom('weighted-origins'),
          replayScheduler,
          { defaultTimeoutMs: 5000 }
        )
        replay.initialize(0n)
        let next = replayScheduler.popNext()!
        return Array.from({ length: ids.length }, () => {
          const id = replay.generateNext(next.timestamp).origin?.originId ?? ''
          next = replayScheduler.popNext()!
          return id
        })
      })()
    )
  })

  it('constant pattern at 100 RPS generates 100 requests in 1 simulated second', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload(),
      createRandom('constant-rate'),
      scheduler,
      {
        defaultTimeoutMs: 5000,
        simulationDurationMs: 1000
      }
    )

    generator.initialize(0n)

    let count = 0
    let event = scheduler.popNext()
    while (event) {
      count++
      generator.generateNext(event.timestamp)
      event = scheduler.popNext()
    }

    expect(count).toBe(100)
  })

  it('poisson pattern produces exponential inter-arrival times over 10,000 samples', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload({ pattern: 'poisson', baseRps: 100 }),
      createRandom('poisson-seed'),
      scheduler,
      { defaultTimeoutMs: 5000 }
    )

    generator.initialize(0n)

    let current = scheduler.popNext()
    expect(current).toBeDefined()

    const samples: number[] = []
    for (let i = 0; i < 10_000; i++) {
      generator.generateNext(current!.timestamp)
      const next = scheduler.popNext()
      expect(next).toBeDefined()
      samples.push(Number(next!.timestamp - current!.timestamp) / 1000)
      current = next
    }

    const avg = mean(samples)
    const cv = stdDev(samples) / avg

    expect(avg).toBeGreaterThan(9)
    expect(avg).toBeLessThan(11)
    expect(cv).toBeGreaterThan(0.9)
    expect(cv).toBeLessThan(1.1)
  })

  it('spike pattern jumps to spikeRps inside spike window and returns to base rate', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload({
        pattern: 'spike',
        baseRps: 100,
        spike: { spikeTime: 100, spikeRps: 500, spikeDuration: 100 }
      }),
      createRandom('spike-seed'),
      scheduler,
      { defaultTimeoutMs: 5000, simulationDurationMs: 1000 }
    )

    generator.initialize(0n)

    expect(intervalScheduledByGenerate(generator, scheduler, 50)).toBeCloseTo(10, 3)
    expect(intervalScheduledByGenerate(generator, scheduler, 120)).toBeCloseTo(2, 3)
    expect(intervalScheduledByGenerate(generator, scheduler, 250)).toBeCloseTo(10, 3)
  })

  it('diurnal pattern scales rate according to hourly multipliers', () => {
    const scheduler = makeScheduler()
    const multipliers = makeHourlyMultipliers(1)
    multipliers[0] = 0.5
    multipliers[12] = 2

    const generator = new WorkloadGenerator(
      makeWorkload({
        pattern: 'diurnal',
        baseRps: 100,
        diurnal: {
          peakMultiplier: 3,
          hourlyMultipliers: multipliers
        }
      }),
      createRandom('diurnal-seed'),
      scheduler,
      { defaultTimeoutMs: 5000, simulationDurationMs: 24_000 }
    )

    generator.initialize(0n)

    // simulationDurationMs=24_000 compresses each "hour" to 1_000ms.
    expect(intervalScheduledByGenerate(generator, scheduler, 0)).toBeCloseTo(20, 3)
    expect(intervalScheduledByGenerate(generator, scheduler, 12_000)).toBeCloseTo(5, 3)
  })

  it('bursty pattern alternates between burst and normal rates', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload({
        pattern: 'bursty',
        baseRps: 100,
        bursty: { burstRps: 400, burstDuration: 50, normalDuration: 100 }
      }),
      createRandom('bursty-seed'),
      scheduler,
      { defaultTimeoutMs: 5000, simulationDurationMs: 1000 }
    )

    generator.initialize(0n)

    expect(intervalScheduledByGenerate(generator, scheduler, 25)).toBeCloseTo(2.5, 3) // burst
    expect(intervalScheduledByGenerate(generator, scheduler, 80)).toBeCloseTo(10, 3) // normal
    expect(intervalScheduledByGenerate(generator, scheduler, 175)).toBeCloseTo(2.5, 3) // next burst
  })

  it('sawtooth pattern linearly ramps and then drops back to base', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload({
        pattern: 'sawtooth',
        baseRps: 100,
        sawtooth: { peakRps: 300, rampDuration: 100 }
      }),
      createRandom('sawtooth-seed'),
      scheduler,
      { defaultTimeoutMs: 5000, simulationDurationMs: 1000 }
    )

    generator.initialize(0n)

    expect(intervalScheduledByGenerate(generator, scheduler, 0)).toBeCloseTo(10, 3)
    expect(intervalScheduledByGenerate(generator, scheduler, 50)).toBeCloseTo(5, 3)
    expect(intervalScheduledByGenerate(generator, scheduler, 99)).toBeCloseTo(3.356, 3)
    expect(intervalScheduledByGenerate(generator, scheduler, 100)).toBeCloseTo(10, 3) // drop/reset
  })

  it('request type distribution matches configured weights within 5% over 10,000 requests', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload(),
      createRandom('weight-seed'),
      scheduler,
      {
        defaultTimeoutMs: 5000
      }
    )

    generator.initialize(0n)
    scheduler.clear()

    const counts = { GET: 0, POST: 0, PUT: 0 }
    const sizeByType = { GET: 200, POST: 1500, PUT: 800 }

    for (let i = 0; i < 10_000; i++) {
      const request = generator.generateNext(BigInt(i) * 1000n)
      scheduler.clear()

      counts[request.type as keyof typeof counts]++
      expect(request.sizeBytes).toBe(sizeByType[request.type as keyof typeof sizeByType])
    }

    expect(counts.GET / 10_000).toBeGreaterThan(0.65)
    expect(counts.GET / 10_000).toBeLessThan(0.75)
    expect(counts.POST / 10_000).toBeGreaterThan(0.15)
    expect(counts.POST / 10_000).toBeLessThan(0.25)
    expect(counts.PUT / 10_000).toBeGreaterThan(0.05)
    expect(counts.PUT / 10_000).toBeLessThan(0.15)
  })

  it('requests have unique incrementing IDs and correct deadline', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(makeWorkload(), createRandom('id-seed'), scheduler, {
      defaultTimeoutMs: 1234
    })

    generator.initialize(0n)
    scheduler.clear()

    const r1 = generator.generateNext(1_000n)
    const r2 = generator.generateNext(2_000n)
    const r3 = generator.generateNext(3_000n)

    expect(r1.id).toBe('req-000001')
    expect(r2.id).toBe('req-000002')
    expect(r3.id).toBe('req-000003')
    expect(r1.priority === 0 || r1.priority === 1).toBe(true)
    expect(r1.deadline).toBe(1_000n + msToMicro(1234))
    expect(r2.deadline).toBe(2_000n + msToMicro(1234))
    expect(r1.path).toEqual([])
    expect(r1.spans).toEqual([])
  })

  it('is deterministic: same seed produces the same request sequence', () => {
    const sequenceA = collectSequence('deterministic-seed', 250)
    const sequenceB = collectSequence('deterministic-seed', 250)
    const sequenceC = collectSequence('different-seed', 250)

    expect(sequenceA).toEqual(sequenceB)
    expect(sequenceA).not.toEqual(sequenceC)
  })

  it('stamps authored request metadata (headers) onto generated requests', () => {
    const scheduler = makeScheduler()
    const generator = new WorkloadGenerator(
      makeWorkload({
        pattern: 'constant',
        requestDistribution: [
          {
            type: 'GET',
            weight: 1,
            sizeBytes: 100,
            metadata: { path: '/v2/orders', headers: { 'X-Api-Version': '2' } }
          }
        ]
      }),
      createRandom('headers-seed'),
      scheduler,
      { defaultTimeoutMs: 5000 }
    )
    generator.initialize(0n)
    const current = scheduler.popNext()!
    const request = generator.generateNext(current.timestamp)
    expect(request.metadata.path).toBe('/v2/orders')
    expect(request.metadata.headers).toEqual({ 'X-Api-Version': '2' })
  })

  describe('keyspace key selection', () => {
    const KEY_FIELD = 'seatId'

    function collectKeyIndices(
      seed: string,
      keyspace: { field: string; size: number; skew?: number },
      count = 4000
    ): number[] {
      const scheduler = makeScheduler()
      const generator = new WorkloadGenerator(
        makeWorkload({
          pattern: 'constant',
          requestDistribution: [{ type: 'book', weight: 1, sizeBytes: 100, keyspace }]
        }),
        createRandom(seed),
        scheduler,
        { defaultTimeoutMs: 5000 }
      )
      generator.initialize(0n)
      let current = scheduler.popNext()!
      const indices: number[] = []
      for (let i = 0; i < count; i++) {
        const request = generator.generateNext(current.timestamp)
        const value = request.metadata?.[KEY_FIELD] as string
        indices.push(Number(value.slice(`${KEY_FIELD}-`.length)))
        const next = scheduler.popNext()
        if (!next) break
        current = next
      }
      return indices
    }

    it('draws uniformly across the keyspace when skew is omitted', () => {
      const indices = collectKeyIndices('uniform-seed', { field: KEY_FIELD, size: 10 })
      const counts = new Array(10).fill(0)
      for (const index of indices) counts[index]++
      // Every key should be hit, and no key should dominate (uniform ⇒ ~10% each).
      expect(counts.every((c) => c > 0)).toBe(true)
      expect(Math.max(...counts) / indices.length).toBeLessThan(0.2)
    })

    it('concentrates traffic on hot keys under Zipf skew', () => {
      const size = 100
      const uniform = collectKeyIndices('skew-seed', { field: KEY_FIELD, size })
      const skewed = collectKeyIndices('skew-seed', { field: KEY_FIELD, size, skew: 1 })

      const topDecile = (indices: number[]): number =>
        indices.filter((i) => i < size / 10).length / indices.length

      // Uniform: the hottest 10% of keys carry ~10% of traffic.
      expect(topDecile(uniform)).toBeCloseTo(0.1, 1)
      // Zipf(s=1) over N=100: the top decile carries H_10/H_100 ≈ 0.565 of
      // traffic — far above uniform's 0.1, the curve that makes small caches win.
      expect(topDecile(skewed)).toBeGreaterThan(0.5)
      // Index 0 is the single hottest key and beats a uniform share handily.
      const zeroShare = skewed.filter((i) => i === 0).length / skewed.length
      expect(zeroShare).toBeGreaterThan(0.15)
    })

    it('keeps every drawn key inside the keyspace bounds', () => {
      const size = 50
      const indices = collectKeyIndices('bounds-seed', { field: KEY_FIELD, size, skew: 0.8 })
      expect(indices.every((i) => i >= 0 && i < size)).toBe(true)
    })

    it('is deterministic under a fixed seed with skew', () => {
      const ks = { field: KEY_FIELD, size: 30, skew: 1.2 }
      expect(collectKeyIndices('zipf-det', ks, 300)).toEqual(collectKeyIndices('zipf-det', ks, 300))
    })
  })
})
