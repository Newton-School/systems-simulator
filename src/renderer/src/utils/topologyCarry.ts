import type { ComponentNode } from '../../../engine/core/types'
import type { TopologyNodeCarry } from '../../../engine/catalog/nodeSpecTypes'

/**
 * Lossless TopologyJSON import support.
 *
 * The canvas models most, but not all, engine fields (an imported question-bank
 * node can carry config keys or whole sections no editor exposes). On import we
 * record the parts of the source node the canvas would not reproduce; on export
 * the serializer fills them back in. Only *missing* fields are filled, so any
 * value the canvas produces - including one the user just edited - wins.
 */

/** Node fields the canvas always owns; never carried. */
const CANVAS_OWNED_KEYS = new Set<string>([
  'id',
  'type',
  'category',
  'role',
  'label',
  'position',
  'placement'
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The parts of `original` that are absent from `produced`, recursing into
 * plain objects. Present-but-different values are not included: the canvas
 * value is authoritative for anything it produces.
 */
export function missingParts(
  original: Record<string, unknown>,
  produced: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) continue
    const producedValue = produced?.[key]
    if (producedValue === undefined) {
      result[key] = structuredClone(value)
    } else if (isPlainObject(value) && isPlainObject(producedValue)) {
      const nested = missingParts(value, producedValue)
      if (nested) result[key] = nested
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Fills keys of `extra` that are missing from `target` (in place), recursing into objects. */
export function fillMissing(target: Record<string, unknown>, extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) continue
    const current = target[key]
    if (current === undefined) {
      target[key] = structuredClone(value)
    } else if (isPlainObject(current) && isPlainObject(value)) {
      const copy = { ...current }
      fillMissing(copy, value)
      target[key] = copy
    }
  }
}

/** The node fields of `original` the canvas serialization (`produced`) did not reproduce. */
export function deriveNodeExtra(
  original: ComponentNode,
  produced: ComponentNode | null
): Partial<ComponentNode> | undefined {
  const source: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(original)) {
    if (!CANVAS_OWNED_KEYS.has(key)) source[key] = value
  }
  return missingParts(source, produced as unknown as Record<string, unknown> | undefined) as
    | Partial<ComponentNode>
    | undefined
}

/** Applies a node's import carry to its freshly serialized engine node (in place). */
export function applyTopologyCarry(
  node: ComponentNode,
  carry: TopologyNodeCarry | undefined
): ComponentNode {
  if (!carry) return node
  if (carry.type) node.type = carry.type
  if (carry.category) node.category = carry.category
  if (carry.role) node.role = carry.role
  if (carry.extra) fillMissing(node as unknown as Record<string, unknown>, carry.extra)
  return node
}
