import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const BATCHING_COMPONENT_TYPES = [
  'batch-worker',
  'gpu-node'
] as const satisfies readonly ComponentType[]

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_BATCH_WINDOW_MS = 50
const DEFAULT_FIXED_COST_MS = 20

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

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
 * Batching amortization. Throughput systems (batch workers, GPU inference) pay a
 * fixed cost *per batch*, so processing N items together makes the per-item cost
 * `fixedCost / N` instead of `fixedCost`. The tradeoff: each item first waits up
 * to `batchWindowMs` for the batch to form. This trait models both halves — the
 * formation wait (latency added) and the amortized fixed cost (cheaper per item,
 * so higher throughput) — which is exactly the batching lesson.
 */
export const batchingTrait: NodeBehaviourTrait = {
  name: 'compute.batching',
  beforeArrival: ({ node, request }) => {
    const batchSize = asPositiveNumber(node.config?.['batchSize'])
    if (batchSize === null || batchSize <= 1) {
      return { action: 'continue' }
    }
    const batchWindowMs =
      asNonNegativeNumber(node.config?.['batchWindowMs']) ?? DEFAULT_BATCH_WINDOW_MS
    const fixedCostMs = asNonNegativeNumber(node.config?.['fixedCostMs']) ?? DEFAULT_FIXED_COST_MS

    // Average wait for a uniformly-arriving item is half the formation window.
    const formationWaitMs = batchWindowMs / 2
    const amortizedFixedMs = fixedCostMs / batchSize
    const penaltyMs = formationWaitMs + amortizedFixedMs
    addPenalty(request, penaltyMs)
    return {
      action: 'continue',
      payload: {
        batchSize,
        batchFormationWaitMs: formationWaitMs,
        amortizedFixedMs,
        metricCounters: { itemsBatched: 1 }
      }
    }
  }
}

export const batchingCapabilityModule: NodeCapabilityModule = {
  name: 'compute.batching',
  appliesTo: BATCHING_COMPONENT_TYPES,
  hooks: batchingTrait,
  config: {
    sections: [
      {
        id: 'batching',
        title: 'Batching',
        note: 'Processes items in batches: each item waits up to the window for a batch to form, then the fixed per-batch cost is amortized across the batch. Trades latency for throughput.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.batchSize',
            type: 'input',
            inputType: 'number',
            label: 'Batch size',
            unit: 'items',
            min: 1,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_BATCH_SIZE}`,
            why: 'Items processed together; the fixed cost is divided by this.'
          },
          {
            path: 'sim.batchWindowMs',
            type: 'input',
            inputType: 'number',
            label: 'Batch window',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_BATCH_WINDOW_MS}ms`,
            why: 'Max time an item waits for its batch to fill (adds formation latency).'
          },
          {
            path: 'sim.fixedCostMs',
            type: 'input',
            inputType: 'number',
            label: 'Fixed per-batch cost',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_FIXED_COST_MS}ms`,
            why: 'Overhead paid once per batch (model load, setup); amortized across batch size.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['itemsBatched'] },
  honesty: {
    simulates: [
      'the batching tradeoff: a formation-wait latency plus an amortized (fixedCost ÷ batchSize) per-item cost'
    ],
    notModeled: [
      'partial batches under low load, dynamic batch sizing, or true queue-coupled batch release timing'
    ]
  }
}
