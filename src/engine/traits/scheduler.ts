import type { ComponentNode, ComponentType, TopologyJSON } from '../core/types'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import { PLACEMENT_STRATEGIES, type PlacementStrategy } from '../cluster/clusterScheduler'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

/** Node types that are a cluster of machines pods are bin-packed onto. */
export const CLUSTER_COMPONENT_TYPES = [
  'kubernetes-cluster'
] as const satisfies readonly ComponentType[]

/** Node types whose replicas can be scheduled as pods onto a cluster. */
export const SCHEDULED_WORKLOAD_TYPES = [
  'microservice',
  'batch-worker',
  'auth-service',
  'search-service'
] as const satisfies readonly ComponentType[]

export const DEFAULT_POD_STARTUP_MS = 5000
/**
 * Kubernetes defaults: a failed node is marked NotReady after the node-monitor
 * grace period (40s) and its pods are evicted when their default
 * not-ready/unreachable toleration (300s) runs out.
 */
export const DEFAULT_RESCHEDULE_DELAY_MS = 340_000
/** A cloud VM booting and joining the cluster (cluster autoscaler scale-up). */
export const DEFAULT_MACHINE_PROVISION_MS = 90_000
export const DEFAULT_PLACEMENT_STRATEGY: PlacementStrategy = 'spread'

