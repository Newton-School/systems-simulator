import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { ComponentType } from '../core/types'
import { asDistributionConfig, SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const READ_WRITE_SPLIT_COMPONENT_TYPES = [
  'relational-db'
] as const satisfies readonly ComponentType[]

function isReadReplica(config: Record<string, unknown> | undefined): boolean {
  return config?.['replicationRole'] === 'replica'
}

function isReadReplicaNode(data: CanvasNodeDataV2): boolean {
  return data.sim?.replicationRole === 'replica' || data.templateId === 'read-replica'
}

function meanServiceTimeMs(data: CanvasNodeDataV2): number | null {
  const distribution = data.sim?.processing?.distribution
  if (!distribution) {
    return null
  }

  if (distribution.type === 'constant') {
    return distribution.value
  }

  if (distribution.type === 'exponential' && distribution.lambda > 0) {
    return 1 / distribution.lambda
  }

  if (distribution.type === 'normal') {
    return distribution.mean
  }

  return null
}

function serviceTimeFallbackText(data: CanvasNodeDataV2): string {
  const mean = meanServiceTimeMs(data)
  return mean === null
    ? 'Uses the node mean service time when empty.'
    : `Uses mean service time (${mean.toFixed(1)}ms) when empty.`
}

/**
 * Overrides the sampled service-time distribution by request.type. Read
 * Replicas opt out — ReadOnlyTrait owns their behaviour instead — since both
 * "Primary DB" and "Read Replica" share the `relational-db` component type
 * and are only distinguished by the explicit `replicationRole` config knob.
 */
export const readWriteSplitTrait: NodeBehaviourTrait = {
  name: 'db.read-write-split',
  beforeArrival: ({ node, request }) => {
    if (isReadReplica(node.config)) {
      return { action: 'continue' }
    }

    const readLatency = asDistributionConfig(node.config?.['readLatency'])
    const writeLatency = asDistributionConfig(node.config?.['writeLatency'])

    const override =
      request.type === 'write' ? writeLatency : request.type === 'read' ? readLatency : null

    if (!override) {
      return { action: 'continue' }
    }

    request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = override
    return { action: 'continue', payload: { serviceTimeOverrideFor: request.type } }
  }
}

export const readWriteSplitCapabilityModule: NodeCapabilityModule = {
  name: 'db.read-write-split',
  appliesTo: READ_WRITE_SPLIT_COMPONENT_TYPES,
  hooks: readWriteSplitTrait,
  config: {
    sections: [
      {
        id: 'read-write',
        title: 'Read/Write',
        fields: [
          {
            path: 'sim.readLatencyMs',
            type: 'input',
            label: 'Read latency',
            step: 0.1,
            unit: 'ms',
            placeholder: serviceTimeFallbackText,
            visible: (data) => !isReadReplicaNode(data),
            why: 'Optional override for read requests. Leave empty to use the node mean service time.'
          },
          {
            path: 'sim.writeLatencyMs',
            type: 'input',
            label: 'Write latency',
            step: 0.1,
            unit: 'ms',
            placeholder: serviceTimeFallbackText,
            visible: (data) => !isReadReplicaNode(data),
            why: 'Optional override for write requests. Leave empty to use the node mean service time.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['different service-time distributions for reads and writes'],
    notModeled: ['replication lag, lock contention, WAL/fsync internals']
  }
}
