import { describe, expect, it } from 'vitest'
import type { EdgeFlowRunConfig } from '@renderer/store/useStore'
import { patternPhaseLabel } from './edgeFlowPatterns'

const PLAYBACK = { wallStartMs: 0, simStartMs: 0 }

function runConfig(pattern: EdgeFlowRunConfig['workload']['pattern']): EdgeFlowRunConfig {
  return {
    simulationDurationMs: 60_000,
    warmupDurationMs: 0,
    workload: {
      sourceNodeId: 'client',
      pattern,
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

describe('patternPhaseLabel', () => {
  it('labels poisson traffic as arrivals, not jitter', () => {
    const label = patternPhaseLabel(runConfig('poisson'), PLAYBACK, 1_000, () => 1)

    expect(label).toBe('poisson arrivals')
  })

  it('keeps burst workloads labeled by phase', () => {
    const label = patternPhaseLabel(
      {
        ...runConfig('bursty'),
        workload: {
          ...runConfig('bursty').workload,
          bursty: { burstRps: 300, burstDuration: 2_000, normalDuration: 8_000 }
        }
      },
      PLAYBACK,
      250,
      () => 1
    )

    expect(label).toBe('burst')
  })
})
