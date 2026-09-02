import { msToMicro } from '../core/time'
import type { ComponentType } from '../core/types'
import { writeIdempotencyDecision } from '../core/simulationSemantics'
import {
  ExternalOutcomeRegistry,
  reconcileExternalOutcome,
  type ExternalOutcomeStatus
} from '../semantics/v2StateMachines'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

const DEFAULT_DEDUP_WINDOW_MS = 300_000
const DEFAULT_LOOKUP_MS = 2
const DEFAULT_KEY_FIELD = 'idempotencyKey'
const SEEN_KEYS_STATE_KEY = 'idempotencyDedup.seenKeys'
const COMMIT_OUTCOME_JOURNAL_STATE_KEY = 'idempotencyDedup.commitOutcomeJournal'
const COMMIT_OUTCOME_ATTACHMENT_KEY = '__commitOutcomeJournalAttachment'
const EXTERNAL_OUTCOME_REGISTRY_STATE_KEY = 'idempotencyDedup.externalOutcomeRegistry'

type SeenKeyStore = Map<string, bigint>
type CommitOutcome = 'pending' | 'committed' | 'unknown'
type CommitOutcomeJournal = Map<string, CommitOutcome>

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

function commitOutcomeJournalEnabled(config: Record<string, unknown> | undefined): boolean {
  return config?.['commitOutcomeJournal'] === true
}

function reconcileUnknownOutcomes(config: Record<string, unknown> | undefined): boolean {
  return config?.['reconcileUnknownOutcomes'] === true
}

function reconciliationResult(config: Record<string, unknown> | undefined) {
  const value = config?.['reconciliationProbeResult']
  return value === 'committed' || value === 'not-found' || value === 'unknown' ? value : 'unknown'
}

