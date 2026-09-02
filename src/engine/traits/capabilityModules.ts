import type { CanvasNodeDataV2, RoutingStrategy } from '../catalog/nodeSpecTypes'
import { hasWorkloadSourceConfig, isSourceComponentData } from '../catalog/sourceNodeSemantics'
import type { ComponentType } from '../core/types'
import { ackAndReleaseCapabilityModule } from './ackAndRelease'
import { broadcastFanoutCapabilityModule } from './broadcastFanout'
import { cacheCapabilityModule } from './cache'
import { circuitBreakerCapabilityModule } from './circuitBreaker'
import { coldStartCapabilityModule } from './coldStart'
import { CONTENT_ROUTING_COMPONENT_TYPES, contentRoutingCapabilityModule } from './contentRouting'
import { consumerLagCapabilityModule } from './consumerLag'
import { dnsRoutingPolicyCapabilityModule } from './dnsRoutingPolicy'
import { healthAwareRoutingCapabilityModule } from './healthAwareRouting'
import { idempotencyDedupCapabilityModule } from './idempotencyDedup'
import { geoLatencyCapabilityModule } from './geoLatency'
import { externalLatencyCapabilityModule } from './externalLatency'
import { tieredRetrievalCapabilityModule } from './tieredRetrieval'
import { cryptoCostCapabilityModule } from './cryptoCost'
import { tokenCostCapabilityModule } from './tokenCost'
import { inspectionCostCapabilityModule } from './inspectionCost'
import { capacityLimitCapabilityModule } from './capacityLimit'
import { batchingCapabilityModule } from './batching'
import { logReplayCapabilityModule } from './logReplay'
import { windowingCapabilityModule } from './windowing'
import { fanoutQueryCapabilityModule } from './fanoutQuery'
import { autoscalerCapabilityModule } from './autoscaler'
import { lockLeaseCapabilityModule } from './lockLease'
import { reservationStoreCapabilityModule } from './reservationStore'
import { keyBasedRoutingCapabilityModule } from './keyBasedRouting'
import { memoryPressureCapabilityModule } from './memoryPressure'
import { rateLimiterCapabilityModule } from './rateLimiter'
import { readOnlyCapabilityModule } from './readOnly'
import { readWriteSplitCapabilityModule } from './readWriteSplit'
import { replicationCapabilityModule } from './replication'
import { protocolSessionCapabilityModule } from './protocolSession'
import { retryBackoffCapabilityModule } from './retryBackoff'
import { storageProfileCapabilityModule } from './storageProfile'
import { streamBrokerCapabilityModule } from './streamBroker'
import type { ConfigField, NodeCapabilityModule } from './types'
import type { ComponentNode } from '../core/types'
import { INSTANCE_CATALOG, INSTANCE_TYPES, PRICING_MODELS } from '../catalog/instanceCatalog'
import { getResourceDefaults } from '../catalog/resourceDefaults'
import { deriveNodeConcurrency, effectivePerfFactor } from '../nodes/resourceDerivation'
import { nodeCostPerHour } from '../analysis/cost'

const CONTENT_ROUTING_COMPONENT_TYPE_SET = new Set<ComponentType>(CONTENT_ROUTING_COMPONENT_TYPES)

const DEFAULT_ROUTING_OPTIONS: readonly RoutingStrategy[] = [
  'passthrough',
  'round-robin',
  'random',
  'weighted',
  'least-conn'
]

const CONTENT_ROUTING_OPTIONS: readonly RoutingStrategy[] = [
  'round-robin',
  'random',
  'weighted',
  'least-conn',
  'conditional'
]

const QUEUE_VOCABULARY: Partial<
  Record<
    ComponentType,
    {
      title: string
      workers: string
      capacity: string
    }
  >
