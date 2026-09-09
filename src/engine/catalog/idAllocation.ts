import type { DistributionConfig } from '../core/types'

/**
 * ID / sequence generator allocation model (spec: id-sequence-generator-node.md).
 *
 * An ID generator's defining design decision is *how* it allocates identifiers, and it
 * has a real, simulated consequence on service time:
 *
 * - **block** (pre-allocated ranges): a server grabs a block of `blockSize` IDs in one
 *   coordination round-trip, then serves the next `blockSize - 1` requests from memory
 *   for free. Modeled as a mixture: `(blockSize-1)/blockSize` of requests are ~instant
 *   local serves, `1/blockSize` pay the coordination cost. Mean cost ≈ `coordMs/blockSize`
 *   → the allocator is off the hot path and never a bottleneck.
 * - **central** (counter per request): every request pays the full coordination cost, so
 *   the node's throughput ceiling is `concurrency / coordMs` — it saturates and its p99
 *   spikes under a write burst.
 *
 * This is honest: it uses only the service-time distribution (the engine's mixture
 * primitive), so the G/G/c/K model does the rest. Contention emerges from the higher
 * per-request cost, not a special primitive.
 */

/** In-memory increment cost for a local (already-allocated) ID. */
export const ID_LOCAL_SERVE_MS = 0.05
/** One coordination round-trip to fetch a fresh block / bump the central counter. */
export const ID_COORDINATION_MS = 2

export type IdGeneratorKind = 'db-sequence' | 'zookeeper' | 'snowflake' | 'range-allocator'

export interface IdAllocationConfig {
  kind: IdGeneratorKind
  mode: 'block' | 'central'
  blockSize: number
}

/** True when the kind generates IDs locally with no central coordination (Snowflake). */
export function isDecentralizedKind(kind: IdGeneratorKind): boolean {
  return kind === 'snowflake'
}

/**
 * Derives the service-time distribution for an ID generator from its allocation config.
 * - `snowflake` → local generation, no coordination ever → a flat local cost.
 * - `central` (or `blockSize <= 1`) → a flat coordination cost on every request.
 * - `block` → a two-point mixture of local serves and occasional coordination hits.
 */
export function deriveIdAllocationDistribution(config: IdAllocationConfig): DistributionConfig {
  if (isDecentralizedKind(config.kind)) {
    return { type: 'constant', value: ID_LOCAL_SERVE_MS }
  }
  const blockSize = Math.max(1, Math.round(config.blockSize))
  if (config.mode === 'central' || blockSize <= 1) {
    return { type: 'constant', value: ID_COORDINATION_MS }
  }
  const localWeight = (blockSize - 1) / blockSize
  const coordWeight = 1 / blockSize
  return {
    type: 'mixture',
    components: [
      { weight: localWeight, distribution: { type: 'constant', value: ID_LOCAL_SERVE_MS } },
      { weight: coordWeight, distribution: { type: 'constant', value: ID_COORDINATION_MS } }
    ]
  }
}

/** Mean per-request service time (ms) implied by the allocation config — for UI hints. */
export function idAllocationMeanMs(config: IdAllocationConfig): number {
  if (isDecentralizedKind(config.kind)) return ID_LOCAL_SERVE_MS
  const blockSize = Math.max(1, Math.round(config.blockSize))
  if (config.mode === 'central' || blockSize <= 1) return ID_COORDINATION_MS
  return ((blockSize - 1) / blockSize) * ID_LOCAL_SERVE_MS + (1 / blockSize) * ID_COORDINATION_MS
}