function reconciliationMode(config: Record<string, unknown> | undefined): 'configured' | 'modeled' {
  return config?.['externalReconciliationMode'] === 'modeled' ? 'modeled' : 'configured'
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

function commitOutcomeJournal(state: TraitStateStore | undefined): CommitOutcomeJournal {
  const existing = state?.get<CommitOutcomeJournal>(COMMIT_OUTCOME_JOURNAL_STATE_KEY)
  if (existing) {
    return existing
  }

  const created: CommitOutcomeJournal = new Map()
  state?.set(COMMIT_OUTCOME_JOURNAL_STATE_KEY, created)
  return created
}

function externalOutcomeRegistry(state: TraitStateStore | undefined): ExternalOutcomeRegistry {
  const existing = state?.get<ExternalOutcomeRegistry>(EXTERNAL_OUTCOME_REGISTRY_STATE_KEY)
  if (existing) {
    return existing
  }

  const created = new ExternalOutcomeRegistry()
  state?.set(EXTERNAL_OUTCOME_REGISTRY_STATE_KEY, created)
  return created
}

function authoritativeProbeResult(
  key: string,
  config: Record<string, unknown> | undefined,
  sharedState: TraitStateStore | undefined
): ExternalOutcomeStatus {
  if (reconciliationMode(config) === 'modeled') {
    return externalOutcomeRegistry(sharedState).lookup(key)
  }
  return reconciliationResult(config)
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
  beforeArrival: ({ node, request, clock, state, sharedState }) => {
    const lookupMs = lookupLatencyMs(node.config)
    const windowMs = dedupWindowMs(node.config)
    const configuredKeyField = keyField(node.config)
    const key = readIdempotencyKey(request.metadata, configuredKeyField)

    if (!key) {
      writeIdempotencyDecision(request, 'no-key')
      request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
        type: 'constant',
        value: lookupMs
      }

      return {
        action: 'continue',
        payload: continuePayload('no-key', windowMs, lookupMs)
      }
    }

    if (commitOutcomeJournalEnabled(node.config)) {
      const journal = commitOutcomeJournal(state)
      const priorOutcome = journal.get(key)
      if (priorOutcome === 'committed') {
        writeIdempotencyDecision(request, 'duplicate')
        return {
          action: 'handled',
          latencyUs: lookupLatencyUs(lookupMs),
          payload: {
            ...duplicatePayload(key, windowMs, lookupMs),
            commitOutcomeDecision: 'commit-confirmed'
          }
        }
      }

      if (priorOutcome === 'unknown' && reconcileUnknownOutcomes(node.config)) {
        const resolution = reconcileExternalOutcome(
          { lookup: (probeKey) => authoritativeProbeResult(probeKey, node.config, sharedState) },
          key
        )
        if (resolution === 'safe-retry') {
          journal.delete(key)
        } else {
          journal.set(key, 'committed')
        }
        if (resolution === 'safe-retry') {
          request.metadata[COMMIT_OUTCOME_ATTACHMENT_KEY] = { nodeId: node.id, key }
          writeIdempotencyDecision(request, 'recorded')
          return {
            action: 'continue',
            payload: {
              idempotencyDecision: 'recorded',
              idempotencyKey: key,
              commitOutcomeDecision: 'intent-recorded',
              metricCounters: {
                idempotencyReconciliations: 1,
                idempotencySafeRetries: 1,
                externalReconciliationProbes: 1
              }
            }
          }
        }
        writeIdempotencyDecision(request, 'duplicate')
        return {
          action: 'handled',
          latencyUs: lookupLatencyUs(lookupMs),
          payload: {
            ...duplicatePayload(key, windowMs, lookupMs),
            commitOutcomeDecision:
              resolution === 'commit-confirmed' ? 'commit-confirmed' : 'replay-blocked',
            metricCounters: {
              idempotencyReconciliations: 1,
              externalReconciliationProbes: 1
            }
          }
        }
      }

      if (priorOutcome === 'pending' || priorOutcome === 'unknown') {
        writeIdempotencyDecision(request, 'duplicate')
        return {
          action: 'rejected',
          reason: 'commit_outcome_unknown',
          payload: {
            idempotencyDecision: 'duplicate',
            idempotencyKey: key,
            commitOutcomeDecision: 'replay-blocked',
            metricCounters: { idempotencyOutcomeUnknown: 1 }
          }
        }
      }

      journal.set(key, 'pending')
      request.metadata[COMMIT_OUTCOME_ATTACHMENT_KEY] = { nodeId: node.id, key }
      writeIdempotencyDecision(request, 'recorded')
      request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
        type: 'constant',
        value: lookupMs
      }
      return {
        action: 'continue',
        payload: {
          ...continuePayload('recorded', windowMs, lookupMs, key),
          commitOutcomeDecision: 'intent-recorded'
        }
      }
    }

    const keys = seenKeys(state)
    const expiresAt = keys.get(key)
    if (expiresAt !== undefined && expiresAt > clock) {
      writeIdempotencyDecision(request, 'duplicate')
      return {
        action: 'handled',
        latencyUs: lookupLatencyUs(lookupMs),
        payload: duplicatePayload(key, windowMs, lookupMs)
      }
    }

    keys.set(key, clock + msToMicro(windowMs))
    writeIdempotencyDecision(request, 'recorded')
    request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
      type: 'constant',
      value: lookupMs
    }

    return {
      action: 'continue',
      payload: continuePayload('recorded', windowMs, lookupMs, key)
    }
  },
  afterTerminal: ({ node, request, state, sharedState, status, reasonCode }) => {
    if (!commitOutcomeJournalEnabled(node.config)) {
      return undefined
    }

    const attachment = request.metadata[COMMIT_OUTCOME_ATTACHMENT_KEY]
    if (
      !attachment ||
      typeof attachment !== 'object' ||
      (attachment as Record<string, unknown>)['nodeId'] !== node.id ||
      typeof (attachment as Record<string, unknown>)['key'] !== 'string'
    ) {
      return undefined
    }

    const key = (attachment as Record<string, string>)['key']
    const journal = commitOutcomeJournal(state)
    if (status === 'success') {
      journal.set(key, 'committed')
      externalOutcomeRegistry(sharedState).record(key, 'committed')
      return { commitOutcomeDecision: 'commit-confirmed', idempotencyKey: key }
    }

    journal.set(key, 'unknown')
    if (request.metadata.externalSideEffectCommitted === true) {
      externalOutcomeRegistry(sharedState).record(key, 'committed')
    } else if (request.metadata.externalSideEffectCommitted === false) {
      externalOutcomeRegistry(sharedState).record(key, 'not-found')
    }
    return {
      commitOutcomeDecision: 'outcome-unknown',
      idempotencyKey: key,
      reason: reasonCode ?? status,
      metricCounters: { idempotencyOutcomeUnknown: 1 }
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
        note: 'This guard records first-seen keys for a time window and short-circuits duplicate writes before they reach the downstream write path. Enable the commit journal when a question needs explicit committed-versus-unknown outcome state.',
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
          },
          {
            path: 'sim.commitOutcomeJournal',
            type: 'boolean',
            label: 'Commit outcome journal',
            altitude: 'advanced',
            why: 'Records intent before downstream work and confirms the key only after a successful terminal outcome. Interrupted attempts become outcome-unknown and are blocked from re-executing until reconciled.'
          },
          {
            path: 'sim.reconcileUnknownOutcomes',
            type: 'boolean',
            label: 'Reconcile unknown outcomes',
            altitude: 'advanced',
            why: 'Deterministically resolves a prior unknown outcome as committed before suppressing a replay. Enable only when the external side effect can be queried safely.'
          },
          {
            path: 'sim.externalReconciliationMode',
            type: 'select',
            label: 'Reconciliation source',
            options: ['modeled', 'configured'],
            altitude: 'advanced',
            why: 'Modeled probes read the shared authoritative side-effect registry; configured probes use the scenario-owned fixed result.'
          },
          {
            path: 'sim.reconciliationProbeResult',
            type: 'select',
            label: 'Authoritative probe result',
            options: ['committed', 'not-found', 'unknown'],
            altitude: 'advanced',
            why: 'Scenario-owned response from the external side-effect status probe.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'idempotencyDuplicateHits',
      'idempotencyUniqueKeys',
      'idempotencyKeysMissing',
      'idempotencyOutcomeUnknown',
      'idempotencyReconciliations',
      'idempotencySafeRetries',
      'externalReconciliationProbes'
    ]
  },
  honesty: {
    simulates: [
      'time-window dedup by idempotency key and duplicate short-circuit at the guard',
      'durable per-key intent, confirmed commit outcome, explicit unknown-outcome blocking, and modeled authoritative reconciliation probes when the commit journal is enabled'
    ],
    notModeled: ['cross-node consensus on dedup state', 'live provider/API I/O from the simulator']
  }
}
