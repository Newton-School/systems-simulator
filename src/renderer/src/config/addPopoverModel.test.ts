import { describe, expect, it } from 'vitest'
import type { CatalogCategory, CatalogItem } from '@renderer/types/ui'
import { buildAddPopoverModel } from './addPopoverModel'

const item = (id: string, templateId = id): CatalogItem => ({ id, templateId }) as CatalogItem
const category = (id: string, ...items: CatalogItem[]): CatalogCategory => ({
  id,
  title: id,
  items
})

const common = [category('traffic', item('cdn'), item('api-gateway'))]
const all = [
  category('traffic', item('cdn'), item('api-gateway'), item('dns')),
  category('data', item('primary-db'), item('generic-service'))
]

describe('buildAddPopoverModel', () => {
  it('suggests the Common set and keeps the full catalog as categories', () => {
    const model = buildAddPopoverModel({ common, all, curated: false, query: '' })
    expect(model.suggested.map((i) => i.id)).toEqual(['cdn', 'api-gateway'])
    expect(model.categories.map((c) => c.id)).toEqual(['traffic', 'data'])
    expect(model.searching).toBe(false)
  })

  it('keeps definition builders apart from placeable components', () => {
    const model = buildAddPopoverModel({ common, all, curated: false, query: '' })
    expect(model.categories.flatMap((c) => c.items.map((i) => i.id))).not.toContain(
      'generic-service'
    )
    expect(model.builders.map((i) => i.id)).toEqual(['generic-service'])
  })

  it('offers no builders while searching', () => {
    expect(buildAddPopoverModel({ common, all, curated: false, query: 'db' }).builders).toEqual([])
  })

  it('treats a curated palette as the suggested set with nothing to browse', () => {
    const model = buildAddPopoverModel({ common, all, curated: true, query: '' })
    expect(model.suggested.map((i) => i.id)).toEqual(['cdn', 'api-gateway', 'dns', 'primary-db'])
    expect(model.categories).toEqual([])
  })

  it('replaces the suggested row with whole-catalog results while searching', () => {
    const model = buildAddPopoverModel({ common, all, curated: false, query: ' db ' })
    expect(model.searching).toBe(true)
    expect(model.suggested).toEqual([])
    expect(model.categories.length).toBe(2)
  })
})
