/**
 * Derives a node's effective queueing capacity (the `c` and `K` of G/G/c/K) from
 * its physical resource allocation. Concurrency is a *consequence of the hardware*,
 * not a free-typed number — the instance is the only allocation knob:
 *
 *   effectiveC = totalVcpu × workersPerVcpu(workloadKind)   // servers
 *   effectiveK = memCeiling = totalRAM ÷ per-request footprint   // admission (RAM)
 *
 * `workersPerInstance` and `queueSlots` are NOT authored — they are derived and
 * shown read-only. To get more concurrency you provision a bigger/more instances,
 * which costs money. cpu-bound runs ~1 parallel worker per vCPU; io-bound legitimately
 * multiplexes many concurrent waits per core (IO_WORKERS_PER_VCPU), but still tethered
 * to the paid hardware tier — never infinite.
 *
 * Back-compat: a node with no instance-model `resources` passes its raw authored
 * `queue.workers` / `queue.capacity` through unchanged.
 *
 * See ns-simulator-docs/specs/resource-allocation-and-derived-concurrency.md.
 */
import { getInstanceCount, type ComponentNode, type WorkloadKind } from '../core/types'
import { getResourceDefaults } from '../catalog/resourceDefaults'
import { INSTANCE_CATALOG } from '../catalog/instanceCatalog'

/** Truly-parallel servers per vCPU for cpu-bound work (one core, one worker). */
export const CPU_WORKERS_PER_VCPU = 1
/**
 * Concurrent in-flight requests an io-bound worker can multiplex per vCPU (a core
 * mostly waiting on a store/network juggles many). Generous but firmly locked, so
 * io-bound datastores get real concurrency without an infinite free dial.
 */
export const IO_WORKERS_PER_VCPU = 32
/**
 * When an author explicitly flips a normally cpu-bound component to the io-bound
 * execution profile, we need a locked nonzero CPU fraction that matches that
 * profile. Keeping the type-default 1.0 while also deriving io-bound `c` would
 * be internally contradictory and creates fake saturation in migrated/bank
 * topologies. This low fraction models a thin orchestration layer until the
 * author picks a more specific io-bound component type.
 */
export const IO_BOUND_OVERRIDE_CPU_FRACTION = 0.1

/** Servers-per-vCPU for a workload kind. */
export function workersPerVcpu(workloadKind: WorkloadKind): number {
  return workloadKind === 'cpu-bound' ? CPU_WORKERS_PER_VCPU : IO_WORKERS_PER_VCPU
}

/**
 * How much of an instance's compute-speed advantage an io-bound request enjoys.
 * A cpu-bound request spends all its time on the core (full benefit); an io-bound
 * request mostly *waits* on a store/network, so a faster core barely helps.
 */
export const IO_PERF_SENSITIVITY = 0.25

/**
 * Effective single-request speed multiplier for a node: the instance's `perfFactor`
 * for cpu-bound work, damped toward 1.0 for io-bound work. Service time is divided
 * by this, so a faster instance (perfFactor > 1) serves each request quicker.
 */
export function effectivePerfFactor(perfFactor: number, workloadKind: WorkloadKind): number {
  return workloadKind === 'cpu-bound' ? perfFactor : 1 + (perfFactor - 1) * IO_PERF_SENSITIVITY
}

/**
 * Resolve the contention fraction so it stays consistent with the execution
 * profile that derived `effectiveC`.
 *
 * - Matching default profile: use the per-type sourced fraction.
 * - cpu-bound override on an io-bound type: all service time contends for cores.
 * - io-bound override on a cpu-bound type: use a locked low fraction rather than
 *   the type's cpu-bound 1.0, which would otherwise pair io-bound concurrency
 *   with cpu-bound contention and falsely pin the node.
 */
export function effectiveCpuBoundFraction(
  defaultCpuBoundFraction: number,
  defaultWorkloadKind: WorkloadKind,
  workloadKind: WorkloadKind
): number {
  if (workloadKind === defaultWorkloadKind) {
    return defaultCpuBoundFraction
  }
  if (workloadKind === 'cpu-bound') {
    return 1
  }
  return IO_BOUND_OVERRIDE_CPU_FRACTION
}

/**
 * Service-time multiplier from a node's instance/workload (≤ 1 speeds up, > 1 slows
 * down). Legacy nodes (no instance model) are unaffected (1.0). Multiply a node's
 * authored service time by this to get the instance-adjusted latency.
 */
