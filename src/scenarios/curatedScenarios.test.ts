import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine/engine'
import { validateTopology } from '../engine/validation/validator'
import { CURATED_SCENARIOS } from './curatedScenarios'

describe('CURATED_SCENARIOS', () => {
  it.each(CURATED_SCENARIOS)('validates and runs %s', (scenario) => {
    const validation = validateTopology(scenario.topology)
    expect(validation.valid).toBe(true)

    const topology = validation.data ?? scenario.topology
    const output = new SimulationEngine(topology).run()

    expect(output.summary.totalRequests).toBeGreaterThan(0)

    switch (scenario.id) {
      case 'serverless-cold-start':
        expect(output.perNode.lambda?.traitCounters.coldStarts ?? 0).toBeGreaterThan(0)
        break
      case 'key-based-sharding':
        expect(output.perNode.router?.traitCounters.keyRoutedRequests ?? 0).toBeGreaterThan(0)
        break
      case 'stream-consumer-lag':
        expect(output.perNode.stream?.traitCounters.consumerLagSamples ?? 0).toBeGreaterThan(0)
        expect(output.perNode.stream?.finalInSystem ?? 0).toBeGreaterThan(0)
        break
      case 'dns-weighted-routing':
        expect(output.perNode.dns?.traitCounters.dnsCacheHits ?? 0).toBeGreaterThan(0)
        expect(output.perNode.stable?.postWarmupArrived ?? 0).toBeGreaterThan(
          output.perNode.canary?.postWarmupArrived ?? 0
        )
        break
      case 'circuit-breaker-fail-fast':
        expect(output.eventCountsByType['circuit-breaker-open']).toBeGreaterThan(0)
        expect(output.perNode.sidecar?.rejectionsByReason.circuit_breaker_open ?? 0).toBeGreaterThan(0)
        break
      default:
        throw new Error(`Unhandled curated scenario '${scenario.id}'.`)
    }
  })
})
