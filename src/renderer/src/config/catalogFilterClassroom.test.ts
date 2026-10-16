import { describe, expect, it } from 'vitest'
import { CATALOG_CONFIG } from './catalogConfig'
import { filterCatalogCategories } from './catalogFilter'
import type { ClassroomSettings } from '../../../engine/classroom/types'

function classroomTiles(
  settings: ClassroomSettings | undefined,
  allowedNodeTypes: string[] | null = null
) {
  return filterCatalogCategories(CATALOG_CONFIG, {
    query: '',
    filter: 'common',
    editPaletteList: null,
    allowedNodeTypes,
    forbiddenNodeTypes: null,
    componentLibraryMode: 'default',
    hiddenTemplateIds: [],
    classroom: { settings }
  }).flatMap((category) => category.items)
}

describe('palette filtering in Classroom mode', () => {
  it('shows one tile per concept card, named in lecture language', () => {
    const tiles = classroomTiles(undefined)
    expect(tiles.map((tile) => tile.id).sort()).toEqual(
      [
        'api-gateway',
        'async-worker',
        'backend-server',
        'cdn',
        'input-source',
        'load-balancer-l7',
        'message-queue',
        'nosql-db',
        'primary-db',
        'redis-cache'
      ].sort()
    )
    expect(tiles.map((tile) => tile.label).sort()).toEqual(
      [
        'API Gateway',
        'Cache',
        'CDN',
        'Load Balancer',
        'NoSQL Database',
        'Queue',
        'SQL Database',
        'Server',
        'Users',
        'Worker'
      ].sort()
    )
  })

  it("describes a server with the question's givens", () => {
    const server = classroomTiles({
      givens: { microservice: { label: 'API Server', capacityRps: 100_000, costPerHour: 0.192 } }
    }).find((tile) => tile.id === 'backend-server')
    expect(server?.label).toBe('API Server')
    expect(server?.subLabel).toBe('100,000 req/s each')
    expect(server?.info.config).toEqual(['100,000 req/s each', '$0.192/hr each'])
  })

  it('still honours the question allow-list', () => {
    const tiles = classroomTiles(undefined, ['api-endpoint', 'microservice'])
    expect(tiles.map((tile) => tile.id).sort()).toEqual(['backend-server', 'input-source'])
  })
})
