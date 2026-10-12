import { describe, expect, it } from 'vitest'
import { CATALOG_CONFIG } from './catalogConfig'
import { filterCatalogCategories } from './catalogFilter'

function visibleIds(constraints: {
  allowedNodeTypes?: string[] | null
  forbiddenNodeTypes?: string[] | null
}): string[] {
  return filterCatalogCategories(CATALOG_CONFIG, {
    query: '',
    filter: 'all',
    editPaletteList: null,
    allowedNodeTypes: constraints.allowedNodeTypes ?? null,
    forbiddenNodeTypes: constraints.forbiddenNodeTypes ?? null,
    componentLibraryMode: 'all',
    hiddenTemplateIds: []
  }).flatMap((category) => category.items.map((item) => item.id))
}

describe('palette filtering by component family', () => {
  it('an allowed generic load-balancer offers the L4 and L7 tiles', () => {
    const ids = visibleIds({ allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'] })
    expect(ids).toContain('load-balancer-l4')
    expect(ids).toContain('load-balancer-l7')
  })

  it('an allowed L7 offers only the L7 tile', () => {
    const ids = visibleIds({ allowedNodeTypes: ['load-balancer-l7'] })
    expect(ids).toEqual(['load-balancer-l7'])
  })

  it('a forbidden generic load-balancer hides L4 and L7; a forbidden L4 hides only L4', () => {
    const generic = visibleIds({ forbiddenNodeTypes: ['load-balancer'] })
    expect(generic).not.toContain('load-balancer-l4')
    expect(generic).not.toContain('load-balancer-l7')
    const l4 = visibleIds({ forbiddenNodeTypes: ['load-balancer-l4'] })
    expect(l4).not.toContain('load-balancer-l4')
    expect(l4).toContain('load-balancer-l7')
  })
})
