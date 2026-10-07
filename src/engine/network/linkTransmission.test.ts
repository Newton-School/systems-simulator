import { describe, expect, it } from 'vitest'
import { LinkSerializer, transmissionTimeMs } from './linkTransmission'

describe('transmissionTimeMs', () => {
  it('converts bytes over Mbps to ms (1 Mbps = 125 bytes/ms)', () => {
    expect(transmissionTimeMs(125_000, 10)).toBeCloseTo(100)
    expect(transmissionTimeMs(1024, 1000)).toBeCloseTo(0.008192)
  })

  it('is proportional to payload size', () => {
    expect(transmissionTimeMs(2_000_000, 100)).toBeCloseTo(transmissionTimeMs(1_000_000, 100) * 2)
  })

  it('treats a missing or non-positive bandwidth as an unlimited link', () => {
    expect(transmissionTimeMs(1_000_000, 0)).toBe(0)
    expect(transmissionTimeMs(1_000_000, Number.NaN)).toBe(0)
    expect(transmissionTimeMs(1_000_000, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('LinkSerializer', () => {
  it('serializes overlapping transfers FIFO', () => {
    const link = new LinkSerializer()
    expect(link.reserve('e', 0, 100).queueWaitUs).toBe(0)
    // Arrives while the first is still on the wire: waits for the remaining 90 µs.
    expect(link.reserve('e', 10, 100).queueWaitUs).toBe(90)
    // Third queues behind both.
    expect(link.reserve('e', 20, 100).queueWaitUs).toBe(180)
    expect(link.freeAtUs('e')).toBe(300)
  })

  it('does not wait once the link has drained, and keeps edges independent', () => {
    const link = new LinkSerializer()
    link.reserve('a', 0, 100)
    expect(link.reserve('a', 500, 100).queueWaitUs).toBe(0)
    expect(link.reserve('b', 0, 100).queueWaitUs).toBe(0)
  })

  it('never waits on a zero-length (effectively unlimited) transfer', () => {
    const link = new LinkSerializer()
    link.reserve('e', 0, 100)
    expect(link.reserve('e', 10, 0).queueWaitUs).toBe(0)
    expect(link.freeAtUs('e')).toBe(100)
  })

  it('caps sustained throughput at the link rate', () => {
    const link = new LinkSerializer()
    // 1000 back-to-back offers at t=0, each 1 ms on the wire: the last starts at 999 ms.
    let lastStart = 0
    for (let i = 0; i < 1000; i++) lastStart = link.reserve('e', 0, 1000).startUs
    expect(lastStart).toBe(999_000)
  })
})
