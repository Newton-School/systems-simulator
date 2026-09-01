import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { ComponentType } from '../core/types'
import { writeReservationDecision } from '../core/simulationSemantics'
import type {
  BeforeArrivalDecision,
  NodeBehaviourTrait,
  NodeCapabilityModule,
  TraitContext,
  TraitStateStore
} from './types'

const DEFAULT_RESERVE_LOOKUP_MS = 3
const DEFAULT_KEY_FIELD = 'seatId'
const COMMITTED_KEYS_STATE_KEY = 'reservation.committedKeys'
/** Run-scoped ledger key: maps a resource key to the id of the node that first committed it. */
const SHARED_LEDGER_STATE_KEY = 'reservation.ledgerByKey'

export const RESERVATION_STORE_COMPONENT_TYPES = [
  'reservation-store'
] as const satisfies readonly ComponentType[]

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function reserveLookupMs(config: Record<string, unknown> | undefined): number {
  return asPositiveNumber(config?.['reserveLookupMs']) ?? DEFAULT_RESERVE_LOOKUP_MS
}

function keyField(config: Record<string, unknown> | undefined): string {
  return asNonEmptyString(config?.['resourceKeyField']) ?? DEFAULT_KEY_FIELD
}

function lookupLatencyUs(latencyMs: number): bigint {
  return BigInt(Math.max(1, Math.round(latencyMs * 1000)))
}

/** Per-node set of resource keys this authority has already committed. */
function committedKeys(state: TraitStateStore | undefined): Set<string> {
  const existing = state?.get<Set<string>>(COMMITTED_KEYS_STATE_KEY)
  if (existing) {
    return existing
  }
  const created = new Set<string>()
  state?.set(COMMITTED_KEYS_STATE_KEY, created)
  return created
}

/** Run-scoped map: resource key → id of the node that first committed it. */
function sharedLedger(sharedState: TraitStateStore | undefined): Map<string, string> {
  const existing = sharedState?.get<Map<string, string>>(SHARED_LEDGER_STATE_KEY)
  if (existing) {
    return existing
  }
  const created = new Map<string, string>()
  sharedState?.set(SHARED_LEDGER_STATE_KEY, created)
  return created
}

function setLookupOverride(request: TraitContext['request'], lookupMs: number): void {
  request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
    type: 'constant',
    value: lookupMs
  }
}

/**
 * Atomic per-key reservation authority. On a request carrying a resource key
 * (e.g. `seatId`):
 *  - if THIS authority already committed the key → a clean "sold out" response
 *    (fast, counted as a success, not an error);
 *  - otherwise it commits the key. The run-scoped ledger records the first
 *    committer per key; if a *different* node had already committed it, that
 *    second commit is an **oversell** — the double-booking signal.
 *
 * A single reservation node (or replicas sharing its state) therefore never
 * oversells. Two independent reservation nodes both receiving traffic for the
 * same key both commit → oversell, which is exactly the uncoordinated-authority
 * bug the question tests.
 */
export const reservationStoreTrait: NodeBehaviourTrait = {
  name: 'coordination.reservation-store',
  beforeArrival: ({ node, request, state, sharedState }): BeforeArrivalDecision => {
    const lookupMs = reserveLookupMs(node.config)
    const configuredKeyField = keyField(node.config)
    const key = asNonEmptyString(request.metadata[configuredKeyField])

    // No key: nothing to reserve — pass through so the guard never blocks
    // unrelated traffic (e.g. browse requests).
    if (!key) {
      setLookupOverride(request, lookupMs)
      writeReservationDecision(request, 'no-key')
      return {
        action: 'continue',
        payload: {
          reservationDecision: 'no-key',
          metricCounters: { reservationKeyless: 1 }
        }
      }
    }

    const committed = committedKeys(state)
    if (committed.has(key)) {
      writeReservationDecision(request, 'sold-out')
      return {
        action: 'handled',
        latencyUs: lookupLatencyUs(lookupMs),
        payload: {
          reservationDecision: 'sold-out',
          resourceKey: key,
          metricCounters: { reservationConflicts: 1 }
        }
      }
    }

    const ledger = sharedLedger(sharedState)
    const firstCommitter = ledger.get(key)
    committed.add(key)

    if (firstCommitter === undefined) {
      ledger.set(key, node.id)
      setLookupOverride(request, lookupMs)
      writeReservationDecision(request, 'committed')
      return {
        action: 'continue',
        payload: {
          reservationDecision: 'committed',
          resourceKey: key,
          metricCounters: { reservationCommits: 1 }
        }
      }
    }

    // A different authority already sold this key: double-booking.
    setLookupOverride(request, lookupMs)
    writeReservationDecision(request, 'oversold')
    return {
      action: 'continue',
      payload: {
        reservationDecision: 'oversold',
        resourceKey: key,
        firstCommitter,
        metricCounters: { reservationCommits: 1, reservationOversells: 1 }
      }
    }
  }
}

export const reservationStoreCapabilityModule: NodeCapabilityModule = {
  name: 'coordination.reservation-store',
  appliesTo: RESERVATION_STORE_COMPONENT_TYPES,
  hooks: reservationStoreTrait,
  config: {
    sections: [
      {
        id: 'reservation-store',
        title: 'Reservation Store',
        note: 'This authority performs an atomic reserve per resource key: the first request for a key commits, later requests for the same key are answered "sold out". Route writes for one key through a single reservation authority — two independent reservation nodes for the same key will double-book (oversell).',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.resourceKeyField',
            type: 'input',
            label: 'Resource key field',
            inputType: 'text',
            altitude: 'primary',
            placeholder: DEFAULT_KEY_FIELD,
            why: 'Reads the contended key (e.g. seatId) from request.metadata.<field>. Requests without that field pass through unreserved.'
          },
          {
            path: 'sim.reserveLookupMs',
            type: 'input',
            label: 'Reserve latency',
            unit: 'ms',
            step: 0.1,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_RESERVE_LOOKUP_MS}ms`,
            why: 'Models the cost of the atomic conditional reserve for every booking write.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'reservationCommits',
      'reservationConflicts',
      'reservationOversells',
      'reservationKeyless'
    ]
  },
  honesty: {
    simulates: [
      'atomic per-key reserve at a single authority, sold-out short-circuit, and oversell detection when a key is committed by more than one independent authority'
    ],
    notModeled: [
      'multi-key transactions and seat holds with expiry',
      'quorum/consensus latency between replicas',
      'payment confirmation and reservation release on abandonment'
    ]
  }
}
