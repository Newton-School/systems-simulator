import type { Request } from '../core/events'
import type { ComponentNode, ComponentType } from '../core/types'
import type { BeforeArrivalDecision, NodeBehaviourTrait, NodeCapabilityModule } from './types'

/**
 * Request-serving node types that can partition their capacity. Serverless is
 * deliberately absent: its `bulkhead.maxConcurrent` is already the cold-start
 * concurrency cap (`max_concurrency_exceeded`).
 */
export const BULKHEAD_COMPONENT_TYPES = [
  'microservice',
  'auth-service',
  'search-service',
  'api-gateway',
  'service-mesh',
  'sidecar',
  'payment-gateway',
  'llm-gateway',
  'model-serving'
] as const satisfies readonly ComponentType[]

export const BULKHEAD_REJECTION_REASON = 'bulkhead_full'

export interface BulkheadConfig {
  partitions: Readonly<Record<string, number>>
  defaultMaxConcurrent: number | null
  keyField: string | null
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The node's bulkhead, or null when none is configured. Only the compartment
 * fields switch it on - a bare legacy `maxConcurrent` stays inert here.
 */
export function readBulkheadConfig(node: ComponentNode): BulkheadConfig | null {
  const raw = node.resilience?.bulkhead
  if (!raw) {
    return null
  }
  const partitions: Record<string, number> = {}
  for (const [compartment, limit] of Object.entries(raw.partitions ?? {})) {
    const parsed = asPositiveInt(limit)
    const name = compartment.trim()
    if (name && parsed !== null) {
      partitions[name] = parsed
    }
  }
  const defaultMaxConcurrent = asPositiveInt(raw.defaultMaxConcurrent)
  if (Object.keys(partitions).length === 0 && defaultMaxConcurrent === null) {
    return null
  }
  return { partitions, defaultMaxConcurrent, keyField: asNonEmptyString(raw.keyField) }
}

/** The compartment a request belongs to: `metadata[keyField]` when set, else its type. */
export function bulkheadCompartmentOf(request: Request, keyField: string | null): string {
  if (keyField) {
    const value = request.metadata?.[keyField]
    if (typeof value === 'string' && value.length > 0) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return '(no key)'
  }
  return request.type
}

/**
 * Bulkhead: a semaphore per compartment at this node. A compartment (request
 * type, or a metadata key such as a tenant) may hold at most its cap of the
 * node's slots - queued plus in service - at once. The slot is taken when the
 * request is admitted and given back when it leaves the node (completion,
 * timeout, reset), because the count is read live from the node's queue.
 *
 * This differs from the worker count: workers bound the node as a whole, while
 * a bulkhead stops one compartment from taking all of them. Without it, a slow
 * request type fills every worker and the fast types wait behind it; with it,
 * the slow type is capped and its excess is rejected fast (`bulkhead_full`),
 * leaving the remaining workers to everyone else.
 */
export const bulkheadTrait: NodeBehaviourTrait = {
  name: 'resilience.bulkhead',
  isEnabledFor: (node) => readBulkheadConfig(node) !== null,
  beforeArrival: ({ node, request, countInSystem }): BeforeArrivalDecision => {
    const config = readBulkheadConfig(node)
    if (!config || !countInSystem) {
      return { action: 'continue' }
    }
    const compartment = bulkheadCompartmentOf(request, config.keyField)
    const limit = config.partitions[compartment] ?? config.defaultMaxConcurrent
    if (limit === null || limit === undefined) {
      return { action: 'continue' }
    }

    const inUse = countInSystem(
      (held) => bulkheadCompartmentOf(held, config.keyField) === compartment
    )
    if (inUse >= limit) {
      return {
        action: 'rejected',
        reason: BULKHEAD_REJECTION_REASON,
        payload: {
          bulkheadDecision: 'rejected',
          bulkheadCompartment: compartment,
          bulkheadLimit: limit,
          bulkheadInUse: inUse,
          metricCounters: { bulkheadRejected: 1, [`bulkheadRejected:${compartment}`]: 1 }
        }
      }
    }
    return {
      action: 'continue',
      payload: {
        bulkheadDecision: 'admitted',
        bulkheadCompartment: compartment,
        metricCounters: { bulkheadAdmitted: 1 }
      }
    }
  }
}

export const bulkheadCapabilityModule: NodeCapabilityModule = {
  name: 'resilience.bulkhead',
  appliesTo: BULKHEAD_COMPONENT_TYPES,
  hooks: bulkheadTrait,
  config: {
    sections: [
      {
        id: 'bulkhead',
        title: 'Bulkhead',
        note: 'Caps how many requests of one compartment (a request type, or a metadata key such as a tenant) this node holds at once, queued plus in service. Arrivals over the cap are rejected fast as bulkhead_full, so one slow compartment cannot take every worker. Off until a cap is set.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.bulkheadPartitions',
            type: 'input',
            inputType: 'text',
            label: 'Compartment caps',
            renderer: 'bulkhead-partitions',
            altitude: 'primary',
            why: 'Max requests held at once per compartment. List the slow or noisy compartment with a small cap; unlisted compartments use the default cap.'
          },
          {
            path: 'sim.bulkheadDefaultMaxConcurrent',
            type: 'input',
            inputType: 'number',
            label: 'Default cap',
            unit: 'requests',
            step: 1,
            min: 1,
            altitude: 'advanced',
            placeholder: 'Unlisted compartments uncapped',
            why: 'Cap for every compartment not listed above, e.g. "each tenant at most N".'
          },
          {
            path: 'sim.bulkheadKeyField',
            type: 'input',
            inputType: 'text',
            label: 'Compartment key',
            altitude: 'advanced',
            placeholder: 'request type if empty',
            why: 'Reads the compartment from request.metadata.<field> (e.g. tenantId). Empty uses the request type.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['bulkheadAdmitted', 'bulkheadRejected'],
    rejectionReasons: [BULKHEAD_REJECTION_REASON]
  },
  honesty: {
    simulates: [
      'a per-compartment semaphore (by request type or a metadata key) on the requests this node holds at once, queued plus in service, with fast bulkhead_full rejection over the cap'
    ],
    notModeled: [
      "per-downstream-dependency pools: a node frees its worker before forwarding, so a slow dependency cannot hold this node's workers in the first place",
      'a separate waiting queue per compartment (thread-pool bulkhead) or a max wait before rejecting',
      'reserved minimums: the cap is a ceiling for one compartment, not a guaranteed share for the others'
    ]
  }
}
