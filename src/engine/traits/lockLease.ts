import { msToMicro } from '../core/time'
import type { Request } from '../core/events'
import type { ComponentNode, ComponentType } from '../core/types'
import { writeLockDecision } from '../core/simulationSemantics'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export interface LockLeaseConfig {
  keyField: string
  acquireMs: number
  leaseMs: number
  leaseUs: bigint
  fencing: boolean
}

interface ActiveLease {
  ownerRequestId: string
  expiresAtUs: bigint
  fencingToken: number
}

export interface LockLeaseAttachment {
  nodeId: string
  resourceKey: string
  fencingToken: number
}

const DEFAULT_ACQUIRE_MS = 2
const DEFAULT_LEASE_MS = 5_000
const DEFAULT_KEY_FIELD = 'seatId'
const ACTIVE_LEASES_STATE_KEY = 'lockLease.activeLeases'
const FENCING_COUNTER_STATE_KEY = 'lockLease.nextFencingToken'
const REQUEST_LOCK_ATTACHMENTS_KEY = '__lockLeaseAttachments'

export const LOCK_LEASE_COMPONENT_TYPES = [
  'distributed-lock'
] as const satisfies readonly ComponentType[]

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function activeLeases(state: TraitStateStore | undefined): Map<string, ActiveLease> {
  const existing = state?.get<Map<string, ActiveLease>>(ACTIVE_LEASES_STATE_KEY)
  if (existing) {
    return existing
  }

  const created = new Map<string, ActiveLease>()
  state?.set(ACTIVE_LEASES_STATE_KEY, created)
  return created
}

function nextFencingToken(state: TraitStateStore | undefined): number {
  const current = state?.get<number>(FENCING_COUNTER_STATE_KEY) ?? 0
  const next = current + 1
  state?.set(FENCING_COUNTER_STATE_KEY, next)
  return next
}

function readAttachmentArray(request: Pick<Request, 'metadata'>): LockLeaseAttachment[] {
  const raw = request.metadata[REQUEST_LOCK_ATTACHMENTS_KEY]
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object') {
      return []
    }

    const attachment = value as Partial<LockLeaseAttachment>
    return typeof attachment.nodeId === 'string' &&
      typeof attachment.resourceKey === 'string' &&
      typeof attachment.fencingToken === 'number'
      ? [
          {
            nodeId: attachment.nodeId,
            resourceKey: attachment.resourceKey,
            fencingToken: attachment.fencingToken
          }
        ]
      : []
  })
}

function writeAttachmentArray(request: Request, attachments: LockLeaseAttachment[]): void {
  if (attachments.length === 0) {
    delete request.metadata[REQUEST_LOCK_ATTACHMENTS_KEY]
    return
  }

  request.metadata[REQUEST_LOCK_ATTACHMENTS_KEY] = attachments
}

function setAcquireOverride(request: Request, acquireMs: number): void {
  request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
    type: 'constant',
    value: acquireMs
  }
}

function purgeExpiredLeases(leases: Map<string, ActiveLease>, clock: bigint): void {
  for (const [key, lease] of leases.entries()) {
    if (lease.expiresAtUs <= clock) {
      leases.delete(key)
    }
  }
}

function readResourceKey(request: Request, keyField: string): string | null {
  return asNonEmptyString(request.metadata[keyField])
}

export function readLockLeaseConfig(node: Pick<ComponentNode, 'config'>): LockLeaseConfig {
  const acquireMs = asPositiveNumber(node.config?.['acquireMs']) ?? DEFAULT_ACQUIRE_MS
  const leaseMs = asPositiveNumber(node.config?.['leaseMs']) ?? DEFAULT_LEASE_MS
  const keyField = asNonEmptyString(node.config?.['lockKeyField']) ?? DEFAULT_KEY_FIELD

  return {
    keyField,
    acquireMs,
    leaseMs,
    leaseUs: msToMicro(leaseMs),
    fencing: node.config?.['fencing'] === true
  }
}

export function attachLockLease(request: Request, attachment: LockLeaseAttachment): void {
  const existing = readAttachmentArray(request).filter(
    (value) => value.nodeId !== attachment.nodeId || value.resourceKey !== attachment.resourceKey
  )
  existing.push(attachment)
  writeAttachmentArray(request, existing)
}

export function readLockLeaseAttachments(
  request: Pick<Request, 'metadata'>
): readonly LockLeaseAttachment[] {
  return readAttachmentArray(request)
}

export function clearLockLeaseAttachments(request: Request): void {
  delete request.metadata[REQUEST_LOCK_ATTACHMENTS_KEY]
}

