import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait } from './types'

export const READ_ONLY_COMPONENT_TYPES = ['relational-db'] as const satisfies readonly ComponentType[]

function isReadReplica(config: Record<string, unknown> | undefined): boolean {
  return config?.['replicationRole'] === 'replica'
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