/** Shared-state key holding a scheduled workload's ready replica count. */
export function scheduledReadyStateKey(nodeId: string): string {
  return `scheduler.ready:${nodeId}`
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export interface ClusterConfig {
  strategy: PlacementStrategy
  podStartupMs: number
  rescheduleDelayMs: number
  maxMachines: number | null
  machineProvisionMs: number
  machineFailureAtMs: number | null
  machineFailureCount: number
  machineRecoveryAtMs: number | null
}

export function readClusterConfig(config: Record<string, unknown> | undefined): ClusterConfig {
  const strategy = config?.['placementStrategy']
  const failureCount = positive(config?.['machineFailureCount'])
  return {
    strategy: PLACEMENT_STRATEGIES.includes(strategy as PlacementStrategy)
      ? (strategy as PlacementStrategy)
      : DEFAULT_PLACEMENT_STRATEGY,
    podStartupMs: nonNegative(config?.['podStartupMs']) ?? DEFAULT_POD_STARTUP_MS,
    rescheduleDelayMs: nonNegative(config?.['rescheduleDelayMs']) ?? DEFAULT_RESCHEDULE_DELAY_MS,
    maxMachines: positive(config?.['clusterMaxMachines']),
    machineProvisionMs: nonNegative(config?.['machineProvisionMs']) ?? DEFAULT_MACHINE_PROVISION_MS,
    machineFailureAtMs: nonNegative(config?.['machineFailureAtMs']),
    machineFailureCount: failureCount === null ? 1 : Math.max(1, Math.round(failureCount)),
    machineRecoveryAtMs: nonNegative(config?.['machineRecoveryAtMs'])
  }
}

export function isClusterType(type: ComponentType | undefined): boolean {
  return (CLUSTER_COMPONENT_TYPES as readonly string[]).includes(type ?? '')
}

/**
 * Resolve a workload's `scheduledOn` to a cluster node: the node id, or else a
 * unique exact label (so a canvas author can type the cluster's name). Returns
 * null when it names nothing, names a non-cluster, or the label is ambiguous.
 */
export function resolveScheduledCluster(
  topology: Pick<TopologyJSON, 'nodes'>,
  node: ComponentNode
): ComponentNode | null {
  const ref = node.config?.['scheduledOn']
  if (typeof ref !== 'string' || ref.trim().length === 0) return null
  const name = ref.trim()
  const byId = topology.nodes.find((candidate) => candidate.id === name)
  if (byId) return isClusterType(byId.type) ? byId : null
  const byLabel = topology.nodes.filter((candidate) => candidate.label === name)
  return byLabel.length === 1 && isClusterType(byLabel[0].type) ? byLabel[0] : null
}

/**
 * Workload side of the scheduler: when the cluster has no ready replica of this
 * workload (none could be placed, or their machines died), there is no endpoint
 * to serve the request, so it is refused at once (a Service with no ready
 * endpoints). The engine keeps the ready count in shared state.
 */
export const scheduledWorkloadTrait: NodeBehaviourTrait = {
  name: 'scheduler.workload',
  isEnabledFor: (node) =>
    typeof node.config?.['scheduledOn'] === 'string' &&
    (node.config['scheduledOn'] as string).trim().length > 0,
  beforeArrival: ({ node, sharedState }) => {
    const ready = sharedState?.get<number>(scheduledReadyStateKey(node.id))
    if (ready === undefined || ready > 0) {
      return { action: 'continue' }
    }
    return {
      action: 'rejected',
      reason: 'no_ready_replicas',
      payload: { metricCounters: { noReadyReplicaRejects: 1 } }
    }
  }
}

function hasMaxMachines(data: CanvasNodeDataV2): boolean {
  return typeof data.sim?.clusterMaxMachines === 'number' && data.sim.clusterMaxMachines > 0
}

function hasMachineFailure(data: CanvasNodeDataV2): boolean {
  return typeof data.sim?.machineFailureAtMs === 'number' && data.sim.machineFailureAtMs >= 0
}

export const clusterSchedulerCapabilityModule: NodeCapabilityModule = {
  name: 'scheduler.cluster',
  appliesTo: CLUSTER_COMPONENT_TYPES,
  config: {
    sections: [
      {
        id: 'cluster-scheduler',
        title: 'Cluster Scheduling',
        note: 'The cluster is its worker machines: Resources sets the machine type (vCPU and RAM each) and how many. Workloads that name this cluster in "Scheduled on" run as pods here, each asking for its own instance type. A pod that fits on no machine stays pending and serves nothing, so capacity follows the cluster size. Machines are billed here; scheduled workloads are not billed again.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.placementStrategy',
            type: 'select',
            label: 'Placement',
            options: PLACEMENT_STRATEGIES,
            altitude: 'primary',
            placeholder: DEFAULT_PLACEMENT_STRATEGY,
            why: 'spread (the kube-scheduler default) puts a workload’s replicas on different machines, so one machine failure takes fewer of them; bin-pack fills the fullest machine first, leaving whole machines free but concentrating replicas.'
          },
          {
            path: 'sim.podStartupMs',
            type: 'input',
            inputType: 'number',
            label: 'Pod startup',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_POD_STARTUP_MS}ms`,
            why: 'Time from a pod being placed to passing its readiness probe (image pull, process start, warm-up). New replicas add capacity only after this.'
          },
          {
            path: 'sim.rescheduleDelayMs',
            type: 'input',
            inputType: 'number',
            label: 'Failure detection + eviction',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_RESCHEDULE_DELAY_MS}ms`,
            why: 'How long pods on a dead machine stay counted before they are evicted and replaced. Kubernetes defaults: 40s node-monitor grace period plus a 300s not-ready toleration. Lower tolerationSeconds to fail over faster.'
          },
          {
            path: 'sim.clusterMaxMachines',
            type: 'input',
            inputType: 'number',
            label: 'Autoscale to max machines',
            min: 1,
            altitude: 'advanced',
            optional: true,
            why: 'Cluster autoscaler: when pods are pending, boot enough machines to fit them, up to this many. Leave empty for a fixed-size cluster.'
          },
          {
            path: 'sim.machineProvisionMs',
            type: 'input',
            inputType: 'number',
            label: 'Machine boot + join',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            visible: hasMaxMachines,
            placeholder: `Default ${DEFAULT_MACHINE_PROVISION_MS}ms`,
            why: 'Time for a new VM to boot and join the cluster before pending pods can be placed on it.'
          },
          {
            path: 'sim.machineFailureAtMs',
            type: 'input',
            inputType: 'number',
            label: 'Machine failure at',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            optional: true,
            why: 'Kill worker machines at this time (the lowest-numbered machines that are up). Their pods stop serving at once.'
          },
          {
            path: 'sim.machineFailureCount',
            type: 'input',
            inputType: 'number',
            label: 'Machines that fail',
            min: 1,
            altitude: 'advanced',
            visible: hasMachineFailure,
            placeholder: 'Default 1',
            why: 'How many machines the failure takes down.'
          },
          {
            path: 'sim.machineRecoveryAtMs',
            type: 'input',
            inputType: 'number',
            label: 'Machine recovery at',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            visible: hasMachineFailure,
            optional: true,
            why: 'Bring the failed machines back. Pods not yet evicted restart in place; free room opens to pending pods.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'clusterPodsScheduled',
      'clusterPodsUnplaced',
      'clusterMachineFailures',
      'clusterPodsLost',
      'clusterPodsEvicted',
      'clusterMachinesProvisioned'
    ]
  },
  honesty: {
    simulates: [
      'bin-packing of workload replicas (pods) onto a finite pool of machines by vCPU and RAM requests, with spread or bin-pack placement',
      'pending pods that add no capacity; autoscaler scale-ups that cannot be placed stay pending',
      'machine failure: pods stop serving at once and are replaced only after detection + eviction, then need room and pod startup; recovery time is measured',
      'optional cluster autoscaling that boots machines for pending pods after a boot delay'
    ],
    notModeled: [
      'requests vs limits, CPU throttling or memory overcommit (a pod uses exactly what it requests)',
      'system / kube-reserved overhead (all machine vCPU and RAM is allocatable)',
      'affinity, taints, priority classes and preemption, PodDisruptionBudgets',
      'cluster autoscaler scale-down of idle machines',
      'in-flight requests on a lost pod are drained, not reset',
      'control-plane (API server / etcd) capacity or outages'
    ]
  }
}

export const scheduledWorkloadCapabilityModule: NodeCapabilityModule = {
  name: 'scheduler.workload',
  appliesTo: SCHEDULED_WORKLOAD_TYPES,
  hooks: scheduledWorkloadTrait,
  config: {
    sections: [
      {
        id: 'scheduled-on',
        title: 'Cluster Placement',
        note: (data) =>
          typeof data.sim?.scheduledOn === 'string' && data.sim.scheduledOn.trim()
            ? 'Each instance is a pod requesting this node’s instance type (vCPU and RAM). Only pods the cluster could place and start serve traffic; the rest stay pending. With Autoscaling on, a scale-up the cluster cannot fit stays pending too. Billed as the cluster’s machines, not here.'
            : 'Name a Kubernetes Cluster node to run these instances as pods on its machines instead of on dedicated instances.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.scheduledOn',
            type: 'input',
            inputType: 'text',
            label: 'Scheduled on',
            altitude: 'primary',
            optional: true,
            placeholder: 'Cluster name or id',
            why: 'The Kubernetes Cluster node (its label or id) whose machines these replicas are bin-packed onto.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: ['podsScheduled', 'podsUnplaced', 'podsLost', 'podsEvicted', 'noReadyReplicaRejects'],
    rejectionReasons: ['no_ready_replicas']
  },
  honesty: {
    simulates: [
      'serving capacity = ready pods only (pending, starting and lost pods add none)',
      'a workload with no ready pod refuses requests (no_ready_replicas)'
    ],
    notModeled: [
      'readiness-probe failures after start',
      'rolling updates and surge/unavailable budgets'
    ]
  }
}
