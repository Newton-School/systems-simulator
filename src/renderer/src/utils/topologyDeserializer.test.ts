import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../../../engine/core/types'
import { convertNestedToFlat } from './nodeTransformers'
import {
  deserializeTopology,
  deserializeTopologyText,
  isImportFailure,
  layoutTopology,
  parseJsonText,
  type TopologyImportFailure,
  type TopologyImportSuccess
} from './topologyDeserializer'

function edge(id: string, source: string, target: string): TopologyJSON['edges'][number] {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 2 }, pathType: 'same-dc' },
    bandwidth: 1000,
    maxConcurrentRequests: 1000,
    packetLossRate: 0,
    errorRate: 0
  }
}

const BASE: TopologyJSON = {
  id: 'three-tier',
  name: 'Three tier',
  version: '2.1.0',
  global: {
    simulationDuration: 10_000,
    warmupDuration: 1_000,
    seed: 'seed',
    defaultTimeout: 5_000,
    timeResolution: 'millisecond'
  },
  nodes: [
    {
      id: 'client',
      type: 'api-endpoint',
      category: 'compute',
      label: 'Client',
      position: { x: 0, y: 0 }
    },
    {
      id: 'api',
      type: 'microservice',
      category: 'compute',
      label: 'API',
      position: { x: 300, y: 0 },
      queue: { workers: 8, capacity: 100, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 5 }, timeout: 1_000 }
    },
    {
      id: 'db',
      type: 'relational-db',
      category: 'storage-and-data',
      label: 'DB',
      position: { x: 600, y: 0 },
      queue: { workers: 4, capacity: 50, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 8 }, timeout: 1_000 }
    }
  ],
  edges: [edge('client-api', 'client', 'api'), edge('api-db', 'api', 'db')],
  workload: {
    sourceNodeId: 'client',
    pattern: 'constant',
    baseRps: 50,
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 512 }]
  }
}

function ok(result: ReturnType<typeof deserializeTopology>): TopologyImportSuccess {
  if (isImportFailure(result)) {
    throw new Error(result.errors.map((error) => error.message).join('\n'))
  }
  return result
}

function failed(result: ReturnType<typeof deserializeTopology>): TopologyImportFailure {
  if (!isImportFailure(result)) throw new Error('expected the import to fail')
  return result
}

function withoutPositions(topology: TopologyJSON): unknown {
  return {
    ...topology,
    nodes: topology.nodes.map((node) => {
      const copy: Partial<TopologyJSON['nodes'][number]> = { ...node }
      delete copy.position
      return copy
    })
  }
}

