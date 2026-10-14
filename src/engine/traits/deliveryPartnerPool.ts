import { msToMicro, microToMs } from '../core/time'
import type { ComponentType } from '../core/types'
import {
  SERVICE_TIME_WAIT_APPLIED_MS_KEY,
  SERVICE_TIME_WAIT_UNTIL_US_KEY
} from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const DELIVERY_PARTNER_COMPONENT_TYPES = [
  'microservice',
  'batch-worker'
] as const satisfies readonly ComponentType[]

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function deliveryPartnerCapacity(
  config: Record<string, unknown> | undefined
): number | null {
  if (config?.['partnerPoolEnabled'] !== true) return null
  return positiveInteger(config['partnerCapacity'])
}

export const deliveryPartnerPoolTrait: NodeBehaviourTrait = {
  name: 'delivery.partner-pool',
  isEnabledFor: (node) => node.config?.['partnerPoolEnabled'] === true,
  beforeArrival: ({ node, request, clock }) => {
    if (node.config?.['partnerPoolEnabled'] !== true) return { action: 'continue' }

    const unavailableUntilMs = nonNegative(node.config['partnerUnavailableUntilMs'])
    const unavailableUntilUs = msToMicro(unavailableUntilMs)
    const matchingMs = nonNegative(node.config['partnerMatchMs'])
    if (unavailableUntilUs > clock) {
      request.metadata[SERVICE_TIME_WAIT_UNTIL_US_KEY] = Number(unavailableUntilUs)
    }
    if (matchingMs > 0) {
      const existing = request.metadata[SERVICE_TIME_WAIT_UNTIL_US_KEY]
      const base = typeof existing === 'number' ? Math.max(existing, Number(clock)) : Number(clock)
      request.metadata[SERVICE_TIME_WAIT_UNTIL_US_KEY] = base + Number(msToMicro(matchingMs))
    }

    const plannedWaitMs = Math.max(0, microToMs(unavailableUntilUs - clock)) + matchingMs
    return {
      action: 'continue',
      payload: {
        partnerDecision: plannedWaitMs > 0 ? 'waiting' : 'available',
        partnerCapacity: deliveryPartnerCapacity(node.config),
        metricCounters: {
          partnerRequests: 1,
          ...(plannedWaitMs > 0 ? { partnerQueuedForAvailability: 1 } : {})
        }
      }
    }
  },
  afterTerminal: ({ node, request, status }) => {
    if (node.config?.['partnerPoolEnabled'] !== true) return undefined
    const applied = request.metadata[SERVICE_TIME_WAIT_APPLIED_MS_KEY]
    const waitMs = typeof applied === 'number' && Number.isFinite(applied) ? applied : 0
    return {
      metricCounters: {
        ...(status === 'success' ? { partnerAssignments: 1 } : { partnerAssignmentFailures: 1 }),
        ...(waitMs > 0 ? { partnerWaits: 1, partnerWaitMs: waitMs } : {})
      }
    }
  }
}

export const deliveryPartnerPoolCapabilityModule: NodeCapabilityModule = {
  name: 'delivery.partner-pool',
  appliesTo: DELIVERY_PARTNER_COMPONENT_TYPES,
  hooks: deliveryPartnerPoolTrait,
  config: {
    sections: [
      {
        id: 'delivery-partners',
        title: 'Delivery Partner Pool',
        note: 'Models a finite pool of concurrently assignable partners. When unavailable, admitted work waits and consumes queue capacity until partners return.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.partnerPoolEnabled',
            type: 'boolean',
            label: 'Model partner availability',
            defaultValue: false,
            altitude: 'primary',
            why: 'Turns this service or worker into a finite delivery-partner assignment pool.'
          },
          {
            path: 'sim.partnerCapacity',
            type: 'input',
            inputType: 'number',
            label: 'Available partners',
            min: 1,
            step: 1,
            altitude: 'primary',
            visible: (data) => data.sim?.partnerPoolEnabled === true,
            why: 'Sets the maximum number of concurrent assignments; excess orders wait in this node queue.'
          },
          {
            path: 'sim.partnerUnavailableUntilMs',
            type: 'input',
            inputType: 'number',
            label: 'Unavailable until',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            visible: (data) => data.sim?.partnerPoolEnabled === true,
            why: 'Orders arriving before this simulation time remain waiting instead of being discarded.'
          },
          {
            path: 'sim.partnerMatchMs',
            type: 'input',
            inputType: 'number',
            label: 'Matching latency',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            visible: (data) => data.sim?.partnerPoolEnabled === true,
            why: 'Adds deterministic partner-search time to every assignment.'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.partnerPoolEnabled',
      value: false,
      rationale: 'Only delivery-assignment nodes should model partners.'
    },
    {
      path: 'sim.partnerCapacity',
      value: 10,
      rationale: 'A visible finite default without constraining unrelated services.'
    },
    {
      path: 'sim.partnerUnavailableUntilMs',
      value: 0,
      rationale: 'Partners begin available unless a scenario says otherwise.'
    },
    {
      path: 'sim.partnerMatchMs',
      value: 0,
      rationale: 'Matching delay is explicit rather than guessed.'
    }
  ],
  metrics: {
    counters: [
      'partnerRequests',
      'partnerQueuedForAvailability',
      'partnerAssignments',
      'partnerAssignmentFailures',
      'partnerWaits',
      'partnerWaitMs'
    ]
  },
  honesty: {
    simulates: [
      'finite concurrent partner capacity backed by the node queue',
      'deterministic unavailability windows and matching delay',
      'orders waiting in system until capacity becomes available or their deadline expires'
    ],
    notModeled: [
      'geospatial driver movement and distance-based matching',
      'individual partner acceptance probabilities, shifts, ratings, and cancellations'
    ]
  }
}
