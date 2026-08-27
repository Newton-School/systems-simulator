import { msToMicro } from '../core/time'
import type { ComponentType } from '../core/types'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

const DEFAULT_DEDUP_WINDOW_MS = 300_000
const DEFAULT_LOOKUP_MS = 2
const DEFAULT_KEY_FIELD = 'idempotencyKey'
const SEEN_KEYS_STATE_KEY = 'idempotencyDedup.seenKeys'

type SeenKeyStore = Map<string, bigint>

export const IDEMPOTENCY_DEDUP_COMPONENT_TYPES = [
  'idempotency-manager'
] as const satisfies readonly ComponentType[]

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function lookupLatencyMs(config: Record<string, unknown> | undefined): number {
  return asPositiveNumber(config?.['storeLookupMs']) ?? DEFAULT_LOOKUP_MS
}

function dedupWindowMs(config: Record<string, unknown> | undefined): number {
  return asPositiveNumber(config?.['dedupWindowMs']) ?? DEFAULT_DEDUP_WINDOW_MS
}

function keyField(config: Record<string, unknown> | undefined): string {
  return asNonEmptyString(config?.['dedupKeyField']) ?? DEFAULT_KEY_FIELD
}

function lookupLatencyUs(latencyMs: number): bigint {
  return BigInt(Math.max(1, Math.round(latencyMs * 1000)))
}

function seenKeys(state: TraitStateStore | undefined): SeenKeyStore {
  const existing = state?.get<SeenKeyStore>(SEEN_KEYS_STATE_KEY)
  if (existing) {
    return existing
  }

  const created: SeenKeyStore = new Map()
  state?.set(SEEN_KEYS_STATE_KEY, created)
  return created
}

function readIdempotencyKey(
  metadata: Record<string, unknown>,
  configuredField: string
): string | null {
  return asNonEmptyString(metadata[configuredField])
}

function duplicatePayload(
  idempotencyKey: string,
  dedupWindowMsValue: number,
  lookupLatencyMsValue: number
) {
  return {
    idempotencyDecision: 'duplicate',
    idempotencyKey,
    dedupWindowMs: dedupWindowMsValue,
    storeLookupMs: lookupLatencyMsValue,
    metricCounters: {
      idempotencyDuplicateHits: 1
    }
  }
}

function continuePayload(
  decision: 'recorded' | 'no-key',
  dedupWindowMsValue: number,
  lookupLatencyMsValue: number,
  idempotencyKey?: string
) {
  return {
    idempotencyDecision: decision,
    idempotencyKey,
    dedupWindowMs: dedupWindowMsValue,
    storeLookupMs: lookupLatencyMsValue,
    serviceTimeOverrideFor: 'idempotency:lookup',
    metricCounters:
      decision === 'recorded'
        ? { idempotencyUniqueKeys: 1 }
        : {
            idempotencyKeysMissing: 1
          }
  }
}

function placeholder(field: 'dedupWindowMs' | 'storeLookupMs' | 'dedupKeyField'): string {
  switch (field) {
    case 'dedupWindowMs':
      return `Default ${DEFAULT_DEDUP_WINDOW_MS.toLocaleString()}ms`
    case 'storeLookupMs':
      return `Default ${DEFAULT_LOOKUP_MS}ms`
    case 'dedupKeyField':
      return DEFAULT_KEY_FIELD
  }
}

export const idempotencyDedupTrait: NodeBehaviourTrait = {
  name: 'coordination.idempotency-dedup',
  beforeArrival: ({ node, request, clock, state }) => {
    const lookupMs = lookupLatencyMs(node.config)
    const windowMs = dedupWindowMs(node.config)
    const configuredKeyField = keyField(node.config)
    const key = readIdempotencyKey(request.metadata, configuredKeyField)

    if (!key) {
      request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
        type: 'constant',
        value: lookupMs
      }

      return {
        action: 'continue',
        payload: continuePayload('no-key', windowMs, lookupMs)
      }
    }

    const keys = seenKeys(state)
    const expiresAt = keys.get(key)
    if (expiresAt !== undefined && expiresAt > clock) {
      return {
        action: 'handled',
        latencyUs: lookupLatencyUs(lookupMs),
        payload: duplicatePayload(key, windowMs, lookupMs)
      }
    }

    keys.set(key, clock + msToMicro(windowMs))
    request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
      type: 'constant',
      value: lookupMs
    }

    return {
      action: 'continue',
      payload: continuePayload('recorded', windowMs, lookupMs, key)
    }
  }
}

export const idempotencyDedupCapabilityModule: NodeCapabilityModule = {
  name: 'coordination.idempotency-dedup',
  appliesTo: IDEMPOTENCY_DEDUP_COMPONENT_TYPES,
  hooks: idempotencyDedupTrait,
  config: {
    sections: [
      {
        id: 'idempotency-dedup',
        title: 'Idempotency Guard',
        note: 'This guard records first-seen keys for a time window and short-circuits duplicate writes before they reach the downstream write path. It teaches retried-write dedup, not full distributed exactly-once.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.dedupKeyField',
            type: 'input',
            label: 'Metadata key',
            inputType: 'text',
            altitude: 'primary',
            placeholder: placeholder('dedupKeyField'),
            why: 'Reads the idempotency key from request.metadata.<field>. Requests without that field still pass through the guard.'
          },
          {
            path: 'sim.storeLookupMs',
            type: 'input',
            label: 'Lookup latency',
            unit: 'ms',
            step: 0.1,
            altitude: 'primary',
            placeholder: placeholder('storeLookupMs'),
            why: 'Models the cost of checking the dedup store for every guarded write.'
          },
          {
            path: 'sim.dedupWindowMs',
            type: 'input',
            label: 'Dedup window',
            unit: 'ms',
            step: 1,
            altitude: 'advanced',
            placeholder: placeholder('dedupWindowMs'),
            why: 'Controls how long a seen key suppresses retried writes.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['idempotencyDuplicateHits', 'idempotencyUniqueKeys', 'idempotencyKeysMissing']
  },
  honesty: {
    simulates: ['time-window dedup by idempotency key and duplicate short-circuit at the guard'],
    notModeled: [
      'commit outcome tracking',
      'cross-node consensus on dedup state',
      'partial-failure recovery between the guard and downstream ledger'
    ]
  }
}
