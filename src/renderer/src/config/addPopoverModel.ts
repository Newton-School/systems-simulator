import type { CatalogCategory, CatalogItem } from '@renderer/types/ui'
import { BUILDER_TEMPLATE_IDS } from './catalogFilter'

export interface AddPopoverModel {
  /** The short row shown first: what this question most likely needs. */
  suggested: CatalogItem[]
  /** Everything else, grouped. Shown collapsed, or expanded as search results. */
  categories: CatalogCategory[]
  /** A query is active: results span the whole catalog and replace the suggested row. */
  searching: boolean
}

function withoutBuilders(categories: readonly CatalogCategory[]): CatalogCategory[] {
  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => !BUILDER_TEMPLATE_IDS.has(item.templateId))
    }))
    .filter((category) => category.items.length > 0)
}

function flatten(categories: readonly CatalogCategory[]): CatalogItem[] {
  const seen = new Set<string>()
  const items: CatalogItem[] = []
  for (const item of categories.flatMap((category) => category.items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return items
}

/**
 * Lay out the Add popover from the library's own filtered results: the Common set up top and
 * the full catalog behind collapsed categories. A question that already curates the palette
 * (allow-list or Classroom) is its own suggested set, so there is nothing more to browse.
 * Definition builders open a modal rather than placing a node, so they stay out of the popover.
 */
export function buildAddPopoverModel({
  common,
  all,
  curated,
  query
}: {
  common: readonly CatalogCategory[]
  all: readonly CatalogCategory[]
  curated: boolean
  query: string
}): AddPopoverModel {
  const allItems = withoutBuilders(all)
  if (query.trim().length > 0) {
    return { suggested: [], categories: allItems, searching: true }
  }
  if (curated) {
    return { suggested: flatten(allItems), categories: [], searching: false }
  }
  return {
    suggested: flatten(withoutBuilders(common)),
    categories: allItems,
    searching: false
  }
}
