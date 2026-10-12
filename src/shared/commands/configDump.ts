import type { TopologyJSON } from '../../engine/core/types'

/**
 * Flatten an engine object into `path = value` leaves for config dumps and
 * diffs. Arrays of primitives stay one leaf; arrays of objects index by `id`
 * when every item has one, by position otherwise.
 */
export function flattenConfig(value: unknown, prefix = ''): Array<[string, string]> {
  if (value === undefined) return []
  if (value === null || typeof value !== 'object') {
    return [[prefix, formatLeaf(value)]]
  }
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return [[prefix, JSON.stringify(value)]]
    }
    const keyed = value.every(
      (item) =>
        item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
    )
    return value.flatMap((item, index) =>
      flattenConfig(item, `${prefix}[${keyed ? (item as { id: string }).id : index}]`)
    )
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, child]) => child !== undefined
  )
  if (entries.length === 0) return [[prefix, '{}']]
  return entries.flatMap(([key, child]) => flattenConfig(child, prefix ? `${prefix}.${key}` : key))
}

function formatLeaf(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  return JSON.stringify(value)
}

/** Keys that are canvas layout, not configuration. */
const LAYOUT_KEYS = new Set([
  'position',
  'sourceHandle',
  'targetHandle',
  'presentation',
  'animated'
])

function withoutLayout<T extends object>(item: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => !LAYOUT_KEYS.has(key))
  ) as Partial<T>
}

/** Per-node / per-edge flattened config, layout keys removed. */
export function topologyConfigLeaves(topology: TopologyJSON): Map<string, string> {
  const leaves = new Map<string, string>()
  const add = (prefix: string, value: unknown): void => {
    for (const [path, leaf] of flattenConfig(value, prefix)) leaves.set(path, leaf)
  }
  add('global', topology.global)
  for (const node of topology.nodes) add(`node[${node.id}]`, withoutLayout(node))
  for (const edge of topology.edges) add(`edge[${edge.id}]`, withoutLayout(edge))
  if (topology.workload) add('workload', topology.workload)
  if (topology.faults && topology.faults.length > 0) add('faults', topology.faults)
  return leaves
}

export interface ConfigDiffEntry {
  kind: 'added' | 'removed' | 'changed'
  path: string
  before?: string
  after?: string
}

export function diffTopologyConfig(before: TopologyJSON, after: TopologyJSON): ConfigDiffEntry[] {
  const left = topologyConfigLeaves(before)
  const right = topologyConfigLeaves(after)
  const entries: ConfigDiffEntry[] = []
  for (const [path, value] of left) {
    if (!right.has(path)) entries.push({ kind: 'removed', path, before: value })
    else if (right.get(path) !== value) {
      entries.push({ kind: 'changed', path, before: value, after: right.get(path) })
    }
  }
  for (const [path, value] of right) {
    if (!left.has(path)) entries.push({ kind: 'added', path, after: value })
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}
