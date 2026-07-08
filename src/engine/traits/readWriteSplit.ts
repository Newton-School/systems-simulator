import type { ComponentType } from '../core/types'
import { asDistributionConfig, SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait } from './types'

export const READ_WRITE_SPLIT_COMPONENT_TYPES = [
  'relational-db'
] as const satisfies readonly ComponentType[]

function isReadReplica(config: Record<string, unknown> | undefined): boolean {
  return config?.['replicationRole'] === 'replica'
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
