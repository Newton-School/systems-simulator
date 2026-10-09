import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'

/** Small builders for engine-level trait tests. */
export function testNode(
  id: string,
  type: string,
  serviceMs: number,
  extra: Partial<ComponentNode> = {}
): ComponentNode {
  return {
    id,
    type,
    category: 'compute',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 64, capacity: 1000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: serviceMs }, timeout: 5000 },
    ...extra
  } as ComponentNode
}

export function testEdge(
  source: string,
  target: string,
  extra: Partial<EdgeDefinition> = {}
): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 10000,
    maxConcurrentRequests: 10000,
    packetLossRate: 0,
    errorRate: 0,
    ...extra
  } as EdgeDefinition
}

export function testTopology(
  nodes: ComponentNode[],
  edges: EdgeDefinition[],
  baseRps: number,
  durationMs: number
): TopologyJSON {
  return {
    id: 'trait-test',
    name: 'trait-test',
    version: '1.0.0',
    global: {
      simulationDuration: durationMs,
      seed: 's',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 5000
    },
    nodes: [
      {
        id: 'src',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'src',
        position: { x: 0, y: 0 }
      } as ComponentNode,
      ...nodes
    ],
    edges,
    workload: {
      sourceNodeId: 'src',
      pattern: 'constant',
      baseRps,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 256 }]
    }
  } as TopologyJSON
}