describe('parseJsonText', () => {
  it('reports empty input and syntax errors in plain words', () => {
    expect(parseJsonText('   ')).toEqual({
      ok: false,
      error: 'There is no JSON to import. Paste a TopologyJSON document.'
    })
    const bad = parseJsonText('{"nodes": [')
    expect(bad.ok).toBe(false)
    expect('error' in bad && bad.error).toMatch(/^This is not valid JSON \(/)
  })
})

describe('deserializeTopology', () => {
  it('imports a valid topology into canvas data, keeping saved positions', () => {
    const result = ok(deserializeTopology(BASE))
    expect(result.nodesImported).toBe(3)
    expect(result.edgesImported).toBe(2)
    expect(result.autoLaidOut).toBe(false)
    expect(result.problems).toEqual([])

    const nodes = convertNestedToFlat(result.canvas.nodes)
    expect(nodes.map((node) => node.id)).toEqual(['client', 'api', 'db'])
    expect(nodes.find((node) => node.id === 'db')?.position).toEqual({ x: 600, y: 0 })
    expect(result.canvas.edges.map((edge) => edge.id)).toEqual(['client-api', 'api-db'])
    expect(result.canvas.scenario?.selectedSourceNodeId).toBe('client')
    expect(result.canvas.scenario?.topologyMeta).toMatchObject({ id: 'three-tier' })
  })

  it('does not mutate its input', () => {
    const input = structuredClone(withoutPositions(BASE))
    const before = JSON.stringify(input)
    ok(deserializeTopology(input))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('rejects input that is not a topology object', () => {
    expect(failed(deserializeTopology([1, 2])).errors[0]?.message).toMatch(
      /not a TopologyJSON document/
    )
    expect(failed(deserializeTopologyText('nope')).errors[0]?.message).toMatch(/not valid JSON/)
  })

  it('words schema errors with the subject they belong to, not raw paths', () => {
    const broken = structuredClone(BASE)
    ;(broken.nodes[1] as unknown as Record<string, unknown>).queue = {
      workers: -1,
      capacity: 100,
      discipline: 'fifo'
    }
    const { errors } = failed(deserializeTopology(broken))
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.message.startsWith('API:')).toBe(true)
    expect(errors[0]?.message).not.toMatch(/nodes\[|\.queue\./)
  })

  it('blocks duplicate component IDs and connections to missing components', () => {
    const duplicate = structuredClone(BASE)
    duplicate.nodes[2] = { ...duplicate.nodes[2]!, id: 'api' }
    expect(
      failed(deserializeTopology(duplicate)).errors.some((error) =>
        error.message.includes("already uses the ID 'api'")
      )
    ).toBe(true)

    const dangling = structuredClone(BASE)
    dangling.edges.push(edge('api-cache', 'api', 'cache'))
    expect(
      failed(deserializeTopology(dangling)).errors.some((error) =>
        error.message.includes("Its target component 'cache' does not exist.")
      )
    ).toBe(true)
  })

  it('imports a well-formed but unrunnable design and reports its problems', () => {
    const noWorkload = structuredClone(BASE)
    noWorkload.edges.push(edge('db-api', 'db', 'api'))
    const result = ok(deserializeTopology(noWorkload))
    expect(result.problems.length).toBeGreaterThan(0)
    expect(result.nodesImported).toBe(3)
  })

  it('auto-lays out a topology whose positions are missing', () => {
    const result = ok(deserializeTopology(withoutPositions(BASE)))
    expect(result.autoLaidOut).toBe(true)
    const nodes = convertNestedToFlat(result.canvas.nodes)
    const x = (id: string) => nodes.find((node) => node.id === id)!.position.x
    // Layered left-to-right in request order.
    expect(x('client')).toBeLessThan(x('api'))
    expect(x('api')).toBeLessThan(x('db'))
    const keys = new Set(nodes.map((node) => `${node.position.x},${node.position.y}`))
    expect(keys.size).toBe(nodes.length)
  })

  it('lays children out inside their containers and sizes the containers to fit', () => {
    const regional: TopologyJSON = {
      ...structuredClone(BASE),
      locations: [
        {
          id: 'region',
          kind: 'region',
          label: 'Region',
          provider: 'custom',
          coordinates: { latitude: 1, longitude: 2 }
        },
        { id: 'az', kind: 'availability-zone', label: 'Zone A', parentId: 'region' }
      ],
      nodes: BASE.nodes.map((node) =>
        node.id === 'client'
          ? node
          : { ...node, placement: { regionId: 'region', availabilityZoneId: 'az' } }
      )
    }
    const laidOut = layoutTopology(withoutPositions(regional) as TopologyJSON)
    const zone = laidOut.locations!.find((location) => location.id === 'az')!
    const region = laidOut.locations!.find((location) => location.id === 'region')!
    expect(zone.size!.width).toBeGreaterThan(0)
    expect(region.size!.width).toBeGreaterThan(zone.size!.width)

    const regionOrigin = region.position!
    const zoneOrigin = {
      x: regionOrigin.x + zone.position!.x,
      y: regionOrigin.y + zone.position!.y
    }
    for (const id of ['api', 'db']) {
      const position = laidOut.nodes.find((node) => node.id === id)!.position
      expect(position.x).toBeGreaterThanOrEqual(zoneOrigin.x)
      expect(position.x).toBeLessThan(zoneOrigin.x + zone.size!.width)
      expect(position.y).toBeGreaterThanOrEqual(zoneOrigin.y)
      expect(position.y).toBeLessThan(zoneOrigin.y + zone.size!.height)
    }

    const canvasNodes = convertNestedToFlat(
      ok(deserializeTopology(withoutPositions(regional))).canvas.nodes
    )
    expect(canvasNodes.find((node) => node.id === 'api')?.parentNode).toBe('az')
  })

  it('keeps an engine type with no canvas component of its own', () => {
    const external = structuredClone(BASE)
    external.nodes[2] = {
      id: 'pay',
      type: 'payment-gateway',
      category: 'external-and-integration',
      label: 'Payments',
      position: { x: 600, y: 0 },
      queue: { workers: 1, capacity: 10, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 20 }, timeout: 500 }
    }
    external.edges[1] = edge('api-pay', 'api', 'pay')
    const result = ok(deserializeTopology(external))
    const pay = convertNestedToFlat(result.canvas.nodes).find((node) => node.id === 'pay')
    expect(pay?.data.topologyCarry).toMatchObject({
      type: 'payment-gateway',
      category: 'external-and-integration'
    })
  })
})
