import type { NodeSimulationMetrics } from '@renderer/types/ui'
import type { SimulationOutput } from '../../../../engine/analysis/output'

export interface ClusterRates {
  writesPerSec: number
  readsPerSec: number
}

/** Writes/s accepted by the leader and reads/s served by all followers, from run counters. */
export function getClusterRates(
  leaderId: string,
  followerIds: readonly string[],
  metricsByNode: Record<string, NodeSimulationMetrics | undefined>,
  consistency: SimulationOutput['consistency'] | undefined,
  windowMs: number
): ClusterRates | null {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null
  const seconds = windowMs / 1000
  const leader = metricsByNode[leaderId]?.traitCounters ?? {}
  const writes = (leader.replicationPrimaryAcks ?? 0) + (leader.replicationQuorumWrites ?? 0)
  const reads = followerIds.reduce(
    (sum, id) =>
      sum +
      (consistency?.nodes.find((node) => node.nodeId === id)?.reads ??
        metricsByNode[id]?.traitCounters?.replicationReplicaReads ??
        0),
    0
  )
  if (writes <= 0 && reads <= 0) return null
  return { writesPerSec: writes / seconds, readsPerSec: reads / seconds }
}
