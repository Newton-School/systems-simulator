/**
 * Cluster bin-packing scheduler (the `scheduler` trait).
 *
 * A Kubernetes-style cluster is a finite pool of machines, each with a fixed
 * vCPU and RAM allocatable. Workloads placed on the cluster ask for replicas
 * (pods); each pod requests the vCPU and RAM of the workload's instance type.
 * The scheduler places a pod only on a machine with enough free vCPU AND RAM, so
 * a replica that fits nowhere stays Pending and adds no capacity. Effective
 * capacity is therefore a consequence of the cluster's size and shape, not of
 * the replica count anyone asked for:
 *
 *   - fragmentation: 3 machines x 4 vCPU hold only three 3-vCPU pods, not four;
 *   - a scale-up that cannot be placed adds nothing until room appears;
 *   - a machine failure takes its pods down at once, but replacements are only
 *     created after the failure is detected and the pods evicted
 *     (`rescheduleDelayUs`), then they need room and `podStartupUs` to become
 *     ready. The recovery time is measured per lost pod.
 *
 * This module is pure state + time-weighted integrals; the engine owns event
 * scheduling and applies ready-replica counts to the workload's queue.
 */

export type PlacementStrategy = 'spread' | 'bin-pack'

export const PLACEMENT_STRATEGIES: readonly PlacementStrategy[] = ['spread', 'bin-pack']

export type PodState = 'pending' | 'starting' | 'ready' | 'lost'

export interface ClusterMachine {
  index: number
  vcpu: number
  ramGb: number
  up: boolean
  /** Still booting (cluster autoscaling): not schedulable until it joins. */
  provisioning: boolean
  usedVcpu: number
  usedRamGb: number
}

export interface ClusterPod {
  id: string
  workloadId: string
  vcpu: number
  ramGb: number
  state: PodState
  machine: number | null
  createdAtUs: bigint
  readyAtUs: bigint | null
  /** When the pod this one replaces was lost (machine failure), for recovery timing. */
  replacesLossAtUs: bigint | null
}

export interface ClusterWorkloadSpec {
  nodeId: string
  podVcpu: number
  podRamGb: number
  desired: number
}

export interface ClusterSchedulerOptions {
  clusterId: string
  machineVcpu: number
  machineRamGb: number
  machineCount: number
  strategy: PlacementStrategy
  podStartupUs: bigint
  rescheduleDelayUs: bigint
  /** Cluster autoscaling ceiling; equal to machineCount when off. */
  maxMachines: number
  machineProvisionUs: bigint
}

export interface PodStart {
  pod: ClusterPod
  readyAtUs: bigint
}

export interface WorkloadProjection {
  nodeId: string
  podVcpu: number
  podRamGb: number
  desiredFinal: number
  readyFinal: number
  pendingFinal: number
  /** Time-weighted mean ready replicas over the run (integral / duration). */
  avgReadyReplicas: number
  /** Time-weighted mean desired replicas over the run. */
  avgDesiredReplicas: number
  /** Integral of pending pods over time, in pod-seconds. */
  pendingPodSeconds: number
}

export interface ClusterProjection {
  clusterId: string
  strategy: PlacementStrategy
  machineVcpu: number
  machineRamGb: number
  machinesConfigured: number
  maxMachines: number
  machinesFinal: number
  /** Time-weighted mean machines up (schedulable) over the run. */
  avgMachinesUp: number
  /** Integral of vCPU requested by placed pods / integral of allocatable vCPU on up machines. */
  cpuAllocatedRatio: number
  /** Same for RAM. */
  ramAllocatedRatio: number
  /** Time-weighted mean pending pods. */
  avgPendingPods: number
  peakPendingPods: number
  podsLost: number
  podsRecovered: number
  /** Mean / max time from a machine failure to the replacement pod being ready (ms). */
  meanRecoveryMs: number | null
  maxRecoveryMs: number | null
  workloads: WorkloadProjection[]
}

const EPS = 1e-9

interface WorkloadEntry {
  spec: ClusterWorkloadSpec
  desired: number
  readyAreaUs: number
  desiredAreaUs: number
  pendingAreaUs: number
}

