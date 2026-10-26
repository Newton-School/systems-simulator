/** `failureModes` with an MTBF and MTTR inject random failures (chapter 26 section 9, decision G1). */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, FailureMode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run(modes: FailureMode[] | undefined, seed = 'modes') {
  const service = {
    id: 'svc',
    type: 'microservice',
    category: 'compute',
    label: 'svc',
    position: { x: 0, y: 0 },
    queue: { workers: 50, capacity: 500, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 },
    ...(modes ? { failureModes: modes } : {})
  } as ComponentNode
  const topology = {
    id: 't',
    name: 'failure-modes',
    version: '1.0.0',
    global: {
      simulationDuration: 300_000,
      seed,
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
      baseRps: 50,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  return new SimulationEngine(topology).run()
}

const crash = (mtbf: number, mttr: number, severity: FailureMode['severity'] = 'critical') =>
  ({ mode: 'crash', severity, mtbf, mttr }) as FailureMode

describe('failureModes injection', () => {
  it('is down MTTR / (MTBF + MTTR) of the time', () => {
    const out = run([crash(5_000, 1_000)])
    expect(out.summary.errorRate).toBeGreaterThan(0.12)
    expect(out.summary.errorRate).toBeLessThan(0.22)
  })

  it('is reproducible for a seed and different for another', () => {
    const a = run([crash(5_000, 1_000)]).summary.errorRate
    expect(run([crash(5_000, 1_000)]).summary.errorRate).toBe(a)
    expect(run([crash(5_000, 1_000)], 'other-seed').summary.errorRate).not.toBe(a)
  })

  it('injects nothing for a mode without both an MTBF and an MTTR, or for a non-critical severity', () => {
    expect(run(undefined).summary.errorRate).toBe(0)
    expect(run([{ mode: 'crash', severity: 'critical', mtbf: 5_000 }]).summary.errorRate).toBe(0)
    expect(run([crash(5_000, 1_000, 'minor')]).summary.errorRate).toBe(0)
  })
})
