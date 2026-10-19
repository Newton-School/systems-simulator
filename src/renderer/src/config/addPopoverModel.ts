import type { CatalogCategory, CatalogItem } from '@renderer/types/ui'
import { BUILDER_TEMPLATE_IDS } from './catalogFilter'

/** Words a builder tile should answer to, beyond its own label. */
const BUILDER_SEARCH_ALIASES = 'builder build create custom definition your own'

export interface AddPopoverModel {
  /** The short row shown first: what this question most likely needs. */
  suggested: CatalogItem[]
  /** Everything else, grouped. Shown collapsed, or expanded as search results. */
  categories: CatalogCategory[]
  /** Tiles that open a definition builder (Service, Custom Node, My Services), if offered. */
  builders: CatalogItem[]
  /** A query is active: results span the whole catalog and replace the suggested row. */
  searching: boolean
}

function onlyBuilders(categories: readonly CatalogCategory[]): CatalogItem[] {
  return categories
    .flatMap((category) => category.items)
    .filter((item) => BUILDER_TEMPLATE_IDS.has(item.templateId))
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
 * Definition builders open a modal rather than placing a node, so they sit apart under their
 * own "Build your own" heading instead of among the placeable components.
 */
function matchesWords(item: CatalogItem, category: string, words: readonly string[]): boolean {
  const haystack = [
    item.label,
    item.subLabel,
    category,
    BUILDER_TEMPLATE_IDS.has(item.templateId) ? BUILDER_SEARCH_ALIASES : ''
  ]
    .join(' ')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** Keep the items matching every word of the query, in any order and across fields. */
function filterByWords(categories: readonly CatalogCategory[], query: string): CatalogCategory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...categories]
  return categories
    .map((category) => ({
      ...category,
      items: category.items.filter((item) => matchesWords(item, category.title, words))
    }))
    .filter((category) => category.items.length > 0)
}

/**
 * Lay out the Add popover from the library's own unfiltered results: the Common set up top and
 * the full catalog behind collapsed categories. A question that already curates the palette
 * (allow-list or Classroom) is its own suggested set, so there is nothing more to browse.
 * Definition builders open a modal rather than placing a node, so they sit apart under their
 * own "Build your own" heading, and searching matches them by word ("service builder").
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
  if (query.trim().length > 0) {
    const matches = filterByWords(all, query)
    return {
      suggested: [],
      categories: withoutBuilders(matches),
      builders: onlyBuilders(matches),
      searching: true
    }
  }
  const allItems = withoutBuilders(all)
  if (curated) {
    return {
      suggested: flatten(allItems),
      categories: [],
      builders: onlyBuilders(all),
      searching: false
    }
  }
  return {
    suggested: flatten(withoutBuilders(common)),
    categories: allItems,
    builders: onlyBuilders(all),
    searching: false
  }
}
