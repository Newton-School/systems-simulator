/**
 * Derives the read-only throughput capacity (req/s) a compute node can serve, for
 * display in the properties panel. Capacity is a *consequence* of the chosen
 * hardware and service time — `concurrency ÷ service time` — never a value the
 * student types. Showing it makes the instance/workload-kind choices legible
 * ("m5.xlarge · IO-bound · 1.3 ms → ~98,000 req/s") without turning capacity into
 * a gameable dial.
 */

import type { ComponentNode, ComponentType } from '../../../engine/core/types'
import { distributionMean } from '../../../engine/analysis/fluidModel'
import { deriveNodeConcurrency } from '../../../engine/nodes/resourceDerivation'

export interface DisplayThroughputCapacity {
  /** Requests per second this node can serve at full utilization. */
  capacityRps: number
  /** Effective concurrent servers (c) derived from the instance. */
  concurrency: number
  /** Mean service time (ms) per request. */
  serviceTimeMs: number
  /** Human-readable derivation, e.g. "128 workers ÷ 1.30 ms". */
  provenance: string
}

/**
 * Returns the derived capacity, or `null` when the node has no service model
 * (e.g. a passthrough load balancer or a node with no processing time), where a
 * throughput ceiling is not meaningful.
 */
export function deriveDisplayThroughputCapacity(
  componentType: ComponentType | undefined,
  sim: unknown
): DisplayThroughputCapacity | null {
  if (!componentType) return null
  const s = (sim ?? {}) as {
    resources?: ComponentNode['resources']
    queue?: ComponentNode['queue']
    processing?: ComponentNode['processing']
  }

  const serviceTimeMs = distributionMean(s.processing?.distribution)
  if (!Number.isFinite(serviceTimeMs) || serviceTimeMs <= 0) return null

  const node = {
    id: '',
    type: componentType,
    category: 'compute',
    label: '',
    position: { x: 0, y: 0 },
    resources: s.resources,
    queue: s.queue
  } as unknown as ComponentNode

  const { effectiveC } = deriveNodeConcurrency(node)
  const capacityRps = effectiveC / (serviceTimeMs / 1000)

  return {
    capacityRps,
    concurrency: effectiveC,
    serviceTimeMs,
    provenance: `${effectiveC.toLocaleString()} workers ÷ ${serviceTimeMs.toFixed(2)} ms`
  }
}

/** Compact req/s formatter: 98123 → "98.1K", 1_280_000 → "1.28M". */
export function formatCapacityRps(rps: number): string {
  if (rps >= 1_000_000) return `${(rps / 1_000_000).toFixed(2)}M`
  if (rps >= 1_000) return `${(rps / 1_000).toFixed(1)}K`
  return `${Math.round(rps)}`
}