export class ClusterScheduler {
  readonly options: ClusterSchedulerOptions
  readonly machines: ClusterMachine[] = []
  private readonly pods = new Map<string, ClusterPod>()
  private readonly workloads = new Map<string, WorkloadEntry>()
  private podSeq = 0
  private lastAccrualUs = 0n
  private machinesUpAreaUs = 0
  private allocatedVcpuAreaUs = 0
  private allocatableVcpuAreaUs = 0
  private allocatedRamAreaUs = 0
  private allocatableRamAreaUs = 0
  private pendingAreaUs = 0
  private peakPending = 0
  private podsLost = 0
  private readonly recoveryUs: number[] = []

  constructor(options: ClusterSchedulerOptions) {
    this.options = options
    for (let index = 0; index < options.machineCount; index++) {
      this.machines.push(this.newMachine(index, false))
    }
  }

  private newMachine(index: number, provisioning: boolean): ClusterMachine {
    return {
      index,
      vcpu: this.options.machineVcpu,
      ramGb: this.options.machineRamGb,
      up: !provisioning,
      provisioning,
      usedVcpu: 0,
      usedRamGb: 0
    }
  }

  register(spec: ClusterWorkloadSpec): void {
    this.workloads.set(spec.nodeId, {
      spec,
      desired: Math.max(0, Math.round(spec.desired)),
      readyAreaUs: 0,
      desiredAreaUs: 0,
      pendingAreaUs: 0
    })
  }

  hasWorkload(nodeId: string): boolean {
    return this.workloads.has(nodeId)
  }

  workloadIds(): string[] {
    return [...this.workloads.keys()]
  }

  desiredCount(nodeId: string): number {
    return this.workloads.get(nodeId)?.desired ?? 0
  }

  readyCount(nodeId: string): number {
    let count = 0
    for (const pod of this.pods.values()) {
      if (pod.workloadId === nodeId && pod.state === 'ready') count++
    }
    return count
  }

  pendingCount(nodeId?: string): number {
    let count = 0
    for (const pod of this.pods.values()) {
      if (pod.state === 'pending' && (nodeId === undefined || pod.workloadId === nodeId)) count++
    }
    return count
  }

  getPod(podId: string): ClusterPod | undefined {
    return this.pods.get(podId)
  }

  /** Accrue every time-weighted integral up to `now` at the current state. */
  accrue(now: bigint): void {
    if (now <= this.lastAccrualUs) return
    const dt = Number(now - this.lastAccrualUs)
    let upMachines = 0
    let allocatableVcpu = 0
    let allocatableRam = 0
    let allocatedVcpu = 0
    let allocatedRam = 0
    for (const machine of this.machines) {
      if (!machine.up) continue
      upMachines++
      allocatableVcpu += machine.vcpu
      allocatableRam += machine.ramGb
      allocatedVcpu += machine.usedVcpu
      allocatedRam += machine.usedRamGb
    }
    this.machinesUpAreaUs += upMachines * dt
    this.allocatableVcpuAreaUs += allocatableVcpu * dt
    this.allocatableRamAreaUs += allocatableRam * dt
    this.allocatedVcpuAreaUs += allocatedVcpu * dt
    this.allocatedRamAreaUs += allocatedRam * dt
    let pendingTotal = 0
    const readyBy = new Map<string, number>()
    const pendingBy = new Map<string, number>()
    for (const pod of this.pods.values()) {
      if (pod.state === 'ready') readyBy.set(pod.workloadId, (readyBy.get(pod.workloadId) ?? 0) + 1)
      if (pod.state === 'pending') {
        pendingTotal++
        pendingBy.set(pod.workloadId, (pendingBy.get(pod.workloadId) ?? 0) + 1)
      }
    }
    this.pendingAreaUs += pendingTotal * dt
    for (const [id, entry] of this.workloads) {
      entry.readyAreaUs += (readyBy.get(id) ?? 0) * dt
      entry.desiredAreaUs += entry.desired * dt
      entry.pendingAreaUs += (pendingBy.get(id) ?? 0) * dt
    }
    this.lastAccrualUs = now
  }

  private notePending(): void {
    this.peakPending = Math.max(this.peakPending, this.pendingCount())
  }

  private createPod(workloadId: string, now: bigint, replacesLossAtUs: bigint | null): ClusterPod {
    const entry = this.workloads.get(workloadId)!
    const pod: ClusterPod = {
      id: `${this.options.clusterId}:${workloadId}:pod-${++this.podSeq}`,
      workloadId,
      vcpu: entry.spec.podVcpu,
      ramGb: entry.spec.podRamGb,
      state: 'pending',
      machine: null,
      createdAtUs: now,
      readyAtUs: null,
      replacesLossAtUs
    }
    this.pods.set(pod.id, pod)
    return pod
  }

