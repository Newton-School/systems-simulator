import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { Request } from '../core/events'
import type { ComponentType } from '../core/types'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

type StorageOperation = 'read' | 'write' | 'query' | 'scan' | 'ingest'

export const STORAGE_PROFILE_COMPONENT_TYPES = [
  'relational-db',
  'nosql-db',
  'object-storage',
  'search-index',
  'time-series-db',
  'graph-db',
  'vector-db',
  'data-warehouse',
  'data-lake',
  'kv-store'
] as const satisfies readonly ComponentType[]

const QUERY_PROFILE_COMPONENT_TYPES = new Set<ComponentType>([
  'nosql-db',
  'search-index',
  'time-series-db',
  'graph-db',
  'vector-db',
  'data-warehouse',
  'data-lake',
  'object-storage'
])

const SCAN_PROFILE_COMPONENT_TYPES = new Set<ComponentType>([
  'relational-db',
  'nosql-db',
  'object-storage',
  'data-warehouse',
  'data-lake',
  'kv-store'
])

const INGEST_PROFILE_COMPONENT_TYPES = new Set<ComponentType>([
  'nosql-db',
  'object-storage',
  'search-index',
  'time-series-db',
  'vector-db',
  'data-warehouse',
  'data-lake'
])

const STORAGE_OPERATION_FIELDS: Record<StorageOperation, string> = {
  read: 'storageReadMs',
  write: 'storageWriteMs',
  query: 'storageQueryMs',
  scan: 'storageScanMs',
  ingest: 'storageIngestMs'
}

const STORAGE_OPERATION_LABELS: Record<StorageOperation, string> = {
  read: 'Read latency',
  write: 'Write latency',
  query: 'Query latency',
  scan: 'Scan latency',
  ingest: 'Ingest latency'
}

const STORAGE_COUNTERS: Record<StorageOperation, string> = {
  read: 'storageProfileReads',
  write: 'storageProfileWrites',
  query: 'storageProfileQueries',
  scan: 'storageProfileScans',
  ingest: 'storageProfileIngests'
}

const DEFAULT_STORAGE_PROFILE_MS: Record<
  (typeof STORAGE_PROFILE_COMPONENT_TYPES)[number],
  Record<StorageOperation, number>