export function serviceTimeMultiplier(config: ComponentNode): number {
  const resources = config.resources
  if (!hasInstanceModel(resources)) return 1
  const workloadKind = resources?.workloadKind ?? getResourceDefaults(config.type).workloadKind
  const instanceType = resources?.instanceType ?? getResourceDefaults(config.type).instanceType
  const perf = effectivePerfFactor(INSTANCE_CATALOG[instanceType].perfFactor, workloadKind)
  return perf > 0 ? 1 / perf : 1
}

export interface DerivedConcurrency {
  /** Effective parallel servers (`c`) — derived: totalVcpu × workersPerVcpu. */
  effectiveC: number
  /** Effective system capacity (`K`) — derived from RAM (memCeiling). */
  effectiveK: number
  /** Derived workers per instance (`vcpu × workersPerVcpu`) — read-only display. */
  workersPerInstance: number
  /**
   * Physical CPU cores backing this node (`totalVcpu × instanceCount`). For an
   * io-bound node this is `effectiveC ÷ IO_WORKERS_PER_VCPU` (128 workers, 4
   * cores); for cpu-bound it equals `effectiveC`. The ceiling the CPU-bound
   * fraction of concurrent work contends for — see the two-tier compute-contention
   * model (compute-contention-two-tier-model.md). Legacy nodes: equals effectiveC.
   */
  physicalCores: number
  /**
   * Fraction of a request's service time that is CPU-bound work contending for
   * `physicalCores` (vs I/O wait that multiplexes freely). Sourced per component
   * type (resourceDefaults.ts). 0 for legacy nodes ⇒ the two-tier model is a
   * no-op (guaranteed zero regression).
   */
  cpuBoundFraction: number
  /**
   * Which constraint binds admission `K`. Instance nodes are RAM-bound (a full node
   * is `oom`); legacy/queue-only nodes are `backlog` (`queue_full`).
   */
  admissionBoundBy: 'ram' | 'backlog'
  /** Human-readable derivation for inline UI provenance. */
  provenance: string
}

/** Whether a node uses the AWS instance-family resource model (vs legacy/none). */
function hasInstanceModel(resources: ComponentNode['resources']): boolean {
  return resources?.instanceType !== undefined || resources?.instanceCount !== undefined
}

/**
 * Compute effective `c`/`K` for a node from its instance allocation. Legacy nodes
 * (no instance model) pass their raw authored queue through unchanged.
 */
export function deriveNodeConcurrency(config: ComponentNode): DerivedConcurrency {
  const queueWorkers = config.queue?.workers ?? 1
  const queueCapacity = config.queue?.capacity ?? queueWorkers
  const resources = config.resources

  if (!hasInstanceModel(resources)) {
    return {
      effectiveC: queueWorkers,
      effectiveK: queueCapacity,
      workersPerInstance: queueWorkers,
      physicalCores: queueWorkers,
      cpuBoundFraction: 0, // legacy nodes: two-tier model is a no-op
      admissionBoundBy: 'backlog',
      provenance: `c = ${queueWorkers} workers`
    }
  }

  const defaults = getResourceDefaults(config.type)
  const instanceCount = getInstanceCount(resources)
  const workloadKind = resources?.workloadKind ?? defaults.workloadKind
  const instanceType = resources?.instanceType ?? defaults.instanceType
  const spec = INSTANCE_CATALOG[instanceType]
  const cpuBoundFraction = effectiveCpuBoundFraction(
    defaults.cpuBoundFraction,
    defaults.workloadKind,
    workloadKind
  )

  // Concurrency is DERIVED from the hardware, not authored.
  const perVcpu = workersPerVcpu(workloadKind)
  const workersPerInstance = spec.vcpu * perVcpu
  const effectiveC = workersPerInstance * instanceCount

  // Admission K is DERIVED from RAM: every in-flight request occupies memory, so
  // the node can hold at most totalRAM ÷ per-request footprint. Never below `c`.
  const perRequestMemMb = resources?.perRequestMemMb ?? defaults.perRequestMemMb
  const totalRamMb = spec.ramGb * 1024 * instanceCount
  const memCeiling = Math.floor(totalRamMb / perRequestMemMb)
  const effectiveK = Math.max(effectiveC, memCeiling)

  const kindNote = workloadKind === 'io-bound' ? ` × ${perVcpu} io` : ''
  const provenance = `${instanceCount} × ${instanceType} (${spec.vcpu * instanceCount} vCPU${kindNote}) → c ${effectiveC} · K ${effectiveK} (RAM)`

  return {
    effectiveC,
    effectiveK,
    workersPerInstance,
    physicalCores: spec.vcpu * instanceCount,
    cpuBoundFraction,
    admissionBoundBy: 'ram',
    provenance
  }
}