  private fits(machine: ClusterMachine, pod: ClusterPod): boolean {
    return (
      machine.up &&
      machine.vcpu - machine.usedVcpu + EPS >= pod.vcpu &&
      machine.ramGb - machine.usedRamGb + EPS >= pod.ramGb
    )
  }

  /** Dominant-resource allocation of a machine if `pod` were added. */
  private allocationAfter(machine: ClusterMachine, pod: ClusterPod): number {
    return Math.max(
      (machine.usedVcpu + pod.vcpu) / machine.vcpu,
      (machine.usedRamGb + pod.ramGb) / machine.ramGb
    )
  }

  private podsOfWorkloadOn(machineIndex: number, workloadId: string): number {
    let count = 0
    for (const pod of this.pods.values()) {
      if (pod.machine === machineIndex && pod.workloadId === workloadId) count++
    }
    return count
  }

  /**
   * Pick a machine for `pod`, or null when none fits. `spread` (the
   * kube-scheduler default, LeastAllocated plus spreading a workload's replicas)
   * prefers the machine with the fewest replicas of this workload, then the
   * least allocated; `bin-pack` (MostAllocated) prefers the fullest machine that
   * still fits. Ties go to the lowest machine index (deterministic).
   */
  private chooseMachine(pod: ClusterPod): ClusterMachine | null {
    let best: ClusterMachine | null = null
    let bestKey: number[] | null = null
    for (const machine of this.machines) {
      if (!this.fits(machine, pod)) continue
      const allocation = this.allocationAfter(machine, pod)
      const key =
        this.options.strategy === 'bin-pack'
          ? [-allocation, machine.index]
          : [this.podsOfWorkloadOn(machine.index, pod.workloadId), allocation, machine.index]
      if (!bestKey || compareKeys(key, bestKey) < 0) {
        best = machine
        bestKey = key
      }
    }
    return best
  }

  private bind(pod: ClusterPod, machine: ClusterMachine): void {
    pod.machine = machine.index
    machine.usedVcpu += pod.vcpu
    machine.usedRamGb += pod.ramGb
  }

  private unbind(pod: ClusterPod): void {
    if (pod.machine === null) return
    const machine = this.machines[pod.machine]
    if (machine) {
      machine.usedVcpu = Math.max(0, machine.usedVcpu - pod.vcpu)
      machine.usedRamGb = Math.max(0, machine.usedRamGb - pod.ramGb)
    }
    pod.machine = null
  }

  /**
   * Place pending pods in creation order. Placed pods start; they become ready
   * `podStartupUs` later (or immediately when `instant`, the run's starting
   * steady state). Returns the pods that started.
   */
  schedulePending(now: bigint, instant = false): PodStart[] {
    this.accrue(now)
    const started: PodStart[] = []
    const pending = [...this.pods.values()]
      .filter((pod) => pod.state === 'pending')
      .sort((a, b) => (a.createdAtUs < b.createdAtUs ? -1 : a.createdAtUs > b.createdAtUs ? 1 : 0))
    for (const pod of pending) {
      const machine = this.chooseMachine(pod)
      if (!machine) continue
      this.bind(pod, machine)
      if (instant) {
        pod.state = 'ready'
        pod.readyAtUs = now
      } else {
        pod.state = 'starting'
        pod.readyAtUs = now + this.options.podStartupUs
      }
      started.push({ pod, readyAtUs: pod.readyAtUs })
    }
    this.notePending()
    return started
  }

  /** The run's starting steady state: every workload's replicas placed and ready at t=0. */
  initialPlacement(now: bigint): PodStart[] {
    for (const [id, entry] of this.workloads) {
      for (let i = 0; i < entry.desired; i++) this.createPod(id, now, null)
    }
    return this.schedulePending(now, true)
  }

  /** A starting pod finished its startup. Returns its workload when it became ready. */
  markReady(podId: string, now: bigint): string | null {
    const pod = this.pods.get(podId)
    if (!pod || pod.state !== 'starting') return null
    this.accrue(now)
    pod.state = 'ready'
    if (pod.replacesLossAtUs !== null) {
      this.recoveryUs.push(Number(now - pod.replacesLossAtUs))
      pod.replacesLossAtUs = null
    }
    return pod.workloadId
  }

