import type { CanvasNodeDataV2, RoutingStrategy } from '../catalog/nodeSpecTypes'
import type { ComponentType } from '../core/types'
import { ackAndReleaseCapabilityModule } from './ackAndRelease'
import { cacheCapabilityModule } from './cache'
import { circuitBreakerCapabilityModule } from './circuitBreaker'
import { coldStartCapabilityModule } from './coldStart'
import { CONTENT_ROUTING_COMPONENT_TYPES, contentRoutingCapabilityModule } from './contentRouting'
import { consumerLagCapabilityModule } from './consumerLag'
import { dnsRoutingPolicyCapabilityModule } from './dnsRoutingPolicy'
import { healthAwareRoutingCapabilityModule } from './healthAwareRouting'
import { keyBasedRoutingCapabilityModule } from './keyBasedRouting'
import { rateLimiterCapabilityModule } from './rateLimiter'
import { readOnlyCapabilityModule } from './readOnly'
import { readWriteSplitCapabilityModule } from './readWriteSplit'
import type { ConfigField, NodeCapabilityModule } from './types'

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
  appliesWhen: (data) => data.profile === 'source',
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

const BASE_QUEUE_FIELDS: readonly ConfigField[] = [
  {
    path: 'sim.queue.workers',
    type: 'input',
    label: (data) => queueVocabulary(data).workers,
    unit: 'count',
    why: 'Sets how much concurrent work this node can process at once.'
  },
  {
    path: 'sim.queue.capacity',
    type: 'input',
    label: (data) => queueVocabulary(data).capacity,
    unit: 'req',
    why: 'Sets how many requests can wait once all workers are busy.'
  },
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
            why: 'Sets how long the node will wait before timing out a request.'
          },
          {
            path: 'sim.processing.distribution.value',
            type: 'input',
            label: 'Mean service time',
            unit: 'ms',
            visible: (data) =>
              isDistribution(data, 'constant') || isDistribution(data, 'deterministic'),
            why: 'Sets the service time when processing is modeled as a fixed latency.'
          },
          {
            path: 'sim.processing.distribution.lambda',
            type: 'input',
            label: 'Mean service time',
            unit: 'ms',
            step: 0.001,
            visible: (data) => isDistribution(data, 'exponential'),
            displayAs: {
              toDisplay: (rawValue) => lambdaToMeanMs(rawValue),
              fromDisplay: (displayValue) => meanMsToLambda(displayValue)
            },
            why: 'Displays the engine’s exponential rate parameter as the latency humans actually reason about.'
          },
          {
            path: 'sim.processing.distribution.mean',
            type: 'input',
            label: 'Mean service time',
            unit: 'ms',
            step: 0.01,
            visible: (data) => isDistribution(data, 'normal'),
            why: 'Sets the average service time for a normal distribution.'
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

export const TRAIT_CAPABILITY_MODULES: readonly NodeCapabilityModule[] = [
  rateLimiterCapabilityModule,
  contentRoutingCapabilityModule,
  healthAwareRoutingCapabilityModule,
  cacheCapabilityModule,
  coldStartCapabilityModule,
  keyBasedRoutingCapabilityModule,
  consumerLagCapabilityModule,
  dnsRoutingPolicyCapabilityModule,
  circuitBreakerCapabilityModule,
  readOnlyCapabilityModule,
  readWriteSplitCapabilityModule,
  ackAndReleaseCapabilityModule
]

export const NODE_CONFIG_MODULES: readonly NodeCapabilityModule[] = [
  SOURCE_WORKLOAD_MODULE,
  ROUTING_STRATEGY_MODULE,
  ...TRAIT_CAPABILITY_MODULES,
  BASE_QUEUE_MODULE,
  PROCESSING_MODULE,
  SECURITY_POLICY_MODULE,
  CHAOS_MODULE,
  SLO_MODULE,
  SERVICE_REGISTRY_HONESTY_MODULE
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
