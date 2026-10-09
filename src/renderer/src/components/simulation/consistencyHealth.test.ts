import { describe, expect, it } from 'vitest'
import { runSimulation } from '../../../../engine/runSimulation'
import type { TopologyJSON } from '../../../../engine/core/types'
import sample from '../../../../engine/__samples__/topology/read-consistency-replica.json'
import { consistencyLevel } from './consistencyHealth'

function withModel(model: string): TopologyJSON {
  const topology = structuredClone(sample) as unknown as TopologyJSON
  for (const node of topology.nodes) {
    const config = node.config as Record<string, unknown> | undefined
    if (config && 'consistencyModel' in config) config.consistencyModel = model
  }
  return topology
}

describe('read-consistency health level', () => {
  it('does not warn about stale reads the configured eventual model allows', () => {
    const report = runSimulation(withModel('eventual'), { mode: 'discrete' }).consistency!
    expect(report.staleReads).toBeGreaterThan(0)
    expect(consistencyLevel(report)).toBe('healthy')
  })

  it('warns when a node promising strong reads returns stale data', () => {
    const report = runSimulation(withModel('eventual'), { mode: 'discrete' }).consistency!
    const broken = {
      ...report,
      nodes: report.nodes.map((node) => ({ ...node, model: 'strong' as const }))
    }
    expect(consistencyLevel(broken)).toBe('warnings')
  })
})