export function releaseLockLeaseAttachment(
  state: TraitStateStore | undefined,
  requestId: string,
  attachment: LockLeaseAttachment
): boolean {
  const leases = activeLeases(state)
  const current = leases.get(attachment.resourceKey)
  if (
    !current ||
    current.ownerRequestId !== requestId ||
    current.fencingToken !== attachment.fencingToken
  ) {
    return false
  }

  leases.delete(attachment.resourceKey)
  return true
}

export const lockLeaseTrait: NodeBehaviourTrait = {
  name: 'coordination.lock-lease',
  beforeArrival: ({ node, request }) => {
    const config = readLockLeaseConfig(node)
    const key = readResourceKey(request, config.keyField)
    if (!key) {
      writeLockDecision(request, 'no-key')
      return {
        action: 'continue',
        payload: {
          lockDecision: 'no-key',
          metricCounters: { lockKeyless: 1 }
        }
      }
    }

    setAcquireOverride(request, config.acquireMs)
    writeLockDecision(request, 'attempting')
    return {
      action: 'continue',
      payload: {
        lockDecision: 'attempting',
        resourceKey: key,
        leaseMs: config.leaseMs
      }
    }
  },
  beforeRouting: ({ node, request, clock, state }) => {
    const config = readLockLeaseConfig(node)
    const key = readResourceKey(request, config.keyField)
    if (!key) {
      return { action: 'route' }
    }

    const leases = activeLeases(state)
    purgeExpiredLeases(leases, clock)

    const current = leases.get(key)
    if (current && current.ownerRequestId !== request.id) {
      writeLockDecision(request, 'contended')
      return {
        action: 'rejected',
        reason: 'lock_contended',
        payload: {
          lockDecision: 'contended',
          resourceKey: key,
          metricCounters: { lockContentions: 1 }
        }
      }
    }

    if (!current) {
      const fencingToken = nextFencingToken(state)
      leases.set(key, {
        ownerRequestId: request.id,
        expiresAtUs: clock + config.leaseUs,
        fencingToken
      })
      attachLockLease(request, { nodeId: node.id, resourceKey: key, fencingToken })
      writeLockDecision(request, 'acquired')
      return {
        action: 'route',
        payload: {
          lockDecision: 'acquired',
          resourceKey: key,
          leaseMs: config.leaseMs,
          ...(config.fencing ? { fencingToken } : {}),
          metricCounters: { lockAcquires: 1 }
        }
      }
    }

    writeLockDecision(request, 'held-by-request')
    return {
      action: 'route',
      payload: {
        lockDecision: 'held-by-request',
        resourceKey: key,
        ...(config.fencing ? { fencingToken: current.fencingToken } : {})
      }
    }
  }
}

export const lockLeaseCapabilityModule: NodeCapabilityModule = {
  name: 'coordination.lock-lease',
  appliesTo: LOCK_LEASE_COMPONENT_TYPES,
  hooks: lockLeaseTrait,
  config: {
    sections: [
      {
        id: 'lock-lease',
        title: 'Lock Lease',
        note: 'This lock acquires a per-key lease before traffic continues downstream. The lease is held until the request terminates or the TTL expires, so contention shows up as real retries/rejections instead of prose-only correctness.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.lockKeyField',
            type: 'input',
            label: 'Lock key field',
            inputType: 'text',
            altitude: 'primary',
            placeholder: DEFAULT_KEY_FIELD,
            why: 'Reads the contended key from request.metadata.<field>. Requests without that key pass through unlocked.'
          },
          {
            path: 'sim.acquireMs',
            type: 'input',
            label: 'Acquire latency',
            unit: 'ms',
            step: 0.1,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_ACQUIRE_MS}ms`,
            why: 'Models the cost of contacting the lock authority before entering the critical section.'
          },
          {
            path: 'sim.leaseMs',
            type: 'input',
            label: 'Lease TTL',
            unit: 'ms',
            step: 1,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_LEASE_MS}ms`,
            why: 'How long the lock stays valid if the request never releases it cleanly.'
          },
          {
            path: 'sim.fencing',
            type: 'boolean',
            label: 'Expose fencing token',
            altitude: 'advanced',
            why: 'Attaches a monotonically increasing token to successful acquires for downstream reasoning.'
          }
        ]
      }
    ]
  },
  metrics: {
    counters: ['lockAcquires', 'lockContentions', 'lockKeyless']
  },
  honesty: {
    simulates: [
      'per-key lease acquisition with TTL expiry',
      'contention rejections when another request still owns the lease'
    ],
    notModeled: [
      'quorum replication or leader failover inside the lock service',
      'lease extension heartbeats',
      'multi-key deadlock detection'
    ]
  }
}
