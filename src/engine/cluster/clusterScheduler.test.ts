import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine'
import { validateTopology } from '../validation/validator'
import { topologyCost } from '../analysis/cost'
import { testEdge, testNode, testTopology } from '../__tests__/traitTestTopology'
import { ClusterScheduler } from './clusterScheduler'

function scheduler(strategy: 'spread' | 'bin-pack' = 'spread', machines = 3) {
  return new ClusterScheduler({
    clusterId: 'k8s',
    machineVcpu: 4,
    machineRamGb: 8,
    machineCount: machines,
    strategy,
    podStartupUs: 1_000_000n,
    rescheduleDelayUs: 3_000_000n,
    maxMachines: machines,
    machineProvisionUs: 0n
  })
}

describe('ClusterScheduler bin-packing', () => {
  it('leaves a pod pending when no machine has room for its RAM, though total RAM would fit', () => {
    const cluster = scheduler()
    // 3 x (4 vCPU, 8 GB); pods ask 2 vCPU / 6 GB: only one fits per machine.
    cluster.register({ nodeId: 'api', podVcpu: 2, podRamGb: 6, desired: 4 })
    cluster.initialPlacement(0n)
    expect(cluster.readyCount('api')).toBe(3)
    expect(cluster.pendingCount('api')).toBe(1)
    const projection = cluster.projection(10_000_000n)
    expect(projection.workloads[0].avgReadyReplicas).toBe(3)
    expect(projection.avgPendingPods).toBe(1)
    expect(projection.ramAllocatedRatio).toBeCloseTo(18 / 24)
  })

  it('spread puts one workload on different machines; bin-pack fills one first', () => {
    const spread = scheduler('spread')
    spread.register({ nodeId: 'api', podVcpu: 1, podRamGb: 1, desired: 3 })
    spread.initialPlacement(0n)
    expect(spread.machines.map((m) => m.usedVcpu)).toEqual([1, 1, 1])

    const packed = scheduler('bin-pack')
    packed.register({ nodeId: 'api', podVcpu: 1, podRamGb: 1, desired: 3 })
    packed.initialPlacement(0n)
    expect(packed.machines.map((m) => m.usedVcpu)).toEqual([3, 0, 0])
  })

  it('a machine failure keeps lost pods counted until eviction, then needs room and startup', () => {
    const cluster = scheduler('spread', 4)
    cluster.register({ nodeId: 'api', podVcpu: 4, podRamGb: 4, desired: 3 })
    cluster.initialPlacement(0n)
    const failure = cluster.failMachines(1, 5_000_000n)
    expect(failure.podsLost).toBe(1)
    expect(cluster.readyCount('api')).toBe(2)
    // Evicted after the detection delay; the spare machine takes the replacement.
    expect(cluster.evictLost(failure.machineIndexes[0], 8_000_000n).total).toBe(1)
    const started = cluster.schedulePending(8_000_000n)
    expect(started).toHaveLength(1)
    expect(started[0].readyAtUs).toBe(9_000_000n)
    cluster.markReady(started[0].pod.id, 9_000_000n)
    expect(cluster.readyCount('api')).toBe(3)
    expect(cluster.projection(10_000_000n).meanRecoveryMs).toBe(4000)
  })
})

function clusterTopology(options: {
  machineType: string
  machines: number
  podType: string
  replicas: number
  rps: number
  durationMs: number
  clusterConfig?: Record<string, unknown>
  workloadConfig?: Record<string, unknown>
}) {
  const cluster = testNode('k8s', 'kubernetes-cluster', 1, {
    category: 'orchestration-and-infra',
    resources: { instanceType: options.machineType, instanceCount: options.machines },
    config: options.clusterConfig ?? {}
  } as never)
  const api = testNode('api', 'microservice', 20, {
    resources: {
      instanceType: options.podType,
      instanceCount: options.replicas,
      workloadKind: 'cpu-bound'
    },
    config: { scheduledOn: 'k8s', ...options.workloadConfig }
  } as never)
  return testTopology([cluster, api], [testEdge('src', 'api')], options.rps, options.durationMs)
}

