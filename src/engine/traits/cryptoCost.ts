import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const CRYPTO_COST_COMPONENT_TYPES = [
  'kms-storage'
] as const satisfies readonly ComponentType[]

const DEFAULT_CRYPTO_MS = 5

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
 * Cryptographic operation cost. Encrypt / decrypt / sign / verify are CPU-heavy
 * and, on a KMS, quota-limited. This makes a key-management service a real
 * per-request cost on the path instead of a free box, so putting a KMS call in
 * a hot loop visibly hurts latency.
 */
export const cryptoCostTrait: NodeBehaviourTrait = {
  name: 'security.crypto-cost',
  beforeArrival: ({ node, request }) => {
    const cryptoMs = asNonNegativeNumber(node.config?.['cryptoMs'])
    if (cryptoMs === null || cryptoMs === 0) {
      return { action: 'continue' }
    }
    addPenalty(request, cryptoMs)
    return {
      action: 'continue',
      payload: { cryptoMs, metricCounters: { cryptoOps: 1 } }
    }
  }
}

export const cryptoCostCapabilityModule: NodeCapabilityModule = {
  name: 'security.crypto-cost',
  appliesTo: CRYPTO_COST_COMPONENT_TYPES,
  hooks: cryptoCostTrait,
  config: {
    sections: [
      {
        id: 'crypto-cost',
        title: 'Crypto Cost',
        note: 'Adds the CPU cost of an encrypt/verify/sign operation per request. Makes a KMS on the hot path a measurable bottleneck rather than a free hop.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.cryptoMs',
            type: 'input',
            inputType: 'number',
            label: 'Crypto latency',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_CRYPTO_MS}ms`,
            why: 'Per-request cost of the cryptographic operation (encrypt/decrypt/sign/verify).'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['cryptoOps'] },
  honesty: {
    simulates: ['a per-request cryptographic operation latency penalty'],
    notModeled: ['key-op quota limits, HSM throughput ceilings, or algorithm-specific cost curves']
  }
}
