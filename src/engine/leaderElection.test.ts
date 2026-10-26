/** A quorum store elects a new leader after `electionTimeoutMs` when a majority is up (chapter 11, decision G5). */
import { describe, expect, it } from 'vitest'
import type { ComponentNode, TopologyJSON } from './core/types'
import { SimulationEngine } from './engine'

function run(electionTimeoutMs: number | undefined, downMembers: string[] = ['p']) {
  const store = (id: string, role: string) =>
    ({
      id,
      type: 'relational-db',
      category: 'storage-and-data',
      label: id,
      position: { x: 0, y: 0 },
      queue: { workers: 50, capacity: 500, discipline: 'fifo' },
      processing: { distribution: { type: 'constant', value: 2 }, timeout: 1_000 },
      config: {
        replicationEnabled: true,
        replicationRole: role,
        writeAckPolicy: 'quorum',
        replicaMembers: 'p,r1,r2',
        ...(electionTimeoutMs ? { electionTimeoutMs } : {})
      }
    }) as ComponentNode
  const client = {
    id: 'client',
    type: 'microservice',
    category: 'compute',
    label: 'client',
    position: { x: 0, y: 0 },
    queue: { workers: 50, capacity: 500, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 1 }, timeout: 1_000 }
  } as ComponentNode
  const topology = {
    id: 't',
    name: 'election',
    version: '1.0.0',
    global: {
      simulationDuration: 15_000,
      seed: 'election',
      warmupDuration: 0,
      timeResolution: 'microsecond',
      defaultTimeout: 1_000,
      traceSampleRate: 0
    },
    nodes: [client, store('p', 'leader'), store('r1', 'follower'), store('r2', 'follower')],
    edges: [
      {
        id: 'e',
        source: 'client',
        target: 'p',
        mode: 'synchronous',
        protocol: 'grpc',
        latency: { distribution: { type: 'constant', value: 0 }, pathType: 'same-dc' },
        bandwidth: 1000,
        maxConcurrentRequests: 1000,
        packetLossRate: 0,
        errorRate: 0
      }
    ],
    faults: downMembers.map((id) => ({
      targetId: id,
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'permanent',
      params: { atMs: 5_000, mode: 'reject' }
    })),
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'write', weight: 1, sizeBytes: 100 }]
    }
  } as unknown as TopologyJSON
  const out = new SimulationEngine(topology).run()
  const failedBetween = (fromMs: number, toMs: number) =>
    out.requestOutcomes.filter(
      (o) =>
        o.createdAtMs >= fromMs &&
        o.createdAtMs < toMs &&
        o.status !== 'success' &&
        o.status !== 'in-flight' &&
        o.status !== 'in-flight'
    ).length
  return { out, failedBetween }
}

describe('leader election', () => {
  it('is unavailable for the election timeout, then writes reach the elected leader', () => {
    const { out, failedBetween } = run(2_000)
    expect(failedBetween(5_000, 7_000)).toBeGreaterThan(190)
    expect(failedBetween(7_100, 15_000)).toBe(0)
    expect(out.perNode.r1.traitCounters.leaderElected).toBeGreaterThan(0)
  })

  it('without an election timeout the store stays down', () => {
    const { failedBetween } = run(undefined)
    expect(failedBetween(8_000, 15_000)).toBeGreaterThan(600)
  })

  it('does not elect without a majority: two of three members down', () => {
    const { failedBetween } = run(2_000, ['p', 'r1'])
    expect(failedBetween(8_000, 15_000)).toBeGreaterThan(600)
  })
})
