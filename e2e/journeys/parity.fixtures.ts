import type { TopologyJSON } from '../../src/engine/core/types'
import { singleServer } from '../support/topology'

/** One worker authored as a raw queue, no instance model: M/D/1 at rho 0.8 (10 ms, 80 req/s). */
export function md1(): TopologyJSON {
  return singleServer(
    { name: 'md1', rps: 80, pattern: 'poisson', durationMs: 60_000, warmupMs: 5000, seed: 'md1' },
    { serviceMs: 10 }
  )
}