describe('scheduler trait in the engine', () => {
  it('a fully placed workload runs exactly like dedicated instances', () => {
    const scheduled = clusterTopology({
      machineType: 'm5.xlarge',
      machines: 3,
      podType: 'c5.large',
      replicas: 4,
      rps: 2000,
      durationMs: 5000
    })
    const dedicated = structuredClone(scheduled)
    dedicated.nodes[2].config = {}
    const a = new SimulationEngine(scheduled).run()
    const b = new SimulationEngine(dedicated).run()
    expect(a.perNode.api.throughput).toBe(b.perNode.api.throughput)
    expect(a.perNode.api.utilization).toBe(b.perNode.api.utilization)
    expect(a.clusterProjection?.[0].workloads[0].avgReadyReplicas).toBe(4)
  })

  it('capacity follows what fits: 4 requested, 3 placed, throughput drops by a quarter', () => {
    // c5.xlarge machines (4 vCPU, 8 GB) hold one m5.large pod (2 vCPU, 8 GB) each.
    const topology = clusterTopology({
      machineType: 'c5.xlarge',
      machines: 3,
      podType: 'm5.large',
      replicas: 4,
      rps: 2000,
      durationMs: 5000
    })
    expect(validateTopology(topology).valid).toBe(true)
    const out = new SimulationEngine(topology).run()
    const api = out.perNode.api
    expect(api.traitCounters.podsUnplaced).toBe(1)
    // 3 pods x 2 workers / 20 ms = 300 rps.
    expect(api.throughput).toBeGreaterThan(295)
    expect(api.throughput).toBeLessThan(305)
    const cluster = out.clusterProjection![0]
    expect(cluster.avgPendingPods).toBe(1)
    expect(cluster.ramAllocatedRatio).toBe(1)
    expect(cluster.cpuAllocatedRatio).toBe(0.5)
  })

  it('an autoscaler scale-up the cluster cannot place adds no capacity; cluster autoscaling does', () => {
    const base = {
      machineType: 'm5.large',
      machines: 3,
      podType: 'c5.large',
      replicas: 2,
      rps: 500,
      durationMs: 20000,
      workloadConfig: { autoscaleMaxInstances: 8, autoscaleCooldownMs: 1000 }
    }
    const capped = new SimulationEngine(clusterTopology(base)).run()
    const cappedWorkload = capped.clusterProjection![0].workloads[0]
    expect(cappedWorkload.readyFinal).toBe(3)
    expect(cappedWorkload.desiredFinal).toBe(8)
    expect(cappedWorkload.pendingFinal).toBe(5)
    expect(capped.summary.errorRate).toBeGreaterThan(0.2)

    const grown = new SimulationEngine(
      clusterTopology({
        ...base,
        clusterConfig: { clusterMaxMachines: 8, machineProvisionMs: 4000, podStartupMs: 1000 }
      })
    ).run()
    const grownCluster = grown.clusterProjection![0]
    expect(grown.perNode.k8s.traitCounters.clusterMachinesProvisioned).toBeGreaterThan(0)
    expect(grownCluster.workloads[0].avgReadyReplicas).toBeGreaterThan(
      cappedWorkload.avgReadyReplicas + 2
    )
    expect(grown.summary.errorRate).toBeLessThan(0.05)
  })

  it('a machine failure reschedules after detection + eviction, with measured recovery', () => {
    const topology = clusterTopology({
      machineType: 'm5.large',
      machines: 5,
      podType: 'c5.large',
      replicas: 4,
      rps: 300,
      durationMs: 20000,
      clusterConfig: { machineFailureAtMs: 5000, rescheduleDelayMs: 3000, podStartupMs: 1000 }
    })
    const out = new SimulationEngine(topology).run()
    const cluster = out.clusterProjection![0]
    expect(cluster.podsLost).toBe(1)
    expect(cluster.podsRecovered).toBe(1)
    // Lost at 5s, evicted at 8s, placed on the spare machine, ready at 9s.
    expect(cluster.meanRecoveryMs).toBe(4000)
    // 3 ready for 4s of 20s: 4 - 4/20.
    expect(cluster.workloads[0].avgReadyReplicas).toBeCloseTo(3.8, 6)
  })

  it('bin-packing concentrates replicas, so one machine failure takes the whole service down', () => {
    const run = (placementStrategy: string) =>
      new SimulationEngine(
        clusterTopology({
          machineType: 'm5.2xlarge',
          machines: 3,
          podType: 'c5.large',
          replicas: 4,
          rps: 300,
          durationMs: 20000,
          clusterConfig: {
            placementStrategy,
            machineFailureAtMs: 5000,
            rescheduleDelayMs: 3000,
            podStartupMs: 1000
          }
        })
      ).run()
    const packed = run('bin-pack')
    const spread = run('spread')
    expect(packed.clusterProjection![0].podsLost).toBe(4)
    expect(packed.perNode.api.rejectionsByReason.no_ready_replicas).toBe(1200) // 4s x 300 rps
    expect(spread.clusterProjection![0].podsLost).toBe(2)
    expect(spread.perNode.api.rejectionsByReason.no_ready_replicas ?? 0).toBe(0)
  })

  it('bills the cluster machines, not the pods, and does not warn the cluster is unreachable', () => {
    const topology = clusterTopology({
      machineType: 'm5.xlarge',
      machines: 3,
      podType: 'c5.large',
      replicas: 4,
      rps: 100,
      durationMs: 1000
    })
    const cost = topologyCost(topology)
    expect(cost.items.find((item) => item.id === 'api')?.costPerHour).toBe(0)
    expect(cost.items.find((item) => item.id === 'k8s')?.costPerHour).toBeGreaterThan(0)
    const warnings = validateTopology(topology).warnings ?? []
    expect(warnings.some((warning) => warning.includes('Not reachable'))).toBe(false)
  })

  it('rejects a scheduledOn that names no cluster', () => {
    const topology = clusterTopology({
      machineType: 'm5.xlarge',
      machines: 3,
      podType: 'c5.large',
      replicas: 1,
      rps: 10,
      durationMs: 1000,
      workloadConfig: { scheduledOn: 'nope' }
    })
    const result = validateTopology(topology)
    expect(result.valid).toBe(false)
    expect(result.errors?.[0].path).toBe('nodes[2].config.scheduledOn')
  })
})
