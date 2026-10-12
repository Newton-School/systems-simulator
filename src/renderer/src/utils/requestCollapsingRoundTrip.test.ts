import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../../../engine/core/types'
import stampedeSample from '../../../engine/__samples__/topology/cache-stampede-request-collapsing.json'
import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import { topologyToCanvasFileData } from './topologyCanvasAdapter'

const STAMPEDE = stampedeSample as TopologyJSON

describe('request collapsing canvas round-trip', () => {
  it('hydrates requestCollapsing onto the canvas and serializes it back to engine config', () => {
    const canvas = topologyToCanvasFileData(STAMPEDE)
    const cache = canvas.nodes.find((node) => node.id === 'cache')!
    expect(cache.data.sim).toMatchObject({ cacheModel: 'derived-lru', requestCollapsing: true })

    const serialized = getComponentSpec('in-memory-cache')!.serializeCanvas(cache.data, {
      nodeId: 'cache',
      position: cache.position
    })!
    expect(serialized.config).toMatchObject({
      cacheModel: 'derived-lru',
      requestCollapsing: true
    })
  })

  it('serializes an explicit off toggle as false', () => {
    const canvas = topologyToCanvasFileData(STAMPEDE)
    const cache = canvas.nodes.find((node) => node.id === 'cache')!
    const serialized = getComponentSpec('in-memory-cache')!.serializeCanvas(
      { ...cache.data, sim: { ...cache.data.sim, requestCollapsing: false } },
      { nodeId: 'cache', position: cache.position }
    )!
    expect(serialized.config?.['requestCollapsing']).toBe(false)
  })
})