> = {
  'relational-db': { read: 8, write: 16, query: 14, scan: 42, ingest: 22 },
  'nosql-db': { read: 4, write: 7, query: 10, scan: 36, ingest: 8 },
  'object-storage': { read: 24, write: 36, query: 80, scan: 64, ingest: 28 },
  'search-index': { read: 10, write: 20, query: 8, scan: 18, ingest: 16 },
  'time-series-db': { read: 6, write: 11, query: 9, scan: 16, ingest: 4 },
  'graph-db': { read: 9, write: 13, query: 20, scan: 26, ingest: 18 },
  'vector-db': { read: 11, write: 18, query: 13, scan: 22, ingest: 15 },
  'data-warehouse': { read: 18, write: 28, query: 22, scan: 40, ingest: 24 },
  'data-lake': { read: 22, write: 26, query: 30, scan: 48, ingest: 18 },
  'kv-store': { read: 1, write: 2, query: 55, scan: 85, ingest: 3 }
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function defaultStorageLatencyMs(componentType: ComponentType, operation: StorageOperation): number {
  const profile = DEFAULT_STORAGE_PROFILE_MS[componentType as keyof typeof DEFAULT_STORAGE_PROFILE_MS]
  return profile?.[operation] ?? DEFAULT_STORAGE_PROFILE_MS['relational-db'][operation]
}

function configuredStorageLatencyMs(
  config: Record<string, unknown> | undefined,
  componentType: ComponentType,
  operation: StorageOperation
): number {
  return (
    asPositiveNumber(config?.[STORAGE_OPERATION_FIELDS[operation]]) ??
    defaultStorageLatencyMs(componentType, operation)
  )
}

function classifyRequestOperation(request: Request): StorageOperation {
  const normalized = request.type.trim().toLowerCase()

  if (
    normalized.includes('ingest') ||
    normalized.includes('publish') ||
    normalized.includes('append') ||
    normalized.includes('event') ||
    normalized.includes('metric') ||
    normalized.includes('log') ||
    normalized.includes('bulk')
  ) {
    return 'ingest'
  }

  if (
    normalized.includes('scan') ||
    normalized.includes('export') ||
    normalized.includes('report') ||
    normalized.includes('analytics')
  ) {
    return 'scan'
  }

  if (
    normalized.includes('query') ||
    normalized.includes('search') ||
    normalized.includes('lookup') ||
    normalized.includes('find') ||
    normalized.includes('vector') ||
    normalized.includes('travers') ||
    normalized.includes('autocomplete')
  ) {
    return 'query'
  }

  if (
    normalized.includes('write') ||
    normalized.includes('put') ||
    normalized.includes('post') ||
    normalized.includes('create') ||
    normalized.includes('insert') ||
    normalized.includes('update')
  ) {
    return 'write'
  }

  return 'read'
}

function fieldVisible(operation: StorageOperation, componentType: ComponentType | undefined): boolean {
  if (componentType === undefined) {
    return operation === 'read' || operation === 'write'
  }

  if (operation === 'query') {
    return QUERY_PROFILE_COMPONENT_TYPES.has(componentType)
  }
  if (operation === 'scan') {
    return SCAN_PROFILE_COMPONENT_TYPES.has(componentType)
  }
  if (operation === 'ingest') {
    return INGEST_PROFILE_COMPONENT_TYPES.has(componentType)
  }

  return true
}

function placeholder(operation: StorageOperation, data: CanvasNodeDataV2): string {
  const field = STORAGE_OPERATION_FIELDS[operation]
  const configured = asPositiveNumber(data.sim?.[field as keyof NonNullable<CanvasNodeDataV2['sim']>])
  const fallback = defaultStorageLatencyMs(data.componentType, operation)
  const value = configured ?? fallback
  return `Default ${operation}: ${value.toFixed(1)}ms`
}

function metricCounter(operation: StorageOperation): Record<string, number> {
  return { [STORAGE_COUNTERS[operation]]: 1 }
}

export const storageProfileTrait: NodeBehaviourTrait = {
  name: 'storage.profile',
  beforeArrival: ({ node, request }) => {
    const operation = classifyRequestOperation(request)
    const latencyMs = configuredStorageLatencyMs(node.config, node.type, operation)
    request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = {
      type: 'constant',
      value: latencyMs
    }

    return {
      action: 'continue',
      payload: {
        storageOperation: operation,
        storageLatencyMs: latencyMs,
        metricCounters: metricCounter(operation),
        serviceTimeOverrideFor: `storage:${operation}`
      }
    }
  }
}

export const storageProfileCapabilityModule: NodeCapabilityModule = {
  name: 'storage.profile',
  appliesTo: STORAGE_PROFILE_COMPONENT_TYPES,
  hooks: storageProfileTrait,
  config: {
    sections: [
      {
        id: 'storage-profile',
        title: 'Storage Profile',
        note: 'This store no longer behaves like a generic queue. Different request types can pay different service times, so store-fit decisions become visible in the simulation instead of living only in rubric text.',
        noteTone: 'info',
        fields: (['read', 'write', 'query', 'scan', 'ingest'] as const).map((operation) => ({
          path: `sim.${STORAGE_OPERATION_FIELDS[operation]}`,
          type: 'input',
          label: STORAGE_OPERATION_LABELS[operation],
          step: 0.1,
          unit: 'ms',
          altitude: operation === 'read' || operation === 'write' ? 'primary' : 'advanced',
          visible: (data) => fieldVisible(operation, data.componentType),
          placeholder: (data) => placeholder(operation, data),
          why:
            operation === 'read'
              ? 'Overrides the default point-read latency for this store type.'
              : operation === 'write'
                ? 'Overrides the default write-path latency for this store type.'
                : operation === 'query'
                  ? 'Controls heavier query/traversal/search-style requests on this store.'
                  : operation === 'scan'
                    ? 'Controls large scans and analytics-style sweeps over stored data.'
                    : 'Controls append/ingest style workloads where this store is write-optimized.'
        }))
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: Object.values(STORAGE_COUNTERS)
  },
  honesty: {
    simulates: ['per-store operation-specific service-time curves'],
    notModeled: ['quorums, freshness/staleness windows, lock contention, compaction internals']
  }
}
