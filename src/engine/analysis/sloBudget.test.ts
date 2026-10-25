/** Error-budget burn (chapter 16 section 4): observed error rate over the budget, usable as a rubric selector. */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, SLOConfig, TopologyJSON } from '../core/types'
import { SimulationEngine } from '../engine'
import { projectToVerdict } from './verdict'
import { resolveMetric } from './rubric'

function verdictFor(slo: SLOConfig | undefined, nodeErrorRate: number) {
  const service = {
    id: 'svc',
    type: 'microservice',
    category: 'compute',
    label: 'svc',
    position: { x: 0, y: 0 },
    queue: { workers: 50, capacity: 500, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 },
    config: { nodeErrorRate },
    ...(slo ? { slo } : {})
  } as ComponentNode
  const topology = {
    id: 't',
    name: 'slo',
    version: '1.0.0',
    global: {
      simulationDuration: 20_000,
      seed: 'slo-budget',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000,
      traceSampleRate: 0
    },
    nodes: [service],
    edges: [],
    workload: {
      sourceNodeId: 'svc',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  return projectToVerdict(new SimulationEngine(topology).run())
}

describe('error-budget burn', () => {
  it('is the error rate over the budget, derived from the availability target when no budget is set', () => {
    const verdict = verdictFor({ availabilityTarget: 0.99 }, 0.05)
    const status = verdict.sloStatus?.[0]
    expect(status?.errorBudget).toBeCloseTo(0.01, 9)
    expect(status?.burnRate).toBeGreaterThan(4)
    expect(status?.burnRate).toBeLessThan(6)
    expect(status?.withinBudget).toBe(false)
  })

  it('uses an explicit errorBudget over the availability target', () => {
    const status = verdictFor({ errorBudget: 0.5, availabilityTarget: 0.99 }, 0.05).sloStatus?.[0]
    expect(status?.errorBudget).toBe(0.5)
    expect(status?.withinBudget).toBe(true)
  })

  it('exposes the burn as rubric selectors, and fails to measure when no SLO states a budget', () => {
    const verdict = verdictFor({ availabilityTarget: 0.99 }, 0.05)
    expect(resolveMetric(verdict, 'slo.maxBurnRate')).toBeGreaterThan(4)
    expect(resolveMetric(verdict, 'slo.budgetsExceeded.count')).toBe(1)
    const none = verdictFor(undefined, 0.05)
    expect(resolveMetric(none, 'slo.maxBurnRate')).toBeNull()
  })
})
