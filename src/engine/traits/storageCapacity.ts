import type { ComponentNode, ComponentType } from '../core/types'
import { classifyStorageOperation } from './storageProfile'
import type {
  BeforeArrivalDecision,
  BeforeRoutingDecision,
  NodeBehaviourTrait,
  NodeCapabilityModule,
  TraitStateStore
} from './types'

export const STORAGE_CAPACITY_COMPONENT_TYPES = [
  'relational-db',
  'nosql-db',
  'shard-node',
  'partition-node'
] as const satisfies readonly ComponentType[]

const BYTES_PER_GB = 1_000_000_000
const COMMITTED_BYTES_KEY = 'storageCapacity.committedBytes'
const RESERVATIONS_KEY = 'storageCapacity.reservations'

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function storageCapacityGb(node: ComponentNode): number | null {
  return positiveNumber(node.config?.['storageCapacityGb'])
}

export function initialStorageGb(node: ComponentNode): number {
  return nonNegativeNumber(node.config?.['initialStorageGb'])
}

function committedBytes(node: ComponentNode, state: TraitStateStore | undefined): number {
  const existing = state?.get<number>(COMMITTED_BYTES_KEY)
  if (existing !== undefined) return existing
  const initial = initialStorageGb(node) * BYTES_PER_GB
  state?.set(COMMITTED_BYTES_KEY, initial)
  return initial
}

function reservations(state: TraitStateStore | undefined): Map<string, number> {
  const existing = state?.get<Map<string, number>>(RESERVATIONS_KEY)
  if (existing) return existing
  const created = new Map<string, number>()
  state?.set(RESERVATIONS_KEY, created)
  return created
}

function reservedBytes(state: TraitStateStore | undefined): number {
  let total = 0
  for (const bytes of reservations(state).values()) total += bytes
  return total
}

function isCapacityConsumingWrite(requestType: string): boolean {
  const operation = classifyStorageOperation({ type: requestType, metadata: {} })
  return operation === 'write' || operation === 'ingest'
}

function writeSizeBytes(node: ComponentNode, requestSizeBytes: number): number {
  const amplification = positiveNumber(node.config?.['storageWriteAmplification']) ?? 1
  return Math.max(0, requestSizeBytes) * amplification
}

/**
 * Models finite datastore space independently from request/worker capacity.
 * Writes reserve space at admission so concurrent writes cannot overcommit the
 * disk, then commit their growth after local processing succeeds. A request
 * that never reaches routing releases its reservation at the terminal hook.
 */
export const storageCapacityTrait: NodeBehaviourTrait = {
  name: 'storage.capacity',
  isEnabledFor: (node) => storageCapacityGb(node) !== null,
  beforeArrival: ({ node, request, state }): BeforeArrivalDecision => {
    if (!isCapacityConsumingWrite(request.type)) return { action: 'continue' }

    const capacityGb = storageCapacityGb(node)
    if (capacityGb === null) return { action: 'continue' }

    const pending = reservations(state)
    if (pending.has(request.id)) {
      return { action: 'continue', payload: { storageCapacityDecision: 'already-reserved' } }
    }

    const bytes = writeSizeBytes(node, request.sizeBytes)
    const used = committedBytes(node, state)
    const reserved = reservedBytes(state)
    const capacityBytes = capacityGb * BYTES_PER_GB
    if (used + reserved + bytes > capacityBytes) {
      return {
        action: 'rejected',
        reason: 'storage_full',
        payload: {
          storageCapacityDecision: 'rejected-full',
          storageUsedGb: used / BYTES_PER_GB,
          storageReservedGb: reserved / BYTES_PER_GB,
          storageCapacityGb: capacityGb,
          metricCounters: { storageWriteAttempts: 1, storageFullRejects: 1 }
        }
      }
    }

    pending.set(request.id, bytes)
    return {
      action: 'continue',
      payload: {
        storageCapacityDecision: 'reserved',
        storageReservedBytes: bytes,
        metricCounters: { storageWriteAttempts: 1 }
      }
    }
  },
  beforeRouting: ({ node, request, state }): BeforeRoutingDecision => {
    const pending = reservations(state)
    const bytes = pending.get(request.id)
    if (bytes === undefined) return { action: 'route' }

    pending.delete(request.id)
    const nextCommitted = committedBytes(node, state) + bytes
    state?.set(COMMITTED_BYTES_KEY, nextCommitted)
    return {
      action: 'route',
      payload: {
        storageCapacityDecision: 'committed',
        storageUsedGb: nextCommitted / BYTES_PER_GB,
        metricCounters: {
          storageWritesCommitted: 1,
          storageBytesWritten: bytes
        }
      }
    }
  },
  afterTerminal: ({ request, state }) => {
    const pending = reservations(state)
    if (!pending.delete(request.id)) return
    return {
      storageCapacityDecision: 'released-incomplete-write',
      metricCounters: { storageWriteFailures: 1 }
    }
  }
}

export const storageCapacityCapabilityModule: NodeCapabilityModule = {
  name: 'storage.capacity',
  appliesTo: STORAGE_CAPACITY_COMPONENT_TYPES,
  hooks: storageCapacityTrait,
  config: {
    sections: [
      {
        id: 'storage-capacity',
        title: 'Storage Capacity',
        note: 'When a capacity is configured, successful write and ingest payloads consume disk space. Concurrent writes reserve space before processing; writes that exceed the remaining disk are rejected as storage_full.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.storageCapacityGb',
            type: 'input',
            inputType: 'number',
            label: 'Disk capacity',
            unit: 'GB',
            min: 0.000001,
            step: 1,
            altitude: 'primary',
            optional: true,
            why: 'Enables finite storage. Writes are rejected once committed plus reserved data would exceed this ceiling.'
          },
          {
            path: 'sim.initialStorageGb',
            type: 'input',
            inputType: 'number',
            label: 'Initially used',
            unit: 'GB',
            min: 0,
            step: 1,
            altitude: 'primary',
            visible: (data) => typeof data.sim?.storageCapacityGb === 'number',
            why: 'Starts the run with an existing dataset so growth pressure can be simulated without a long warm-up.'
          },
          {
            path: 'sim.storageWriteAmplification',
            type: 'input',
            inputType: 'number',
            label: 'Write amplification',
            unit: '× payload',
            min: 0.000001,
            step: 0.1,
            altitude: 'advanced',
            visible: (data) => typeof data.sim?.storageCapacityGb === 'number',
            placeholder: 'Default 1×',
            why: 'Multiplies request payload bytes to approximate indexes, replicas, and storage-engine overhead.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'storageWriteAttempts',
      'storageWritesCommitted',
      'storageBytesWritten',
      'storageWriteFailures',
      'storageFullRejects'
    ],
    rejectionReasons: ['storage_full']
  },
  honesty: {
    simulates: [
      'finite per-node disk capacity',
      'payload-sized write growth with configurable amplification',
      'concurrent write reservations that prevent capacity overcommit',
      'storage-full rejection and incomplete-write rollback'
    ],
    notModeled: [
      'deletes, compaction, compression, tombstone reclamation, or filesystem reserved space',
      'byte-copy cost during shard migration or replica synchronization',
      'separate index and WAL capacity pools'
    ]
  }
}
