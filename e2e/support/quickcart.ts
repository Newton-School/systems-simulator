import type { TopologyJSON } from '../../src/engine/core/types'
import { edge } from './topology'

/**
 * QuickCart Flash Sale (builder-walkthrough.md): 1,000,000 req/s, each server unit 100,000 req/s
 * (128 workers / 1.28 ms), one load balancer, even split. The capacity is the authored contract.
 */
export function quickcart(serverCount: number): TopologyJSON {
  const servers = Array.from({ length: serverCount }, (_, i) => ({
    id: `srv-${i}`,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: `srv-${i}`,
    position: { x: 600, y: i * 40 },
    config: { capacityRps: 100_000, capacityAuthored: true }
  }))
  return {
    id: 'quickcart',
    name: `QuickCart ${serverCount}`,
    version: '1',
    global: {
      simulationDuration: 5000,
      seed: 'quickcart',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000
    },
    nodes: [
      {
        id: 'users',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'Users',
        position: { x: 0, y: 0 }
      },
      {
        id: 'lb',
        type: 'load-balancer',
        category: 'network',
        role: 'router',
        label: 'Load Balancer',
        position: { x: 300, y: 0 }
      },
      ...servers
    ],
    edges: [edge('users', 'lb'), ...servers.map((s) => edge('lb', s.id))],
    workload: {
      sourceNodeId: 'users',
      pattern: 'constant',
      baseRps: 1_000_000,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
}
