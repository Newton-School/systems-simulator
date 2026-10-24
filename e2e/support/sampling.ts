import { createRandom } from '../../src/engine/stochastic/random'
import { Distributions } from '../../src/engine/stochastic/distribution'
import type { DistributionConfig } from '../../src/engine/core/types'

/** Draw n samples from a distribution config with a seeded generator, the way a node does. */
export function sample(config: DistributionConfig, n: number, seed: string): number[] {
  const d = new Distributions(createRandom(seed))
  const out = new Array<number>(n)
  for (let i = 0; i < n; i += 1) out[i] = d.fromConfig(config)
  return out
}