  /**
   * Change a workload's desired replicas (autoscaling). Scale-up creates pending
   * pods; scale-down deletes pods the way a ReplicaSet does: pending first, then
   * starting, then ready, newest first. Returns whether ready capacity dropped.
   */
  setDesired(nodeId: string, desired: number, now: bigint): { removedReady: number } {
    const entry = this.workloads.get(nodeId)
    if (!entry) return { removedReady: 0 }
    this.accrue(now)
    const target = Math.max(0, Math.round(desired))
    entry.desired = target
    const live = [...this.pods.values()].filter((pod) => pod.workloadId === nodeId)
    let removedReady = 0
    if (live.length < target) {
      for (let i = live.length; i < target; i++) this.createPod(nodeId, now, null)
    } else if (live.length > target) {
      const rank: Record<PodState, number> = { pending: 0, lost: 1, starting: 2, ready: 3 }
      const victims = live
        .sort((a, b) =>
          rank[a.state] !== rank[b.state]
            ? rank[a.state] - rank[b.state]
            : a.createdAtUs > b.createdAtUs
              ? -1
              : a.createdAtUs < b.createdAtUs
                ? 1
                : b.id.localeCompare(a.id)
        )
        .slice(0, live.length - target)
      for (const pod of victims) {
        if (pod.state === 'ready') removedReady++
        this.unbind(pod)
        this.pods.delete(pod.id)
      }
    }
    this.notePending()
    return { removedReady }
  }

  /**
   * Machines fail: their pods stop serving at once. The pods are not replaced
   * yet; the controller only notices after the failure is detected and the pods
   * are evicted (the engine calls `evictLost` after `rescheduleDelayUs`).
   * Returns the failed machine indexes and the workloads that lost ready pods.
   */
  failMachines(
    count: number,
    now: bigint
  ): {
    machineIndexes: number[]
    affectedWorkloads: string[]
    podsLost: number
    lostPods: Array<{ workloadId: string; count: number }>
  } {
    this.accrue(now)
    const targets = this.machines.filter((machine) => machine.up).slice(0, Math.max(0, count))
    const lostBy = new Map<string, number>()
    let podsLost = 0
    for (const machine of targets) {
      machine.up = false
      for (const pod of this.pods.values()) {
        if (pod.machine !== machine.index) continue
        if (pod.state === 'ready' || pod.state === 'starting') {
          pod.state = 'lost'
          pod.readyAtUs = null
          pod.replacesLossAtUs = now
          lostBy.set(pod.workloadId, (lostBy.get(pod.workloadId) ?? 0) + 1)
          podsLost++
        }
      }
    }
    this.podsLost += podsLost
    return {
      machineIndexes: targets.map((machine) => machine.index),
      affectedWorkloads: [...lostBy.keys()],
      podsLost,
      lostPods: [...lostBy.entries()].map(([workloadId, lost]) => ({ workloadId, count: lost }))
    }
  }

  /**
   * Evict the pods still stranded on a failed machine and create pending
   * replacements (they inherit the loss time, so recovery is measured from the
   * failure). Returns how many were evicted.
   */
  evictLost(machineIndex: number, now: bigint): { total: number; byWorkload: Map<string, number> } {
    this.accrue(now)
    const byWorkload = new Map<string, number>()
    let total = 0
    for (const pod of [...this.pods.values()]) {
      if (pod.machine !== machineIndex || pod.state !== 'lost') continue
      const lossAt = pod.replacesLossAtUs
      this.unbind(pod)
      this.pods.delete(pod.id)
      this.createPod(pod.workloadId, now, lossAt)
      byWorkload.set(pod.workloadId, (byWorkload.get(pod.workloadId) ?? 0) + 1)
      total++
    }
    this.notePending()
    return { total, byWorkload }
  }

  /**
   * A failed machine comes back. Pods not yet evicted restart in place (they
   * become ready after startup); the machine's free room is then open to
   * pending pods. Returns the pods restarting in place.
   */
  recoverMachine(machineIndex: number, now: bigint): PodStart[] {
    const machine = this.machines[machineIndex]
    if (!machine || machine.up || machine.provisioning) return []
    this.accrue(now)
    machine.up = true
    const restarted: PodStart[] = []
    for (const pod of this.pods.values()) {
      if (pod.machine === machineIndex && pod.state === 'lost') {
        pod.state = 'starting'
        pod.readyAtUs = now + this.options.podStartupUs
        restarted.push({ pod, readyAtUs: pod.readyAtUs })
      }
    }
    return restarted
  }

