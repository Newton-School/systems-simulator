import { PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'

/**
 * The initially curated palette. This intentionally matches the V1 component-type
 * allowlist so existing users see the same library until they opt into the full one.
 */
export const DEFAULT_COMPONENT_LIBRARY_NODE_TYPES: ReadonlySet<string> = new Set([
  'api-endpoint',
  'load-balancer',
  'cdn',
  'microservice',
  'batch-worker',
  'queue',
  'message-broker',
  'in-memory-cache',
  'nosql-db',
  'relational-db',
  'time-series-db',
  'object-storage'
])

export function isInDefaultComponentLibrary(templateId: string): boolean {
  const componentType = PALETTE_TEMPLATES[templateId]?.componentType
  return componentType !== undefined && DEFAULT_COMPONENT_LIBRARY_NODE_TYPES.has(componentType)
}

export function isComponentLibraryItemVisible({
  templateId,
  mode,
  hiddenTemplateIds
}: {
  templateId: string
  mode: 'default' | 'all'
  hiddenTemplateIds: readonly string[]
}): boolean {
  return (
    (mode === 'all' || isInDefaultComponentLibrary(templateId)) &&
    !hiddenTemplateIds.includes(templateId)
  )
}
