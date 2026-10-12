import type { ComponentNode, NodeState } from '../core/types'
import { BULKHEAD_COMPONENT_TYPES } from './bulkhead'
import type { BeforeArrivalDecision, NodeBehaviourTrait, NodeCapabilityModule } from './types'

/** Same request-serving types as the bulkhead; shedding protects their admitted latency. */
export const LOAD_SHEDDING_COMPONENT_TYPES = BULKHEAD_COMPONENT_TYPES

export const LOAD_SHED_REJECTION_REASON = 'load_shed'

export interface LoadSheddingConfig {
  /** Shed when this many requests are already waiting in the queue. */
  queueDepth: number | null
  /** Shed when the estimated queueing delay for a new arrival exceeds this. */
  maxQueueDelayMs: number | null
  /** Never shed high-priority (priority 0) requests. */
  protectHighPriority: boolean
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** The node's shedding policy, or null when neither threshold is set. */
export function readLoadSheddingConfig(node: ComponentNode): LoadSheddingConfig | null {
  const queueDepth = asPositiveNumber(node.config?.['loadShedQueueDepth'])
  const maxQueueDelayMs = asPositiveNumber(node.config?.['loadShedMaxQueueDelayMs'])
  if (queueDepth === null && maxQueueDelayMs === null) {
    return null
  }
  return {
    queueDepth: queueDepth === null ? null : Math.max(1, Math.floor(queueDepth)),
    maxQueueDelayMs,
    protectHighPriority: node.config?.['loadShedProtectHighPriority'] === true
  }
}

/**
 * Expected queueing delay for a request arriving now: zero while a worker is
 * free, otherwise the work ahead of it (everyone queued, plus itself) drained
 * by c workers at the node's observed mean service time. Null before the
 * first completion, when there is no observed service time to estimate with.
 */
export function estimateQueueDelayMs(nodeState: NodeState): number | null {
  const workers = nodeState.workerCapacity ?? 0
  if (workers <= 0 || nodeState.meanServiceTimeMs <= 0) {
    return null
  }
  if (nodeState.activeWorkers < workers) {
    return 0
  }
  return ((nodeState.queueLength + 1) / workers) * nodeState.meanServiceTimeMs
}

function shedDecision(
  trigger: 'queue-depth' | 'queue-delay',
  detail: Record<string, unknown>
): BeforeArrivalDecision {
  return {
    action: 'rejected',
    reason: LOAD_SHED_REJECTION_REASON,
    payload: {
      loadShedDecision: 'shed',
      loadShedTrigger: trigger,
      ...detail,
      metricCounters: {
        loadShed: 1,
        ...(trigger === 'queue-depth' ? { loadShedByQueueDepth: 1 } : { loadShedByQueueDelay: 1 })
      }
    }
  }
}

/**
 * Load shedding: when the node is already overloaded, refuse new work at the
 * door instead of queueing it. Two overload signals, either of which sheds:
 *   - queue depth: requests already waiting >= the threshold;
 *   - queueing delay: the estimated wait for this arrival > the threshold.
 * A shed request costs no worker time and is rejected immediately as
 * `load_shed`, so the requests that ARE admitted wait behind a short queue and
 * keep their latency, at the price of rejecting the excess. Shed requests are
 * not retried by the retry trait (a retry would add load to an overloaded node).
 */
export const loadSheddingTrait: NodeBehaviourTrait = {
  name: 'resilience.load-shedding',
  isEnabledFor: (node) => readLoadSheddingConfig(node) !== null,
  beforeArrival: ({ node, request, nodeState }): BeforeArrivalDecision => {
    const config = readLoadSheddingConfig(node)
    if (!config || !nodeState) {
      return { action: 'continue' }
    }
    if (config.protectHighPriority && request.priority === 0) {
      return { action: 'continue' }
    }

    if (config.queueDepth !== null && nodeState.queueLength >= config.queueDepth) {
      return shedDecision('queue-depth', {
        queueLength: nodeState.queueLength,
        threshold: config.queueDepth
      })
    }

    if (config.maxQueueDelayMs !== null) {
      const estimatedDelayMs = estimateQueueDelayMs(nodeState)
      if (estimatedDelayMs !== null && estimatedDelayMs > config.maxQueueDelayMs) {
        return shedDecision('queue-delay', {
          estimatedQueueDelayMs: estimatedDelayMs,
          threshold: config.maxQueueDelayMs
        })
      }
    }

    return { action: 'continue' }
  }
}

export const loadSheddingCapabilityModule: NodeCapabilityModule = {
  name: 'resilience.load-shedding',
  appliesTo: LOAD_SHEDDING_COMPONENT_TYPES,
  hooks: loadSheddingTrait,
  config: {
    sections: [
      {
        id: 'load-shedding',
        title: 'Load Shedding',
        note: 'Rejects new arrivals fast (load_shed) while the node is overloaded, so admitted requests keep a short queue and low latency. Set a queue-depth or queueing-delay threshold to turn it on.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.loadShedQueueDepth',
            type: 'input',
            inputType: 'number',
            label: 'Shed at queue depth',
            unit: 'waiting',
            step: 1,
            min: 1,
            altitude: 'primary',
            placeholder: 'Off',
            why: 'Shed new arrivals once this many requests are already waiting. Lower keeps admitted latency tighter and sheds more.'
          },
          {
            path: 'sim.loadShedMaxQueueDelayMs',
            type: 'input',
            inputType: 'number',
            label: 'Shed above queueing delay',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: 'Off',
            why: 'Shed when the estimated wait for a new arrival, (queued + 1) / workers x observed mean service time, exceeds this. Applies from the first completion on.'
          },
          {
            path: 'sim.loadShedProtectHighPriority',
            type: 'boolean',
            label: 'Never shed high priority',
            altitude: 'advanced',
            defaultValue: false,
            why: 'High-priority requests (about 10% of generated traffic) are always admitted, so shedding falls on normal traffic.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['loadShed', 'loadShedByQueueDepth', 'loadShedByQueueDelay'],
    rejectionReasons: [LOAD_SHED_REJECTION_REASON]
  },
  honesty: {
    simulates: [
      'arrival-time load shedding on queue depth or estimated queueing delay (from the observed mean service time), with fast load_shed rejection and optional high-priority exemption'
    ],
    notModeled: [
      'evicting requests that are already queued (LIFO, priority or random victim selection)',
      'adaptive concurrency limits (e.g. gradient or AIMD) and CPU-based overload signals',
      'the cost of rejecting: a shed request uses no worker time here'
    ]
  }
}