  /**
   * Cluster autoscaling: how many new machines the pending pods need, by
   * first-fit placing them onto empty machines (pods bigger than a whole
   * machine are skipped; no new machine would ever fit them), capped by the
   * remaining headroom to `maxMachines`. Machines already booting count.
   */
  machinesNeededForPending(): number {
    const headroom = this.options.maxMachines - this.machines.length
    if (headroom <= 0) return 0
    const booting = this.machines.filter((machine) => machine.provisioning)
    const bins = booting.map(() => ({
      vcpu: this.options.machineVcpu,
      ram: this.options.machineRamGb
    }))
    const fresh: Array<{ vcpu: number; ram: number }> = []
    for (const pod of this.pods.values()) {
      if (pod.state !== 'pending') continue
      if (
        pod.vcpu > this.options.machineVcpu + EPS ||
        pod.ramGb > this.options.machineRamGb + EPS
      ) {
        continue
      }
      const bin = [...bins, ...fresh].find(
        (candidate) => candidate.vcpu + EPS >= pod.vcpu && candidate.ram + EPS >= pod.ramGb
      )
      if (bin) {
        bin.vcpu -= pod.vcpu
        bin.ram -= pod.ramGb
      } else {
        fresh.push({
          vcpu: this.options.machineVcpu - pod.vcpu,
          ram: this.options.machineRamGb - pod.ramGb
        })
      }
    }
    return Math.min(headroom, fresh.length)
  }

  /** Start booting `count` machines; returns their indexes. */
  provisionMachines(count: number, now: bigint): number[] {
    this.accrue(now)
    const indexes: number[] = []
    for (let i = 0; i < count; i++) {
      const machine = this.newMachine(this.machines.length, true)
      this.machines.push(machine)
      indexes.push(machine.index)
    }
    return indexes
  }

  /** A booting machine joined the cluster and is schedulable. */
  machineJoined(machineIndex: number, now: bigint): boolean {
    const machine = this.machines[machineIndex]
    if (!machine || !machine.provisioning) return false
    this.accrue(now)
    machine.provisioning = false
    machine.up = true
    return true
  }

  machinesUp(): number {
    return this.machines.filter((machine) => machine.up).length
  }

  projection(horizonUs: bigint): ClusterProjection {
    this.accrue(horizonUs)
    const duration = Number(horizonUs) > 0 ? Number(horizonUs) : 1
    const workloads: WorkloadProjection[] = [...this.workloads.entries()].map(([id, entry]) => ({
      nodeId: id,
      podVcpu: entry.spec.podVcpu,
      podRamGb: entry.spec.podRamGb,
      desiredFinal: entry.desired,
      readyFinal: this.readyCount(id),
      pendingFinal: this.pendingCount(id),
      avgReadyReplicas: entry.readyAreaUs / duration,
      avgDesiredReplicas: entry.desiredAreaUs / duration,
      pendingPodSeconds: entry.pendingAreaUs / 1e6
    }))
    const recovered = this.recoveryUs.length
    return {
      clusterId: this.options.clusterId,
      strategy: this.options.strategy,
      machineVcpu: this.options.machineVcpu,
      machineRamGb: this.options.machineRamGb,
      machinesConfigured: this.options.machineCount,
      maxMachines: this.options.maxMachines,
      machinesFinal: this.machinesUp(),
      avgMachinesUp: this.machinesUpAreaUs / duration,
      cpuAllocatedRatio:
        this.allocatableVcpuAreaUs > 0 ? this.allocatedVcpuAreaUs / this.allocatableVcpuAreaUs : 0,
      ramAllocatedRatio:
        this.allocatableRamAreaUs > 0 ? this.allocatedRamAreaUs / this.allocatableRamAreaUs : 0,
      avgPendingPods: this.pendingAreaUs / duration,
      peakPendingPods: this.peakPending,
      podsLost: this.podsLost,
      podsRecovered: recovered,
      meanRecoveryMs:
        recovered > 0
          ? this.recoveryUs.reduce((sum, value) => sum + value, 0) / recovered / 1000
          : null,
      maxRecoveryMs: recovered > 0 ? Math.max(...this.recoveryUs) / 1000 : null,
      workloads
    }
  }
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (Math.abs(diff) > EPS) return diff
  }
  return 0
}
