import { msToMicro } from '../core/time'
import type { ComponentType } from '../core/types'
import type {
  BeforeArrivalDecision,
  NodeBehaviourTrait,
  NodeCapabilityModule,
  TraitStateStore
} from './types'

export const CAPACITY_LIMIT_COMPONENT_TYPES = [
  'nat-gateway',
  'block-storage',
  'edge-router',
  'transit-gateway',
  'vpn-gateway',
  'high-perf-nic'
] as const satisfies readonly ComponentType[]

const DEFAULT_WINDOW_MS = 1000
const WINDOW_STATE_KEY = 'capacityLimit.window'

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Per-node rolling log of admit timestamps (µs) inside the trailing window. */
function admitLog(state: TraitStateStore | undefined): bigint[] {
  const existing = state?.get<bigint[]>(WINDOW_STATE_KEY)
  if (existing) {
    return existing
  }
  const created: bigint[] = []
  state?.set(WINDOW_STATE_KEY, created)
  return created
}

/**
 * Hard pipe-capacity ceiling. A link/volume/gateway can only push so many
 * operations per second regardless of CPU — NAT ports, disk IOPS, NIC line
 * rate. When the trailing-window admit count reaches `maxOpsPerSecond` (scaled to
 * the window), further requests are rejected with `capacity_exceeded`. This
 * saturates the *link*, not the processor — an outage class the queue model
 * alone doesn't express.
 */
export const capacityLimitTrait: NodeBehaviourTrait = {
  name: 'network.capacity-limit',
  beforeArrival: ({ node, clock, state }): BeforeArrivalDecision => {
    const maxOpsPerSecond = asPositiveNumber(node.config?.['maxOpsPerSecond'])
    if (maxOpsPerSecond === null) {
      return { action: 'continue' }
    }
    const windowMs = asPositiveNumber(node.config?.['capacityWindowMs']) ?? DEFAULT_WINDOW_MS
    const windowUs = msToMicro(windowMs)
    const limit = maxOpsPerSecond * (windowMs / 1000)

    const log = admitLog(state)
    const cutoff = clock - windowUs
    // Drop entries that have aged out of the trailing window (in place).
    let write = 0
    for (let read = 0; read < log.length; read++) {
      if (log[read] > cutoff) {
        log[write++] = log[read]
      }
    }
    log.length = write

    if (log.length >= limit) {
      return {
        action: 'rejected',
        reason: 'capacity_exceeded',
        payload: { capacityDecision: 'rejected', metricCounters: { capacityRejects: 1 } }
      }
    }
    log.push(clock)
    return {
      action: 'continue',
      payload: { capacityDecision: 'admitted', metricCounters: { capacityAdmitted: 1 } }
    }
  }
}

export const capacityLimitCapabilityModule: NodeCapabilityModule = {
  name: 'network.capacity-limit',
  appliesTo: CAPACITY_LIMIT_COMPONENT_TYPES,
  hooks: capacityLimitTrait,
  config: {
    sections: [
      {
        id: 'capacity-limit',
        title: 'Capacity Limit',
        note: 'A hard operations/second ceiling for the link/volume (IOPS, NAT ports, line rate). Requests over the ceiling are rejected, so the link saturates independently of CPU.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.maxOpsPerSecond',
            type: 'input',
            inputType: 'number',
            label: 'Max ops/sec',
            unit: 'ops/s',
            min: 0,
            altitude: 'primary',
            why: 'The throughput ceiling of the pipe. Admits up to this rate; rejects the excess.'
          },
          {
            path: 'sim.capacityWindowMs',
            type: 'input',
            inputType: 'number',
            label: 'Window',
            unit: 'ms',
            min: 1,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_WINDOW_MS}ms`,
            why: 'The rolling window the rate is measured over.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['capacityAdmitted', 'capacityRejects'],
    rejectionReasons: ['capacity_exceeded']
  },
  honesty: {
    simulates: ['a rolling-window operations/second ceiling that rejects excess traffic'],
    notModeled: ['byte-level bandwidth accounting, burst credits, or per-flow fairness']
  }
}
