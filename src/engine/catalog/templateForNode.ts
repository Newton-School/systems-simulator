/**
 * Which palette template stands for an engine node: the one a fresh node of that type is built from, and
 * the one the canvas uses when it imports a document. Kept in the catalog so the importer and the engine's
 * default profile (capacityModel.ts) agree on it.
 */
import type { ComponentNode } from '../core/types'
import { PALETTE_TEMPLATES } from './paletteTemplates'
import type { PaletteTemplate } from './nodeSpecTypes'
import { getComponentSpec } from './componentSpecs'

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

export function pickTemplateForNode(node: ComponentNode): PaletteTemplate | null {
  if (node.type === 'relational-db') {
    const replicationRole = asString(node.config?.['replicationRole'])
    if (replicationRole === 'replica' || replicationRole === 'follower') {
      return PALETTE_TEMPLATES['read-replica']
    }
    return PALETTE_TEMPLATES['primary-db']
  }

  if (node.type === 'api-endpoint') {
    return PALETTE_TEMPLATES['client-user']
  }

  const candidates = Object.values(PALETTE_TEMPLATES).filter(
    (template) => template.serializable && template.componentType === node.type
  )

  if (candidates.length === 0) {
    return pickStandInTemplate(node)
  }

  return [...candidates].sort((left, right) => {
    const leftScore =
      (left.structuralRole === node.role ? 10 : 0) +
      (node.role === 'source' && left.profile === 'source' ? 5 : 0)
    const rightScore =
      (right.structuralRole === node.role ? 10 : 0) +
      (node.role === 'source' && right.profile === 'source' ? 5 : 0)
    return rightScore - leftScore
  })[0]
}

/**
 * An engine type with no palette template of its own (e.g. `kv-store`, or
 * `payment-gateway`, which has no canvas component at all) is rendered with the
 * closest template: same component profile, else same category. The real type
 * is restored on export through the node's topology carry.
 */
function pickStandInTemplate(node: ComponentNode): PaletteTemplate | null {
  const spec = getComponentSpec(node.type)
  const serializable = Object.values(PALETTE_TEMPLATES).filter(
    (template) =>
      template.serializable &&
      template.profile !== 'source' &&
      template.profile !== 'composite' &&
      getComponentSpec(template.componentType) !== undefined
  )
  const sameProfile = spec
    ? serializable.find(
        (template) =>
          getComponentSpec(template.componentType)?.profile === spec.profile &&
          template.category === node.category
      )
    : undefined
  const sameCategory = serializable.find((template) => template.category === node.category)
  return sameProfile ?? sameCategory ?? PALETTE_TEMPLATES['backend-server'] ?? null
}
