import { PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'

const DEFAULT_VISIBLE_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'generic-service',
  'my-service',
  'custom-node-builder',
  'connection-server'
])

/**
 * The initially curated palette. This intentionally matches the V1 component-type
 * allowlist so existing users see the same library until they opt into the full one.
 */
export const DEFAULT_COMPONENT_LIBRARY_NODE_TYPES: ReadonlySet<string> = new Set([
  'api-endpoint',
  // The generic 'load-balancer' is retired from the palette; the default library
  // now offers the L4/L7 pair so a load balancer is available out-of-box and the
  // transport-vs-application distinction is visible without switching to the full
  // library.
  'load-balancer-l4',
  'load-balancer-l7',
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
  if (DEFAULT_VISIBLE_TEMPLATE_IDS.has(templateId)) return true
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
