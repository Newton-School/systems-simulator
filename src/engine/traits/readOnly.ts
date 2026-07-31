import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const READ_ONLY_COMPONENT_TYPES = [
  'relational-db'
] as const satisfies readonly ComponentType[]

function isReadReplica(config: Record<string, unknown> | undefined): boolean {
  return config?.['replicationRole'] === 'replica'
}

function isReadReplicaNode(data: CanvasNodeDataV2): boolean {
  return data.sim?.replicationRole === 'replica' || data.templateId === 'read-replica'
}

/**
 * Only acts on nodes explicitly configured as a replica — "Primary DB" and
 * "Read Replica" share the `relational-db` component type, so this trait is
 * registered for every relational DB but no-ops unless replicationRole says
 * otherwise.
 */
export const readOnlyTrait: NodeBehaviourTrait = {
  name: 'db.read-only',
  beforeArrival: ({ node, request }) => {
    if (!isReadReplica(node.config)) {
      return { action: 'continue' }
    }

    if (request.type === 'write') {
      return { action: 'rejected', reason: 'read_only_node' }
    }

    return { action: 'continue' }
  }
}

export const readOnlyCapabilityModule: NodeCapabilityModule = {
  name: 'db.read-only',
  appliesTo: READ_ONLY_COMPONENT_TYPES,
  hooks: readOnlyTrait,
  config: {
    sections: [
      {
        id: 'replica-role',
        title: 'Role',
        fields: [],
        note: (data) =>
          isReadReplicaNode(data)
            ? 'This node is a read-only replica. Write requests are rejected before processing.'
            : null,
        noteTone: 'info'
      }
    ]
  },
  defaults: [],
  metrics: {
    rejectionReasons: ['read_only_node']
  },
  honesty: {
    simulates: ['read-replica write rejection'],
    notModeled: ['staleness windows, promotion/failover behavior']
  }
}
