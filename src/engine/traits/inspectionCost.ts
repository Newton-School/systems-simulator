import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { BeforeArrivalDecision, NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const INSPECTION_COST_COMPONENT_TYPES = [
  'network-policy',
  'policy-engine'
] as const satisfies readonly ComponentType[]

const DEFAULT_INSPECTION_MS = 2

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function asRate(value: unknown): number {
  const n = asNonNegativeNumber(value)
  return n === null ? 0 : Math.min(1, n)
}

function addPenalty(request: { metadata: Record<string, unknown> }, ms: number): void {
  const existing =
    typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
      ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
      : 0
  request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + ms
}

/**
 * Security-inspection cost. A WAF / network policy / policy engine scans each
 * request (a latency cost) and blocks a fraction of them (`blockRate`). This
 * makes a security-scanning hop a real cost — it adds latency and can drop
 * traffic — instead of being a free box on the diagram.
 */
export const inspectionCostTrait: NodeBehaviourTrait = {
  name: 'security.inspection-cost',
  beforeArrival: ({ node, request, random }): BeforeArrivalDecision => {
    const inspectionMs = asNonNegativeNumber(node.config?.['inspectionMs'])
    const blockRate = asRate(node.config?.['blockRate'])

    if (blockRate > 0 && random && random() < blockRate) {
      return {
        action: 'rejected',
        reason: 'inspection_blocked',
        payload: { inspectionDecision: 'blocked', metricCounters: { inspectionsBlocked: 1 } }
      }
    }

    if (inspectionMs !== null && inspectionMs > 0) {
      addPenalty(request, inspectionMs)
    }
    return {
      action: 'continue',
      payload: { inspectionDecision: 'passed', metricCounters: { inspectionsPassed: 1 } }
    }
  }
}

export const inspectionCostCapabilityModule: NodeCapabilityModule = {
  name: 'security.inspection-cost',
  appliesTo: INSPECTION_COST_COMPONENT_TYPES,
  hooks: inspectionCostTrait,
  config: {
    sections: [
      {
        id: 'inspection-cost',
        title: 'Inspection Cost',
        note: 'A scanning hop (WAF / policy engine) adds per-request latency and can block a fraction of traffic. Makes "add a WAF" a real cost, not a free box.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.inspectionMs',
            type: 'input',
            inputType: 'number',
            label: 'Inspection latency',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_INSPECTION_MS}ms`,
            why: 'Per-request scan/evaluation cost added to service time.'
          },
          {
            path: 'sim.blockRate',
            type: 'input',
            inputType: 'number',
            label: 'Block rate',
            unit: 'fraction',
            min: 0,
            max: 1,
            step: 0.01,
            altitude: 'advanced',
            why: 'Fraction of requests the policy rejects (0–1). Rejected requests are counted, not served.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['inspectionsPassed', 'inspectionsBlocked'],
    rejectionReasons: ['inspection_blocked']
  },
  honesty: {
    simulates: ['a per-request inspection latency and a probabilistic block rate'],
    notModeled: ['rule-set complexity, per-byte scan cost, or signature-specific matching']
  }
}
