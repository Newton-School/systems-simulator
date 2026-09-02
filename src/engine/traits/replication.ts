import type { ComponentType } from '../core/types'
import {
  ReplicaCluster,
  type ConflictResolution,
  type ConsensusProtocol,
  type ReplicaMember
} from '../semantics/v2StateMachines'
import { SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const REPLICATION_COMPONENT_TYPES = [
  'relational-db',
  'nosql-db'
] as const satisfies readonly ComponentType[]

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

const CLUSTER_STATE_PREFIX = 'replication.cluster'

export function replicationClusterMembers(
  nodeId: string,
  config: Record<string, unknown> | undefined
): ReplicaMember[] {
  const configured = config?.['replicaMembers']
  const ids =
    typeof configured === 'string'
      ? configured
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      : []
  const members = ids.length > 0 ? ids : [nodeId]
  return members.map((id, index) => ({
    id,
    role: index === 0 ? 'leader' : 'follower',
    term: 1,
    appliedIndex: 0,
    durableIndex: 0
  }))
}

export function replicationClusterStateKey(
  nodeId: string,
  config: Record<string, unknown> | undefined
): string {
  const memberIds = replicationClusterMembers(nodeId, config)
    .map((member) => member.id)
    .sort()
  return `${CLUSTER_STATE_PREFIX}:${memberIds.join('|')}`
}

export function replicationConsensusProtocol(
  config: Record<string, unknown> | undefined
): ConsensusProtocol {
  return config?.['consensusProtocol'] === 'none' ? 'none' : 'raft'
}

function replicationConflictResolution(
  config: Record<string, unknown> | undefined
): ConflictResolution {
  return config?.['conflictResolution'] === 'highest-index-wins'
    ? 'highest-index-wins'
    : 'leader-wins'
}

export function createReplicationCluster(
  nodeId: string,
  config: Record<string, unknown> | undefined
): ReplicaCluster {
  return new ReplicaCluster(
    replicationClusterMembers(nodeId, config),
    replicationConsensusProtocol(config),
    replicationConflictResolution(config)
  )
}

function cluster(
  nodeId: string,
  config: Record<string, unknown> | undefined,
  state: TraitStateStore | undefined
): ReplicaCluster {
  const key = replicationClusterStateKey(nodeId, config)
  const existing = state?.get<ReplicaCluster>(key)
  if (existing) return existing
  const created = createReplicationCluster(nodeId, config)
  state?.set(key, created)
  return created
}

/**
 * Deliberately small primary/replica model: writes wait for their configured
 * acknowledgement boundary, replicas can expose bounded staleness, and a
 * configured failover window rejects traffic while promotion is in progress.
 */
export const replicationTrait: NodeBehaviourTrait = {
  name: 'storage.replication-boundary',
  beforeArrival: ({ node, request, clock, state, sharedState, nodeState }) => {
    if (node.config?.['replicationEnabled'] !== true) return { action: 'continue' }
    const replicaCluster = cluster(node.id, node.config, sharedState ?? state)
    const failoverUntilMs = positive(node.config?.['failoverUntilMs'], 0)
    if (failoverUntilMs > 0 && clock < BigInt(Math.round(failoverUntilMs * 1000))) {
      return {
        action: 'rejected',
        reason: 'replica_failover_in_progress',
        payload: {
          replicationFailoverInProgress: true,
          replicationLeader: replicaCluster.leader()?.id,
          metricCounters: { replicationFailoverRejects: 1 }
        }
      }
    }

    const role = node.config?.['replicationRole'] === 'replica' ? 'replica' : 'primary'
    const lagMs = positive(node.config?.['replicationLagMs'], 0)
    const ackPolicy = node.config?.['writeAckPolicy'] === 'quorum' ? 'quorum' : 'primary'
    if (request.type === 'read' && role === 'replica') {
      return {
        action: 'continue',
        payload: {
          replicationRead: 'replica',
          replicationLagMs: lagMs,
          replicationLeader: replicaCluster.leader()?.id,
          metricCounters: {
            replicationReplicaReads: 1,
            ...(lagMs > 0 ? { replicationStaleReadsPossible: 1 } : {})
          }
        }
      }
    }
    if (nodeState?.status === 'failed') {
      replicaCluster.fail(node.id)
      const promoted = replicaCluster.elect()
      return {
        action: 'rejected',
        reason: 'replica_failover_in_progress',
        payload: {
          replicationLeader: promoted?.id,
          metricCounters: {
            replicationFailoverRejects: 1,
            replicationLeaderPromotions: promoted ? 1 : 0
          }
        }
      }
    }
    if (request.type === 'write') {
      const requiredAcks = ackPolicy === 'quorum' ? replicaCluster.quorumSize() : 1
      const write = replicaCluster.write(requiredAcks)
      if (!write.committed) {
        return {
          action: 'rejected',
          reason: 'quorum_unavailable',
          payload: {
            replicationQuorumUnavailable: true,
            replicationLeader: write.leaderId,
            replicationAcknowledgements: write.acknowledgements,
            replicationRequiredAcks: write.quorumSize,
            metricCounters: { replicationQuorumFailures: 1 }
          }
        }
      }
    }
    if (request.type === 'write' && ackPolicy === 'quorum' && lagMs > 0) {
      request.metadata[SERVICE_TIME_DISTRIBUTION_OVERRIDE_KEY] = { type: 'constant', value: lagMs }
      return {
        action: 'continue',
        payload: {
          replicationWriteAck: 'quorum',
          replicationLeader: replicaCluster.leader()?.id,
          replicationConsensusProtocol: replicaCluster.protocolName(),
          replicationLagMs: lagMs,
          metricCounters: { replicationQuorumWrites: 1 }
        }
      }
    }
    return {
      action: 'continue',
      payload: {
        replicationWriteAck: ackPolicy,
        replicationLeader: replicaCluster.leader()?.id,
        replicationConsensusProtocol: replicaCluster.protocolName(),
        metricCounters: { replicationPrimaryAcks: 1 }
      }
    }
  }
}

export const replicationCapabilityModule: NodeCapabilityModule = {
  name: 'storage.replication-boundary',
  appliesTo: REPLICATION_COMPONENT_TYPES,
  hooks: replicationTrait,
  config: {
    sections: [
      {
        id: 'replication',
        title: 'Replication',
        note: 'Models primary versus quorum write acknowledgement, durable replica membership, deterministic leader promotion, replica-read staleness exposure, and a bounded failover unavailability window.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.replicationEnabled',
            type: 'boolean',
            label: 'Replication model',
            altitude: 'advanced'
          },
          {
            path: 'sim.replicationLagMs',
            type: 'input',
            inputType: 'number',
            label: 'Replica lag',
            unit: 'ms',
            min: 0,
            altitude: 'advanced'
          },
          {
            path: 'sim.writeAckPolicy',
            type: 'select',
            label: 'Write acknowledgement',
            options: ['primary', 'quorum'],
            altitude: 'advanced'
          },
          {
            path: 'sim.failoverUntilMs',
            type: 'input',
            inputType: 'number',
            label: 'Failover window',
            unit: 'ms',
            min: 0,
            altitude: 'advanced'
          },
          {
            path: 'sim.replicaMembers',
            type: 'input',
            inputType: 'text',
            label: 'Replica members',
            altitude: 'advanced',
            placeholder: 'db-a, db-b, db-c',
            why: 'Defines deterministic membership for quorum and leader-promotion simulation.'
          },
          {
            path: 'sim.consensusProtocol',
            type: 'select',
            label: 'Consensus protocol',
            options: ['raft', 'none'],
            altitude: 'advanced',
            why: 'Controls whether the cluster represents an elected-log protocol or an unsafe replication boundary.'
          },
          {
            path: 'sim.conflictResolution',
            type: 'select',
            label: 'Conflict resolution',
            options: ['leader-wins', 'highest-index-wins'],
            altitude: 'advanced',
            why: 'Documents how divergent durable replica state is resolved in modeled conflict scenarios.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'replicationFailoverRejects',
      'replicationReplicaReads',
      'replicationStaleReadsPossible',
      'replicationQuorumWrites',
      'replicationPrimaryAcks',
      'replicationLeaderPromotions',
      'replicationQuorumFailures'
    ]
  },
  honesty: {
    simulates: [
      'shared durable replica membership, primary/quorum acknowledgement latency, deterministic leader promotion, bounded replica-read staleness, and configured failover unavailability'
    ],
    notModeled: ['packet-level log replication, real Raft timing, or Byzantine consensus']
  }
}