> = {
  'load-balancer': {
    title: 'Forwarding',
    workers: 'Max concurrent connections',
    capacity: 'Connection queue limit'
  },
  'load-balancer-l4': {
    title: 'Forwarding',
    workers: 'Max concurrent connections',
    capacity: 'Connection queue limit'
  },
  'load-balancer-l7': {
    title: 'Forwarding',
    workers: 'Max concurrent connections',
    capacity: 'Connection queue limit'
  },
  'api-gateway': {
    title: 'Forwarding',
    workers: 'Max concurrent requests',
    capacity: 'Request queue limit'
  },
  'ingress-controller': {
    title: 'Forwarding',
    workers: 'Max concurrent requests',
    capacity: 'Request queue limit'
  },
  'reverse-proxy': {
    title: 'Forwarding',
    workers: 'Max concurrent requests',
    capacity: 'Request queue limit'
  },
  'relational-db': {
    title: 'Connections',
    workers: 'Connection pool size',
    capacity: 'Query queue limit'
  },
  'in-memory-cache': {
    title: 'Operations',
    workers: 'Concurrent operations',
    capacity: 'Operation queue limit'
  },
  cdn: {
    title: 'Forwarding',
    workers: 'Concurrent origin fetches',
    capacity: 'Origin queue limit'
  },
  queue: {
    title: 'Consumers',
    workers: 'Consumer concurrency',
    capacity: 'Backlog limit'
  },
  'service-registry': {
    title: 'Discovery',
    workers: 'Lookup concurrency',
    capacity: 'Lookup queue limit'
  }
}

function queueVocabulary(data: CanvasNodeDataV2) {
  if (typeof data.componentType !== 'string') {
    return {
      title: 'Queueing',
      workers: 'Workers',
      capacity: 'Queue capacity'
    }
  }

  return (
    QUEUE_VOCABULARY[data.componentType] ?? {
      title: 'Queueing',
      workers: 'Workers',
      capacity: 'Queue capacity'
    }
  )
}

function isDistribution(data: CanvasNodeDataV2, type: string) {
  return data.sim?.processing?.distribution?.type === type
}

function isRuntimeNode(data: CanvasNodeDataV2) {
  return data.profile !== 'source' && data.profile !== 'composite'
}

function supportsSloTargets(data: CanvasNodeDataV2) {
  return isRuntimeNode(data) && data.profile !== 'broker'
}

function resolveRoutingOptions(data: CanvasNodeDataV2): readonly string[] {
  if (
    typeof data.componentType === 'string' &&
    CONTENT_ROUTING_COMPONENT_TYPE_SET.has(data.componentType)
  ) {
    return CONTENT_ROUTING_OPTIONS
  }

  return DEFAULT_ROUTING_OPTIONS
}

function lambdaToMeanMs(rawValue: unknown): number | undefined {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue <= 0) {
    return undefined
  }

  return Number((1 / rawValue).toFixed(3))
}

function meanMsToLambda(displayValue: unknown): number | undefined {
  if (typeof displayValue !== 'number' || !Number.isFinite(displayValue) || displayValue <= 0) {
    return undefined
  }

  return 1 / displayValue
}

function ratioToPercent(rawValue: unknown): number | undefined {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return undefined
  }

  return Number((rawValue * 100).toFixed(3))
}

function percentToRatio(displayValue: unknown): number | undefined {
  if (typeof displayValue !== 'number' || !Number.isFinite(displayValue)) {
    return undefined
  }

  return displayValue / 100
}

