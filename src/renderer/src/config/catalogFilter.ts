import type { CatalogCategory, CatalogItem, ComponentLibraryMode } from '@renderer/types/ui'
import { PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'
import { CANONICAL_TEMPLATE_ID_BY_COMPONENT_TYPE } from '../../../engine/analysis/authoringCapabilities'
import { isComponentLibraryItemVisible } from './componentLibraryVisibility'

export type ComponentLibraryFilter = 'all' | 'common'

/** The "Common" tab of the component library. */
export const COMMON_CATALOG_IDS: ReadonlySet<string> = new Set([
  'client-user',
  'api-gateway',
  'load-balancer-l7',
  'cdn',
  'backend-server',
  'auth-service',
  'primary-db',
  'redis-cache',
  'message-queue'
])

/**
 * Library items that open a definition builder instead of placing a node. They
 * cannot be dropped straight onto the canvas, so quick-add pickers skip them.
 */
export const BUILDER_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'generic-service',
  'my-service',
  'custom-node-builder'
])

export interface CatalogFilterOptions {
  query: string
  filter: ComponentLibraryFilter
  /** Environment palette allow-list (node types or template ids); null = no limit. */
  editPaletteList: readonly string[] | null
  allowedNodeTypes?: readonly string[] | null
  forbiddenNodeTypes?: readonly string[] | null
  componentLibraryMode: ComponentLibraryMode
  hiddenTemplateIds: readonly string[]
  /** Extra per-item predicate (e.g. "valid inside this container"). */
  include?: (item: CatalogItem) => boolean
  /**
   * Items shown even when the curated (default) library hides them. Still subject
   * to hidden ids, the palette, and question allow/deny lists.
   */
  ignoreLibraryModeFor?: (item: CatalogItem) => boolean
}

export function matchesCatalogSearch(item: CatalogItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  return (
    !trimmed ||
    item.label.toLowerCase().includes(trimmed) ||
    item.subLabel.toLowerCase().includes(trimmed)
  )
}

/**
 * The component library's filtering rules, shared by the sidebar library and the
 * on-canvas quick-add picker so both offer exactly the same components.
 */
export function filterCatalogCategories(
  categories: readonly CatalogCategory[],
  options: CatalogFilterOptions
): CatalogCategory[] {
  const trimmed = options.query.trim()
  const allowedPalette = options.editPaletteList === null ? null : new Set(options.editPaletteList)
  const allowed = options.allowedNodeTypes ? new Set(options.allowedNodeTypes) : null
  const forbidden = options.forbiddenNodeTypes ? new Set(options.forbiddenNodeTypes) : null
  // A question allow-list turns the palette into a strict, curated set: only the
  // author's chosen types, one canonical item each, and no Common/All scoping.
  const hasQuestionAllowlist = allowed !== null

  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => {
        const componentType = PALETTE_TEMPLATES[item.id]?.componentType
        // With an allow-list, ignore the Common/All tab entirely. Otherwise an
        // active search spans the whole catalog so you never have to switch tabs.
        const matchesFilter =
          hasQuestionAllowlist ||
          options.filter === 'all' ||
          trimmed.length > 0 ||
          COMMON_CATALOG_IDS.has(item.id)
        const matchesPalette =
          allowedPalette === null || allowedPalette.has(item.type) || allowedPalette.has(item.id)
        const matchesLibraryVisibility = isComponentLibraryItemVisible({
          templateId: item.id,
          mode: options.ignoreLibraryModeFor?.(item) ? 'all' : options.componentLibraryMode,
          hiddenTemplateIds: options.hiddenTemplateIds
        })
        // Show exactly the author's picks: the one canonical template per allowed type.
        const matchesQuestionAllowlist =
          allowed === null ||
          (componentType !== undefined &&
            allowed.has(componentType) &&
            CANONICAL_TEMPLATE_ID_BY_COMPONENT_TYPE[componentType] === item.id)
        const matchesQuestionDenylist =
          forbidden === null || componentType === undefined || !forbidden.has(componentType)

        return (
          matchesFilter &&
          matchesCatalogSearch(item, options.query) &&
          matchesPalette &&
          matchesLibraryVisibility &&
          matchesQuestionAllowlist &&
          matchesQuestionDenylist &&
          (options.include?.(item) ?? true)
        )
      })
    }))
    .filter((category) => category.items.length > 0)
}
