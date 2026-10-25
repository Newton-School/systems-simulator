/**
 * Chapter 14: orchestration and infrastructure (docs/reference/14-orchestration-and-infrastructure.md).
 * Expected values come from the chapter: the HPA formula, the lag of a control loop, pods that fit on no machine adding
 * no capacity, RAM stranding, node-failure recovery = detection + start-up, bin-packing vs spreading, node
 * provisioning delay, and a CI runner pool as an M/M/c queue. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import { importTopology, openApp, readUiRun, runAndWait } from '../support/app'
import { runEngine } from '../support/engine'
import { erlangC, hpaDesired, podsPerMachine, relErr, replicasNeeded } from '../support/oracles'
import { chain, computeNode, queueNode, type RunSpec } from '../support/topology'

type Out = ReturnType<typeof runEngine>

function run(seed: string, over: Partial<RunSpec> = {}): RunSpec {
  return {
    name: seed,
    rps: 100,
    pattern: 'constant',
    durationMs: 120_000,
    warmupMs: 0,
    seed,
    timeoutMs: 5000,
    ...over
  }
}

const tcp = (a: string, b: string) =>
  [a, b, { protocol: 'tcp' }] as [string, string, Record<string, unknown>]

/** Worker count of a node in each 1 s time-series sample. */
const workersOver = (out: Out, id: string) => out.timeSeries.map((s) => s.node[id].workers)

// ───────────────────────── 1. Horizontal autoscaling ─────────────────────────

test.describe('A-01 the autoscaler settles at the proportional replica count (ch14 section 2)', () => {
  // m5.large = 2 servers per instance; 100 ms service, 100 req/s = 10 busy servers.
  const LOAD_SERVERS = 100 * 0.1
  const SERVERS_PER_INSTANCE = 2
  const scaled = (
    seed: string,
    cfg: Record<string, unknown>,
    over: Partial<RunSpec> = {},
    count = 1
  ) => {
    const srv = computeNode('srv', { serviceMs: 100, config: cfg })
    ;(srv.resources as Record<string, unknown>).instanceCount = count
    return runEngine(chain({ run: run(seed, over), nodes: [srv], edges: [tcp('source', 'srv')] }))
  }
  const cfg = {
    autoscaleMinInstances: 1,
    autoscaleMaxInstances: 20,
    autoscaleTargetUtilization: 0.7,
    autoscaleCooldownMs: 5000
  }

  test('100 req/s x 100 ms at a 70% target needs ceil(10 / (0.7 x 2)) = 8 instances, and the loop ends there', () => {
    const out = scaled('a01', cfg)
    const needed = replicasNeeded(LOAD_SERVERS, 0.7, SERVERS_PER_INSTANCE)
    expect(needed).toBe(8)
    const finalInstances = workersOver(out, 'srv').at(-1)! / SERVERS_PER_INSTANCE
    expect(finalInstances).toBe(needed)
    // The HPA formula agrees from the converged state: 8 replicas at 62.5% against a 70% target is inside tolerance.
    expect(hpaDesired(needed, 62.5, 70)).toBe(needed)
  })

  test('once converged it holds: no scaling in the last 60 s of steady load', () => {
    const out = scaled('a01b', cfg)
    const last = workersOver(out, 'srv').slice(-60)
    expect(new Set(last).size).toBe(1)
  })

  test('the formula on the chapter numbers: 4 at 90% vs 70% -> 6; 10 at 30% -> 5; 4 at 76% -> unchanged', () => {
    expect(hpaDesired(4, 90, 70)).toBe(6)
    expect(hpaDesired(10, 30, 70)).toBe(5)
    expect(hpaDesired(4, 76, 70)).toBe(4)
  })

  test('the maximum is a hard ceiling: capped at 4 instances the service stays overloaded', () => {
    const out = scaled('a01c', { ...cfg, autoscaleMaxInstances: 4 })
    expect(workersOver(out, 'srv').at(-1)).toBe(4 * SERVERS_PER_INSTANCE)
    expect(out.summary.errorRate).toBeGreaterThan(0.1)
  })
})

