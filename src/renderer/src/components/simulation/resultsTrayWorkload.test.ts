import { describe, expect, it } from 'vitest'
import { simulatedArrivalBins } from './resultsTrayWorkload'

describe('results tray workload bins', () => {
  it('renders constant workloads as a flat pattern in steady state', () => {
    const workload = {
      sourceNodeId: 'client',
      pattern: 'constant' as const,
      baseRps: 180,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }

    const bins = simulatedArrivalBins(workload, 3_300_000, 4_000, 24)

    expect(bins).toHaveLength(24)
    expect(bins.every((value) => value === bins[0])).toBe(true)
    expect(bins[0]).toBe(1)
  })
})
