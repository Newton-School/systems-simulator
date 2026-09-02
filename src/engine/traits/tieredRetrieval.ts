import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const TIERED_RETRIEVAL_COMPONENT_TYPES = [
  'archive-storage',
  'object-storage'
] as const satisfies readonly ComponentType[]

const DEFAULT_RETRIEVAL_MS = 3000

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function addPenalty(request: { metadata: Record<string, unknown> }, ms: number): void {
  const existing =
    typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
      ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
      : 0
  request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + ms
}

/**
 * Cold-tier retrieval latency. Reading from an archive / cold object tier is not
 * a millisecond operation — it takes seconds to minutes. This makes "just
 * archive it" carry a real consequence, so a design cannot serve hot reads from
 * cold storage for free.
 */
export const tieredRetrievalTrait: NodeBehaviourTrait = {
  name: 'storage.tiered-retrieval',
  beforeArrival: ({ node, request }) => {
    const retrievalMs = asNonNegativeNumber(node.config?.['retrievalMs'])
    if (retrievalMs === null || retrievalMs === 0) {
      return { action: 'continue' }
    }
    addPenalty(request, retrievalMs)
    return {
      action: 'continue',
      payload: { coldRetrievalMs: retrievalMs, metricCounters: { coldRetrievals: 1 } }
    }
  }
}

export const tieredRetrievalCapabilityModule: NodeCapabilityModule = {
  name: 'storage.tiered-retrieval',
  appliesTo: TIERED_RETRIEVAL_COMPONENT_TYPES,
  hooks: tieredRetrievalTrait,
  config: {
    sections: [
      {
        id: 'tiered-retrieval',
        title: 'Cold-Tier Retrieval',
        note: 'Adds cold-storage retrieval latency (seconds to minutes). Set it for an archive tier so a design cannot serve latency-sensitive reads from cold storage.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.retrievalMs',
            type: 'input',
            inputType: 'number',
            label: 'Retrieval latency',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_RETRIEVAL_MS}ms`,
            why: 'Time to restore an object from the cold/archive tier before it can be served.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['coldRetrievals'] },
  honesty: {
    simulates: ['a per-request cold-tier retrieval latency penalty'],
    notModeled: ['tier transitions, restore batching, or minimum-retention billing']
  }
}