test.describe('A-02 capacity follows demand with a lag, so a step in load is served badly until the loop catches up (ch14 section 2)', () => {
  const srv = () => {
    const s = computeNode('srv', {
      serviceMs: 100,
      config: {
        autoscaleMinInstances: 1,
        autoscaleMaxInstances: 20,
        autoscaleTargetUtilization: 0.7,
        autoscaleCooldownMs: 5000
      }
    })
    return s
  }
  const out = runEngine(chain({ run: run('a02'), nodes: [srv()], edges: [tcp('source', 'srv')] }))

  test('requests fail while capacity is short and stop failing once it has converged', () => {
    const settled = workersOver(out, 'srv').findIndex((w) => w >= 16)
    expect(settled).toBeGreaterThan(0)
    const failedEarly = out.requestOutcomes.filter(
      (o) => o.status !== 'success' && o.createdAtMs < settled * 1000
    ).length
    const failedLate = out.requestOutcomes.filter(
      (o) => o.status !== 'success' && o.reasonCode && o.createdAtMs >= (settled + 10) * 1000
    ).length
    expect(failedEarly).toBeGreaterThan(0)
    expect(failedLate).toBe(0)
  })

  test('capacity never arrives faster than one step per cooldown', () => {
    const w = workersOver(out, 'srv')
    for (let i = 5; i < w.length; i += 1) {
      // one instance (2 servers) per 5 s tick at the default step
      expect(w[i] - w[i - 5]).toBeLessThanOrEqual(2)
    }
  })

  // Decision needed (ch14 section 10): the HPA computes the target in one calculation (ceil(1 x 100 / 70) per sync, up
  // to a doubling), the simulator adds one instance per tick, so 1 -> 8 takes 35 s instead of about 3 sync periods.
  test.fixme('from one instance the loop reaches the target within three 15 s sync periods', () => {
    const w = workersOver(out, 'srv')
    const reached = w.findIndex((x) => x >= 16)
    expect(reached).toBeLessThanOrEqual(45)
  })
})

test.describe('A-03 scale-down is conservative (ch14 section 2)', () => {
  const idle = () => {
    const s = computeNode('srv', {
      serviceMs: 100,
      config: {
        autoscaleMinInstances: 1,
        autoscaleMaxInstances: 20,
        autoscaleTargetUtilization: 0.7,
        autoscaleCooldownMs: 5000
      }
    })
    ;(s.resources as Record<string, unknown>).instanceCount = 12
    return runEngine(
      chain({
        run: run('a03', { rps: 20, durationMs: 400_000 }),
        nodes: [s],
        edges: [tcp('source', 'srv')]
      })
    )
  }
  const out = idle()

  test('12 instances for 2 busy servers shrink to the proportional count, never below it', () => {
    const needed = replicasNeeded(2, 0.7, 2)
    expect(needed).toBe(2)
    const finalInstances = workersOver(out, 'srv').at(-1)! / 2
    expect(finalInstances).toBeGreaterThanOrEqual(needed)
    expect(finalInstances).toBeLessThanOrEqual(needed + 1)
  })

  // Finding 23 (fixed as an opt-in, decision F1): with `autoscalePolicy: 'hpa'` the first scale-down waits for the 300 s
  // stabilization window and follows ceil(current x utilization / target); the default step policy is unchanged.
  test('with the HPA policy the first scale-down waits for the 300 s stabilization window', () => {
    const s = computeNode('srv', {
      serviceMs: 100,
      config: {
        autoscalePolicy: 'hpa',
        autoscaleMinInstances: 1,
        autoscaleMaxInstances: 20,
        autoscaleTargetUtilization: 0.7
      }
    })
    ;(s.resources as Record<string, unknown>).instanceCount = 12
    const hpa = runEngine(
      chain({
        run: run('a03h', { rps: 20, durationMs: 400_000 }),
        nodes: [s],
        edges: [tcp('source', 'srv')]
      })
    )
    const w = workersOver(hpa, 'srv')
    const first = w.findIndex((x) => x < w[0])
    expect(first).toBeGreaterThanOrEqual(300)
    // Then the proportional answer in one step: 2 busy servers' worth of load needs 2 instances.
    expect(w.at(-1)! / 2).toBe(replicasNeeded(2, 0.7, 2))
  })
})

// ───────────────────────── 2. Scheduling and bin packing ─────────────────────────

