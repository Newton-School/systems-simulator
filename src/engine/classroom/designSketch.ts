import type { ComponentNode, TopologyJSON } from '../core/types'
import { conceptCardForType } from './conceptCards'
import type { ClassroomDesignSketch } from './types'

/** Turns a lecture/probe sketch into a deterministic raw Classroom topology. */
export function classroomSketchToTopology(
  sketch: ClassroomDesignSketch,
  peakRps: number,
  id = 'classroom-sketch'
): TopologyJSON {
  const nodes: ComponentNode[] = sketch.nodes.map((item, index) => {
    const card = conceptCardForType(item.component)
    if (!card) throw new Error(`No Classroom card covers '${item.component}'.`)
    const marker = {
      card: card.id,
      copies: item.copies ?? 1,
      ...(item.choices ? { choices: item.choices } : {})
    }
    return {
      id: item.ref,
      type: item.component,
      category:
        card.nodeRole === 'storage'
          ? 'storage'
          : card.role === 'passthrough'
            ? 'network'
            : 'compute',
      role:
        card.nodeRole ??
        (card.role === 'source' ? 'source' : card.role === 'passthrough' ? 'router' : 'processor'),
      label: card.label,
      position: { x: 100 + index * 220, y: 180 },
      ...(card.copies
        ? {
            resources: {
              instanceType: 'm5.large',
              instanceCount: item.copies ?? 1,
              workloadKind: 'io-bound'
            }
          }
        : {}),
      config: { classroom: marker }
    } as ComponentNode
  })
  const sourceNodeId = nodes.find((node) => node.role === 'source')?.id
  return {
    id,
    name: id,
    version: '1',
    global: {
      simulationDuration: 10_000,
      seed: id,
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 30_000
    },
    nodes,
    edges: sketch.edges.map(([source, target], index) => ({
      id: `${id}-edge-${index + 1}`,
      source,
      target,
      mode: 'synchronous',
      protocol: 'https',
      latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-rack' },
      bandwidth: Number.MAX_SAFE_INTEGER,
      maxConcurrentRequests: Number.MAX_SAFE_INTEGER,
      packetLossRate: 0,
      errorRate: 0
    })),
    ...(sourceNodeId
      ? {
          workload: {
            sourceNodeId,
            pattern: 'constant',
            baseRps: peakRps,
            requestDistribution: [{ type: 'read', weight: 1, sizeBytes: 100 }]
          }
        }
      : {})
  }
}