const SOURCE_WORKLOAD_MODULE: NodeCapabilityModule = {
  name: 'source.workload',
  appliesWhen: (data) => isSourceComponentData(data) || hasWorkloadSourceConfig(data),
  config: {
    sections: [
      {
        id: 'workload',
        title: 'Workload',
        fields: [
          {
            path: 'source.defaultWorkload.pattern',
            type: 'select',
            label: 'Pattern',
            options: ['constant', 'poisson', 'bursty', 'diurnal', 'spike', 'sawtooth'],
            why: 'Sets the overall request arrival shape this source emits.'
          },
          {
            path: 'source.defaultWorkload.baseRps',
            type: 'input',
            label: 'Base RPS',
            unit: 'req/s',
            why: 'Sets the baseline request rate for this source.'
          }
        ]
      },
      {
        id: 'request-templates',
        title: 'Request Templates',
        fields: [
          {
            path: 'source.requestDistribution',
            type: 'input',
            label: 'Requests',
            renderer: 'request-distribution',
            inputType: 'text',
            why: 'Defines the mix of operations this source emits. Type is the coarse request class; method, host, and path add HTTP-aware routing context.'
          }
        ]
      },
      {
        id: 'pattern',
        title: 'Pattern',
        fields: [
          {
            path: 'source.defaultWorkload.bursty.burstRps',
            type: 'input',
            label: 'Burst RPS',
            unit: 'req/s',
            visible: (data) => data.source?.defaultWorkload.pattern === 'bursty',
            why: 'Sets the request rate during burst windows.'
          },
          {
            path: 'source.defaultWorkload.bursty.burstDuration',
            type: 'input',
            label: 'Burst duration',
            unit: 'ms',
            visible: (data) => data.source?.defaultWorkload.pattern === 'bursty',
            why: 'Sets how long each burst lasts.'
          },
          {
            path: 'source.defaultWorkload.bursty.normalDuration',
            type: 'input',
            label: 'Normal duration',
            unit: 'ms',
            visible: (data) => data.source?.defaultWorkload.pattern === 'bursty',
            why: 'Sets how long the source returns to baseline between bursts.'
          },
          {
            path: 'source.defaultWorkload.spike.spikeTime',
            type: 'input',
            label: 'Spike time',
            unit: 'ms',
            visible: (data) => data.source?.defaultWorkload.pattern === 'spike',
            why: 'Sets when the one-off spike begins.'
          },
          {
            path: 'source.defaultWorkload.spike.spikeRps',
            type: 'input',
            label: 'Spike RPS',
            unit: 'req/s',
            visible: (data) => data.source?.defaultWorkload.pattern === 'spike',
            why: 'Sets the request rate during the spike.'
          },
          {
            path: 'source.defaultWorkload.spike.spikeDuration',
            type: 'input',
            label: 'Spike duration',
            unit: 'ms',
            visible: (data) => data.source?.defaultWorkload.pattern === 'spike',
            why: 'Sets how long the spike lasts.'
          },
          {
            path: 'source.defaultWorkload.sawtooth.peakRps',
            type: 'input',
            label: 'Peak RPS',
            unit: 'req/s',
            visible: (data) => data.source?.defaultWorkload.pattern === 'sawtooth',
            why: 'Sets the top of the ramp in a sawtooth workload.'
          },
          {
            path: 'source.defaultWorkload.sawtooth.rampDuration',
            type: 'input',
            label: 'Ramp duration',
            unit: 'ms',
            visible: (data) => data.source?.defaultWorkload.pattern === 'sawtooth',
            why: 'Sets how long it takes to climb to the peak rate.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['source workload shape and baseline request rate'],
    notModeled: ['per-endpoint mixes, client retries, user think time']
  }
}

const ROUTING_STRATEGY_MODULE: NodeCapabilityModule = {
  name: 'routing.strategy',
  appliesWhen: (data) => data.profile === 'router',
  config: {
    sections: [
      {
        id: 'routing',
        title: 'Routing',
        fields: [
          {
            path: 'routingStrategy',
            type: 'select',
            label: 'Strategy',
            options: resolveRoutingOptions,
            why: 'Controls how this router chooses among eligible downstream targets.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['route selection strategy at the node level'],
    notModeled: ['per-connection stickiness, protocol-specific balancing heuristics']
  }
}

const COMPOSITE_LOCATION_MODULE: NodeCapabilityModule = {
  name: 'composite.location',
  appliesWhen: (data) => data.profile === 'composite',
  config: {
    sections: [
      {
        id: 'location',
        title: 'Location',
        note: 'Grouping container — not simulated as a node. It shapes edge latency by where nodes sit: same subnet → same-rack, same AZ → same-dc, same region → cross-zone, different region → cross-region. This only fills an edge’s default latency; a latency set on an edge manually is kept. This field is descriptive metadata for labels/export and renderer-side location rollups; latency math uses containment, not this text. (AZ fault-domain failure and distance-aware cross-region latency are not modeled yet.)',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.locationId',
            type: 'input',
            inputType: 'text',
            label: (data) =>
              data.templateId === 'vpc-region'
                ? 'Region ID'
                : data.templateId === 'availability-zone'
                  ? 'AZ ID'
                  : 'Subnet / CIDR',
            placeholder: (data) =>
              data.templateId === 'vpc-region'
                ? 'e.g. us-east-1'
                : data.templateId === 'availability-zone'
                  ? 'e.g. us-east-1a'
                  : 'e.g. 10.0.1.0/24',
            why: 'A human label for this boundary. Today it is metadata only; the latency math uses which container a node sits in, not this text.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['groups nodes so cross-boundary edge latency can be derived'],
    notModeled: [
      'fault-domain failure',
      'distance-aware cross-region latency',
      'IP/CIDR validation'
    ]
  }
}

/**
 * Derived, read-only allocation summary for the RESOURCES section note — the
 * inline provenance the honesty principle requires. Computes effective c/K and
 * cost from the authored `sim.resources` so the user sees what their instance
 * choice actually buys, and why cost moved.
 */
function resourcesNote(data: CanvasNodeDataV2): string | null {
  const resources = data.sim?.resources
  const type = data.componentType
  if (!resources?.instanceType || !type) return null

  const spec = INSTANCE_CATALOG[resources.instanceType]
  const node = { type, queue: data.sim?.queue, resources } as unknown as ComponentNode
  const derived = deriveNodeConcurrency(node)
  const costModel = getResourceDefaults(type).costModel ?? 'provisioned'

  const workloadKind = resources.workloadKind ?? getResourceDefaults(type).workloadKind
  const perf = effectivePerfFactor(spec.perfFactor, workloadKind)
  const hw = `${spec.vcpu} vCPU · ${spec.ramGb} GB`
  const profile = workloadKind
  const conc = `${derived.workersPerInstance} workers/inst → eff. concurrency ${derived.effectiveC}`
  const admission = `admission ${derived.effectiveK}${derived.admissionBoundBy === 'ram' ? ' (RAM-bound)' : ''}`
  const speed = perf !== 1 ? ` · service ×${(1 / perf).toFixed(2)}` : ''
  const pricing =
    resources.pricingModel && resources.pricingModel !== 'on-demand'
      ? ` (${resources.pricingModel})`
      : ''
  const cost =
    costModel === 'volume'
      ? `$${(getResourceDefaults(type).pricePerGb ?? 0).toFixed(3)}/GB egress`
      : costModel === 'consumption'
        ? `$${(getResourceDefaults(type).pricePerMillionRequests ?? 0).toFixed(2)}/M req`
        : costModel === 'none'
          ? 'not billable'
          : `$${nodeCostPerHour(node).toFixed(3)}/hr${pricing}`

  return `${hw} · ${profile} · ${conc} · ${admission}${speed} · ${cost}`
}

function isProvisionedPurchaseNode(data: CanvasNodeDataV2): boolean {
  if (!data.componentType) return false
  return (getResourceDefaults(data.componentType).costModel ?? 'provisioned') === 'provisioned'
}

const RESOURCES_FIELDS: readonly ConfigField[] = [
  {
    path: 'sim.resources.instanceType',
    type: 'select',
    label: 'Instance type',
    options: INSTANCE_TYPES,
    why: 'The hardware SKU. Sets vCPU, RAM, and price per instance — the primary allocation knob.'
  },
  {
    path: 'sim.resources.instanceCount',
    type: 'input',
    label: 'Instances',
    unit: 'count',
    why: 'How many instances run. Scales concurrency, memory, and cost together (horizontal scale).'
  },
  {
    path: 'sim.resources.pricingModel',
    type: 'select',
    label: 'Purchase model',
    options: PRICING_MODELS,
    altitude: 'advanced',
    visible: (data) => isProvisionedPurchaseNode(data),
    why: 'How the provisioned capacity is purchased: on-demand (full price), reserved (~40% off), or spot (~70% off). Reserved/spot change cost only here; commitment guarantees and spot interruption behavior are not yet simulated.'
  },
  {
    path: 'sim.resources.workloadKind',
    type: 'select',
    label: 'Execution profile',
    options: ['io-bound', 'cpu-bound'],
    altitude: 'advanced',
    why: 'CPU-bound work spends most of its time computing on the core; IO-bound work spends more time waiting on downstream systems, so the same hardware can keep more requests in flight.'
  }
]

const RESOURCES_MODULE: NodeCapabilityModule = {
  name: 'base.resources',
  appliesWhen: (data) => isRuntimeNode(data),
  config: {
    sections: [
      {
        id: 'resources',
        title: 'Resources',
        fields: RESOURCES_FIELDS,
        note: resourcesNote
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: [
      'physical allocation: instance type × count → effective concurrency (vCPU-capped), admission limit (RAM-bound), and provisioned cost'
    ],
    notModeled: [
      'reserved-commitment semantics',
      'spot interruption behavior',
      'autoscaling',
      'per-region hardware availability'
    ]
  }
}

// Concurrency (workers) and admission (K) are DERIVED from the instance and shown
// read-only in the RESOURCES note — no longer free inputs. Only the queue discipline
// (ordering of already-waiting work) remains authored here.
const BASE_QUEUE_FIELDS: readonly ConfigField[] = [
  {
    path: 'sim.queue.discipline',
    type: 'select',
    label: 'Queue discipline',
    options: ['fifo', 'lifo', 'priority', 'wfq'],
    altitude: 'advanced',
    why: 'Controls how waiting work is ordered once it has already queued.'
  }
]

const BASE_QUEUE_MODULE: NodeCapabilityModule = {
  name: 'base.queue',
  appliesWhen: (data) => isRuntimeNode(data),
  config: {
    sections: [
      {
        id: 'queueing',
        title: (data) => queueVocabulary(data).title,
        fields: BASE_QUEUE_FIELDS
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['generic G/G/c/K queueing behavior for every runtime node'],
    notModeled: []
  }
}

const PROCESSING_MODULE: NodeCapabilityModule = {
  name: 'base.processing',
  appliesWhen: (data) => isRuntimeNode(data),
  config: {
    sections: [
      {
        id: 'processing',
        title: 'Performance',
        fields: [
          {
            path: 'sim.processing.timeout',
            type: 'input',
            label: 'Timeout',
            unit: 'ms',
            min: 1,
            max: 60000,
            why: 'Sets how long the node will wait before timing out a request (≤ 60s).'
          },
          {
            path: 'sim.processing.distribution.value',
            type: 'input',
            label: 'Mean service time',
            unit: 'ms',
            min: 0,
            max: 10000,
            visible: (data) =>
              isDistribution(data, 'constant') || isDistribution(data, 'deterministic'),
            why: 'Sets the service time when processing is modeled as a fixed latency (≤ 10s).'
          },
          {
            path: 'sim.processing.distribution.lambda',
            type: 'input',
            label: 'Mean service time',
            unit: 'ms',
            step: 0.001,
            min: 0.001,
            max: 10000,
            visible: (data) => isDistribution(data, 'exponential'),
            displayAs: {
              toDisplay: (rawValue) => lambdaToMeanMs(rawValue),
              fromDisplay: (displayValue) => meanMsToLambda(displayValue)
            },
            why: 'Displays the engine’s exponential rate parameter as the latency humans actually reason about (≤ 10s).'
          },
          {
            path: 'sim.processing.distribution.mean',
            type: 'input',
            label: 'Mean service time',
            unit: 'ms',
            step: 0.01,
            min: 0,
            max: 10000,
            visible: (data) => isDistribution(data, 'normal'),
            why: 'Sets the average service time for a normal distribution (≤ 10s).'
          },
          {
            path: 'sim.processing.distribution.type',
            type: 'select',
            label: 'Distribution model',
            options: ['constant', 'exponential', 'log-normal', 'normal'],
            altitude: 'advanced',
            why: 'Changes the statistical shape of the service-time distribution.'
          },
          {
            path: 'sim.processing.distribution.mu',
            type: 'input',
            label: 'Mu',
            step: 0.01,
            altitude: 'advanced',
            visible: (data) => isDistribution(data, 'log-normal'),
            why: 'Sets the log-normal location parameter directly for advanced tuning.'
          },
          {
            path: 'sim.processing.distribution.sigma',
            type: 'input',
            label: 'Sigma',
            step: 0.01,
            altitude: 'advanced',
            visible: (data) => isDistribution(data, 'log-normal'),
            why: 'Sets the log-normal spread parameter directly for advanced tuning.'
          },
          {
            path: 'sim.processing.distribution.stdDev',
            type: 'input',
            label: 'Std dev',
            step: 0.01,
            altitude: 'advanced',
            visible: (data) => isDistribution(data, 'normal'),
            why: 'Sets how much service times vary around the normal mean.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['per-node service-time distributions and timeouts'],
    notModeled: []
  }
}

const CHAOS_MODULE: NodeCapabilityModule = {
  name: 'chaos.node-failure',
  appliesWhen: (data) => isRuntimeNode(data),
  config: {
    sections: [
      {
        id: 'chaos',
        title: 'Chaos',
        fields: [
          {
            path: 'sim.nodeErrorRate',
            type: 'input',
            label: 'Inject failure',
            renderer: 'health-preset',
            step: 0.001,
            unit: 'ratio',
            why: 'Injects failures into this node so you can observe how the topology degrades.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['injected node-level error rate'],
    notModeled: ['root-cause-specific failure modes']
  }
}

const SLO_MODULE: NodeCapabilityModule = {
  name: 'slo.targets',
  appliesWhen: (data) => supportsSloTargets(data),
  config: {
    sections: [
      {
        id: 'slo',
        title: 'SLO Targets',
        fields: [
          {
            path: 'sim.slo.latencyP99',
            type: 'input',
            label: 'Latency target (p99)',
            unit: 'ms',
            optional: true,
            why: 'Sets the p99 latency target this node is expected to meet.'
          },
          {
            path: 'sim.slo.availabilityTarget',
            type: 'input',
            label: 'Availability target',
            unit: '%',
            step: 0.1,
            optional: true,
            displayAs: {
              toDisplay: (rawValue) => ratioToPercent(rawValue),
              fromDisplay: (displayValue) => percentToRatio(displayValue)
            },
            why: 'Sets the availability target as a percentage instead of a raw ratio.'
          },
          {
            path: 'sim.slo.errorBudget',
            type: 'input',
            label: 'Error budget',
            unit: '%',
            step: 0.1,
            optional: true,
            displayAs: {
              toDisplay: (rawValue) => ratioToPercent(rawValue),
              fromDisplay: (displayValue) => percentToRatio(displayValue)
            },
            why: 'Sets the share of requests this node is allowed to fail while still meeting its SLO.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['configured latency and availability targets for post-run grading'],
    notModeled: []
  }
}

const SECURITY_POLICY_MODULE: NodeCapabilityModule = {
  name: 'security.policy',
  appliesWhen: (data) => data.profile === 'security-filter',
  config: {
    sections: [
      {
        id: 'security',
        title: 'Security',
        fields: [
          {
            path: 'sim.securityPolicy.blockRate',
            type: 'input',
            label: 'Block rate',
            unit: 'ratio',
            step: 0.001,
            why: 'Sets the share of requests this filter blocks outright.'
          },
          {
            path: 'sim.securityPolicy.droppedPackets',
            type: 'input',
            label: 'Dropped packets',
            unit: 'ratio',
            step: 0.001,
            why: 'Sets the share of traffic this node drops before it reaches the target.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['simple probabilistic blocking and packet drops'],
    notModeled: ['rule sets, protocol-aware policy evaluation']
  }
}

const SERVICE_REGISTRY_HONESTY_MODULE: NodeCapabilityModule = {
  name: 'service-registry.honesty',
  appliesTo: ['service-registry'],
  config: {
    sections: [
      {
        id: 'model',
        title: 'Model',
        fields: [],
        note: 'This node currently simulates as a generic request queue. Modeled: concurrency, queueing, latency. Not yet modeled: service registration, heartbeats, deregistration, and dependency failure propagation.',
        noteTone: 'info'
      }
    ]
  },
  defaults: [],
  honesty: {
    simulates: ['generic request queue behavior only'],
    notModeled: ['registration, heartbeats, deregistration, dependency-aware failure']
  }
}

/**
 * Builds a config-only "Model" section that states plainly how a node is
 * simulated versus what its name implies but the engine does not yet model.
 * These nodes currently fall back to the generic queue/processing model, so the
 * note prevents the UI from over-promising specialised behaviour that isn't there
 * (mirroring SERVICE_REGISTRY_HONESTY_MODULE). Adds no engine behaviour.
 */
function honestyNoteModule(
  name: string,
  types: readonly ComponentType[],
  note: string,
  notModeled: readonly string[],
  simulates: readonly string[] = ['generic request queue behavior only']
): NodeCapabilityModule {
  return {
    name,
    appliesTo: types,
    config: {
      sections: [{ id: 'model', title: 'Model', fields: [], note, noteTone: 'info' }]
    },
    defaults: [],
    honesty: { simulates, notModeled }
  }
}

const STREAMING_BROKER_HONESTY_MODULE = honestyNoteModule(
  'streaming-broker.honesty',
  ['message-broker', 'pub-sub'],
  'Broadcast fan-out to every subscriber is modeled, along with concurrency, queueing, and latency. Not yet modeled: partitions, message ordering, consumer groups, or consumer lag. For a backlog/lag model, use the Event Stream node instead.',
  ['partitions', 'message ordering', 'consumer groups', 'consumer lag'],
  ['broadcast fan-out plus generic queueing and latency']
)

const OBSERVABILITY_SINK_HONESTY_MODULE = honestyNoteModule(
  'observability-sink.honesty',
  ['metrics-store', 'centralized-logging', 'distributed-tracing', 'alerting-hook'],
  'Currently simulates as a synchronous request queue: concurrency, queueing, and latency. Not yet modeled: asynchronous fire-and-forget ingestion, sampling, batching, or retention. Because it is synchronous here, a saturated collector can back-pressure its caller, which a real telemetry pipeline usually would not.',
  ['async fire-and-forget ingestion', 'sampling', 'batching', 'retention']
)

const NETWORK_GATEWAY_HONESTY_MODULE = honestyNoteModule(
  'network-gateway.honesty',
  ['nat-gateway', 'vpn-gateway'],
  'Currently simulates as a generic router: concurrency, queueing, and latency. Not yet modeled: connection/port-table limits, NAT translation cost, or tunnel/encryption overhead.',
  ['connection/port-table limits', 'NAT translation cost', 'tunnel/encryption overhead']
)

const HEALTH_CHECK_MANAGER_HONESTY_MODULE = honestyNoteModule(
  'health-check-manager.honesty',
  ['health-check-manager'],
  'Currently simulates as a generic request queue: concurrency, queueing, and latency. Not yet modeled: active health probing, node health-state transitions, or removing unhealthy targets from rotation.',
  ['active health probing', 'health-state transitions', 'removing unhealthy targets']
)

const LLM_GATEWAY_HONESTY_MODULE = honestyNoteModule(
  'llm-gateway.honesty',
  ['llm-gateway'],
  'Currently simulates as a generic request queue: concurrency, queueing, and latency. Not yet modeled: token-based latency and cost, prompt/response sizing, model or provider routing, or provider rate limits.',
  ['token-based latency and cost', 'model/provider routing', 'provider rate limits']
)

const AGENT_INFRA_HONESTY_MODULES: readonly NodeCapabilityModule[] = [
  honestyNoteModule(
    'agent-orchestrator.honesty',
    ['agent-orchestrator'],
    'Currently simulates as a generic request queue: concurrency, queueing, and latency. Not yet modeled: agent planning/tool-calling loops, multi-step orchestration, or fan-out to tools and models.',
    ['agent planning/tool-calling loops', 'multi-step orchestration', 'tool/model fan-out']
  ),
  honestyNoteModule(
    'memory-fabric.honesty',
    ['memory-fabric'],
    'Currently simulates as a generic request queue: concurrency, queueing, and latency. Not yet modeled: vector/semantic retrieval cost, recall vs. write paths, or eviction.',
    ['vector/semantic retrieval cost', 'recall vs. write paths', 'eviction']
  ),
  honestyNoteModule(
    'tool-registry.honesty',
    ['tool-registry'],
    'Currently simulates as a generic request queue: concurrency, queueing, and latency. Not yet modeled: tool discovery/registration, capability lookup, or per-tool latency.',
    ['tool discovery/registration', 'capability lookup', 'per-tool latency']
  ),
  honestyNoteModule(
    'safety-observability-mesh.honesty',
    ['safety-observability-mesh'],
    'Currently simulates as a generic request queue: concurrency, queueing, and latency. Not yet modeled: safety-policy or guardrail evaluation, blocking decisions, or trace/telemetry emission.',
    ['safety-policy/guardrail evaluation', 'blocking decisions', 'trace/telemetry emission']
  )
]

const NODE_HONESTY_MODULES: readonly NodeCapabilityModule[] = [
  STREAMING_BROKER_HONESTY_MODULE,
  OBSERVABILITY_SINK_HONESTY_MODULE,
  NETWORK_GATEWAY_HONESTY_MODULE,
  HEALTH_CHECK_MANAGER_HONESTY_MODULE,
  LLM_GATEWAY_HONESTY_MODULE,
  ...AGENT_INFRA_HONESTY_MODULES
]

export const TRAIT_CAPABILITY_MODULES: readonly NodeCapabilityModule[] = [
  rateLimiterCapabilityModule,
  contentRoutingCapabilityModule,
  healthAwareRoutingCapabilityModule,
  broadcastFanoutCapabilityModule,
  cacheCapabilityModule,
  coldStartCapabilityModule,
  keyBasedRoutingCapabilityModule,
  consumerLagCapabilityModule,
  streamBrokerCapabilityModule,
  dnsRoutingPolicyCapabilityModule,
  circuitBreakerCapabilityModule,
  readOnlyCapabilityModule,
  readWriteSplitCapabilityModule,
  replicationCapabilityModule,
  protocolSessionCapabilityModule,
  storageProfileCapabilityModule,
  retryBackoffCapabilityModule,
  idempotencyDedupCapabilityModule,
  lockLeaseCapabilityModule,
  reservationStoreCapabilityModule,
  memoryPressureCapabilityModule,
  ackAndReleaseCapabilityModule,
  geoLatencyCapabilityModule,
  externalLatencyCapabilityModule,
  tieredRetrievalCapabilityModule,
  cryptoCostCapabilityModule,
  tokenCostCapabilityModule,
  inspectionCostCapabilityModule,
  capacityLimitCapabilityModule,
  batchingCapabilityModule,
  logReplayCapabilityModule,
  windowingCapabilityModule,
  fanoutQueryCapabilityModule,
  autoscalerCapabilityModule
]

// Panel section order = this array order (see renderer `getNodeConfigSections`).
// Ordered most-useful-first: the node's identity/placement, then the primary
// sizing knobs (resources → performance → queue → routing), then situational
// capability traits, then rarely-touched testing/observability at the bottom.
export const NODE_CONFIG_MODULES: readonly NodeCapabilityModule[] = [
  // Node-type-specific "what this node IS" config (each gated to its type).
  SOURCE_WORKLOAD_MODULE, // sources only — the whole point of a source
  COMPOSITE_LOCATION_MODULE, // composite nodes only — placement/containment
  // Primary sizing knobs for every runtime node.
  RESOURCES_MODULE, // hardware SKU / instances — the main allocation knob
  PROCESSING_MODULE, // performance — service time + timeout
  BASE_QUEUE_MODULE, // queueing
  ROUTING_STRATEGY_MODULE, // routing (multi-target nodes)
  // Situational capabilities layered on top (retry, memory pressure, cache, …).
  ...TRAIT_CAPABILITY_MODULES,
  SECURITY_POLICY_MODULE,
  // Rarely-touched testing / targets — bottom.
  CHAOS_MODULE,
  SLO_MODULE,
  SERVICE_REGISTRY_HONESTY_MODULE,
  ...NODE_HONESTY_MODULES
]

function moduleIncludesComponentType(
  module: NodeCapabilityModule,
  componentType: ComponentType | undefined
): boolean {
  return (
    typeof componentType === 'string' &&
    Array.isArray(module.appliesTo) &&
    module.appliesTo.includes(componentType)
  )
}

export function moduleAppliesToNode(module: NodeCapabilityModule, data: CanvasNodeDataV2): boolean {
  if (module.appliesWhen?.(data)) {
    return true
  }

  return moduleIncludesComponentType(module, data.componentType)
}

export function getTraitCapabilityModulesForComponentType(
  componentType: ComponentType
): readonly NodeCapabilityModule[] {
  return TRAIT_CAPABILITY_MODULES.filter((module) =>
    moduleIncludesComponentType(module, componentType)
  )
}

export function getNodeConfigModules(data: CanvasNodeDataV2): readonly NodeCapabilityModule[] {
  return NODE_CONFIG_MODULES.filter((module) => moduleAppliesToNode(module, data))
}