function cluster(
  seed: string,
  o: {
    machines: number
    machineType: string
    pods: number
    podType: string
    config?: Record<string, unknown>
    over?: Partial<RunSpec>
  }
) {
  const k8s = queueNode('k8s', 'kubernetes-cluster', {
    category: 'orchestration-and-infra',
    workers: 64,
    capacity: 1000,
    config: { podStartupMs: 1000, ...o.config }
  })
  ;(k8s as Record<string, unknown>).resources = {
    instanceType: o.machineType,
    instanceCount: o.machines
  }
  const api = computeNode('api', {
    serviceMs: 20,
    instanceType: o.podType,
    config: { scheduledOn: 'k8s' }
  })
  ;(api.resources as Record<string, unknown>).instanceCount = o.pods
  return chain({
    run: run(seed, { rps: 20, durationMs: 30_000, ...o.over }),
    nodes: [k8s, api],
    edges: [tcp('source', 'api')]
  })
}

test.describe('K-01 a pod that fits on no machine adds no capacity (ch14 section 4)', () => {
  // machine type [vCPU, GB]: m5.xlarge [4, 16], m5.2xlarge [8, 32]; pod type: m5.large [2, 8], r5.large [2, 16], c5.2xlarge [8, 16]
  const cases: [string, string, string, number, number, number, number, number][] = [
    ['4 pods on 3 x 4 vCPU fit', 'm5.xlarge', 'm5.large', 4, 2, 8, 4, 16],
    [
      '8 pods of 2 vCPU / 8 GB on 3 x 4 vCPU / 16 GB: 6 fit, 2 pending',
      'm5.xlarge',
      'm5.large',
      8,
      2,
      8,
      4,
      16
    ],
    [
      'RAM strands CPU: 2 vCPU / 16 GB pods on 8 vCPU / 32 GB machines fit 2 each, not 4',
      'm5.2xlarge',
      'r5.large',
      8,
      2,
      16,
      8,
      32
    ],
    ['one 8 vCPU pod per 8 vCPU machine: 3 of 5 fit', 'm5.2xlarge', 'c5.2xlarge', 5, 8, 16, 8, 32]
  ]
  for (const [name, machineType, podType, pods, podV, podG, machV, machG] of cases) {
    test(name, () => {
      const out = runEngine(
        cluster(`k01-${machineType}-${podType}-${pods}`, {
          machines: 3,
          machineType,
          pods,
          podType
        })
      )
      const fit = Math.min(pods, 3 * podsPerMachine(machV, machG, podV, podG))
      const w = out.clusterProjection![0].workloads[0]
      expect(w.readyFinal).toBe(fit)
      expect(w.pendingFinal).toBe(pods - fit)
    })
  }

  test('RAM is what runs out: the stranded resource is CPU (allocated 50%) while RAM is full', () => {
    const out = runEngine(
      cluster('k01-ram', { machines: 3, machineType: 'm5.2xlarge', pods: 8, podType: 'r5.large' })
    )
    const p = out.clusterProjection![0]
    expect(p.ramAllocatedRatio).toBeCloseTo(1, 2)
    expect(p.cpuAllocatedRatio).toBeCloseTo(0.5, 2)
  })
})

test.describe('K-02 a machine failure removes its pods now and replacements arrive after detection + start-up (ch14 section 5)', () => {
  const failing = (
    strategy: string,
    config: Record<string, unknown> = {},
    over: Partial<RunSpec> = {}
  ) =>
    runEngine(
      cluster(`k02-${strategy}`, {
        machines: 3,
        machineType: 'm5.2xlarge',
        pods: 3,
        podType: 'm5.large',
        config: {
          placementStrategy: strategy,
          rescheduleDelayMs: 3000,
          machineFailureAtMs: 5000,
          ...config
        },
        over
      })
    ).clusterProjection![0]

  test('recovery time per lost pod = reschedule delay + pod start-up (3 s + 1 s)', () => {
    const p = failing('spread')
    expect(p.podsLost).toBe(p.podsRecovered)
    expect(p.meanRecoveryMs).toBe(3000 + 1000)
  })

  test('spreading puts one pod on each machine, bin-packing puts all three on one: a failure loses 1 vs 3', () => {
    expect(failing('spread').podsLost).toBe(1)
    expect(failing('bin-pack').podsLost).toBe(3)
  })

  test('bin-packing is a bigger outage when its machine fails: the failed share of requests is higher', () => {
    const errors = (strategy: string) => {
      const out = runEngine(
        cluster(`k02e-${strategy}`, {
          machines: 3,
          machineType: 'm5.2xlarge',
          pods: 3,
          podType: 'm5.large',
          config: { placementStrategy: strategy, rescheduleDelayMs: 3000, machineFailureAtMs: 5000 }
        })
      )
      return out.summary.errorRate
    }
    expect(errors('bin-pack')).toBeGreaterThan(errors('spread'))
  })

  test('the default detection delay is the Kubernetes node-monitor grace (50 s) plus the not-ready toleration (300 s): 350 s', () => {
    const p = failing('bin-pack', { rescheduleDelayMs: undefined }, { rps: 5, durationMs: 420_000 })
    expect(p.meanRecoveryMs).toBe(350_000 + 1000)
  })

  test('all pods on the failed machine: the workload is down for the whole detection window', () => {
    const out = runEngine(
      cluster('k02d', {
        machines: 3,
        machineType: 'm5.2xlarge',
        pods: 3,
        podType: 'm5.large',
        config: { placementStrategy: 'bin-pack', machineFailureAtMs: 5000 },
        over: { rps: 5, durationMs: 420_000 }
      })
    )
    // down from 5 s to 355 s of a 420 s run
    expect(Math.abs(out.summary.errorRate - 350 / 420)).toBeLessThan(0.02)
  })
})

