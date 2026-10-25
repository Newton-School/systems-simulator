/**
 * The metastable-failure sample (chapter 22 section 2): a 3 s spike, retries as the sustaining loop. The
 * system stays failed after the trigger ends; the same system without retries recovers within seconds.
 */
import { describe, expect, it } from 'vitest'
import sample from './__samples__/topology/metastable-retry-storm.json'
import type { TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'
import { validateTopology } from './validation/validator'

function errorRateBetween(topology: TopologyJSON, fromMs: number, toMs: number): number {
  const windows = new SimulationEngine(topology)
    .run()
    .summary.latencyWindows.filter((w) => w.windowStartMs >= fromMs && w.windowStartMs < toMs)
  const total = windows.reduce((sum, w) => sum + w.successCount + w.errorCount, 0)
  return windows.reduce((sum, w) => sum + w.errorCount, 0) / total
}

describe('metastable retry-storm sample', () => {
  const withRetries = structuredClone(sample) as unknown as TopologyJSON
  const withoutRetries = structuredClone(sample) as unknown as TopologyJSON
  withoutRetries.nodes.find((n) => n.id === 'gw')!.resilience = undefined

  it('is a valid document', () => {
    expect(validateTopology(structuredClone(withRetries)).valid).toBe(true)
  })

  it('stays failed long after the spike when the gateway retries', () => {
    expect(errorRateBetween(withRetries, 5_000, 10_000)).toBe(0) // healthy before the trigger
    expect(errorRateBetween(withRetries, 30_000, 90_000)).toBeGreaterThan(0.9)
  })

  it('recovers within seconds of the spike when it does not retry', () => {
    expect(errorRateBetween(withoutRetries, 20_000, 90_000)).toBe(0)
  })
})
