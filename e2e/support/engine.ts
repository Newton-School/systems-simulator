/** Runs the engine in Node: the "engine truth" half of every parity check. */
import { SimulationEngine } from '../../src/engine/engine'
import type { TopologyJSON } from '../../src/engine/core/types'
import type { SimulationOutput } from '../../src/engine/analysis/output'

export function runEngine(topology: TopologyJSON): SimulationOutput {
  return new SimulationEngine(structuredClone(topology)).run()
}