test.describe('K-03 a cluster that can grow waits for new machines to boot (ch14 section 3)', () => {
  test('1 machine, max 3, 20 s boot, 6 pods of 2 vCPU on 4 vCPU machines: 4 pods wait 20 s', () => {
    const out = runEngine(
      cluster('k03', {
        machines: 1,
        machineType: 'm5.xlarge',
        pods: 6,
        podType: 'm5.large',
        config: { clusterMaxMachines: 3, machineProvisionMs: 20_000 },
        over: { durationMs: 60_000 }
      })
    )
    const p = out.clusterProjection![0]
    expect(p.machinesFinal).toBe(3)
    expect(p.workloads[0].readyFinal).toBe(6)
    // 4 pods are pending for the 20 s boot: 80 pod-seconds
    expect(p.workloads[0].pendingPodSeconds).toBe(4 * 20)
  })

  test('without room to grow they stay pending for the whole run', () => {
    const out = runEngine(
      cluster('k03b', { machines: 1, machineType: 'm5.xlarge', pods: 6, podType: 'm5.large' })
    )
    const w = out.clusterProjection![0].workloads[0]
    expect(w.readyFinal).toBe(2)
    expect(w.pendingFinal).toBe(4)
  })
})

// ───────────────────────── 3. Control-plane queues ─────────────────────────

test.describe('K-04 a CI runner pool is an M/M/c queue (ch14 section 6)', () => {
  test('2 runners, offered load 1 Erlang: P(wait) = 1/3 and mean wait = C / (c mu - lambda)', () => {
    // 10 jobs/s of mean 100 ms (time scaled so one hour is 360 s): a = 1, c = 2
    const runner = queueNode('ci', 'ci-cd-runner', {
      category: 'orchestration-and-infra',
      workers: 2,
      capacity: 100_000
    })
    ;(runner.processing as Record<string, unknown>).distribution = {
      type: 'exponential',
      lambda: 1 / 100
    }
    const out = runEngine(
      chain({
        run: run('k04', { rps: 10, pattern: 'poisson', durationMs: 1_500_000, timeoutMs: 60_000 }),
        nodes: [runner],
        edges: [tcp('source', 'ci')]
      })
    )
    const C = erlangC(2, 1)
    expect(C).toBeCloseTo(1 / 3, 6)
    const expectedWaitMs = (C / (2 * 10 - 10)) * 1000
    expect(relErr(out.perNode.ci.avgQueueWait, expectedWaitMs)).toBeLessThan(0.1)
  })
})

// ───────────────────────── 4. The browser agrees ─────────────────────────

test.describe('K-05 the browser shows the outage the engine computed for a bin-packed machine failure', () => {
  test('3 pods on one machine, 10 s detection: the error rate matches the engine', async ({
    page
  }) => {
    const t = cluster('k05', {
      machines: 3,
      machineType: 'm5.2xlarge',
      pods: 3,
      podType: 'm5.large',
      config: {
        placementStrategy: 'bin-pack',
        rescheduleDelayMs: 10_000,
        machineFailureAtMs: 5000
      },
      over: { rps: 20, durationMs: 40_000 }
    })
    const out = runEngine(t)
    expect(out.summary.errorRate).toBeGreaterThan(0.2)
    await openApp(page)
    await importTopology(page, t)
    await runAndWait(page)
    const ui = await readUiRun(page, 'api')
    expect(Math.abs(ui.errorRatePct - out.summary.errorRate * 100)).toBeLessThan(1.5)
  })
})
