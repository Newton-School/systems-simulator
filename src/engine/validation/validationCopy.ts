import type { ComponentType } from '../core/types'

interface QueueFieldLabels {
  workers: string
  capacity: string
}

const DEFAULT_QUEUE_FIELD_LABELS: QueueFieldLabels = {
  workers: 'Workers',
  capacity: 'Queue capacity'
}

const QUEUE_FIELD_LABELS_BY_TYPE: Partial<Record<ComponentType, QueueFieldLabels>> = {
  'load-balancer': {
    workers: 'Max concurrent connections',
    capacity: 'Connection queue limit'
  },
  'load-balancer-l4': {
    workers: 'Max concurrent connections',
    capacity: 'Connection queue limit'
  },
  'load-balancer-l7': {
    workers: 'Max concurrent connections',
    capacity: 'Connection queue limit'
  },
  'api-gateway': {
    workers: 'Max concurrent requests',
    capacity: 'Request queue limit'
  },
  'ingress-controller': {
    workers: 'Max concurrent requests',
    capacity: 'Request queue limit'
  },
  'reverse-proxy': {
    workers: 'Max concurrent requests',
    capacity: 'Request queue limit'
  },
  'relational-db': {
    workers: 'Connection pool size',
    capacity: 'Query queue limit'
  },
  'in-memory-cache': {
    workers: 'Concurrent operations',
    capacity: 'Operation queue limit'
  },
  cdn: {
    workers: 'Concurrent origin fetches',
    capacity: 'Origin queue limit'
  },
  queue: {
    workers: 'Consumer concurrency',
    capacity: 'Backlog limit'
  },
  'service-registry': {
    workers: 'Lookup concurrency',
    capacity: 'Lookup queue limit'
  }
}

export const VALIDATION_COPY = {
  missingQueue: 'This component is missing queue settings.',
  missingProcessing: 'This component is missing performance settings.',
  missingSourceWorkload: 'This source is missing workload settings.',
  missingSecurityPolicy: 'Security filter needs either a block rate or a dropped-packet count.',
  requestDistributionEmpty: 'Requests must include at least one request type.',
  requestDistributionWeights: 'Request weights must add up to 100%.',
  workloadPatternRequired: 'Please choose a workload pattern.',
  contentRoutingNotAllowed:
    'L4 operates at the transport layer and cannot inspect HTTP content. Use an L7 Load Balancer for content-based routing.',
  routingRulesArray: 'Routing rules must be a list of rules.',
  sinkRoutingForbidden: 'Sink nodes cannot use routing settings.',
  dnsGeoTargets: 'Geolocation targets must be a list of origin-to-target mappings.',
  monitoredNodes: 'Monitored nodes must be a list of node IDs.',
  workloadSourceMissing: 'The selected workload source does not exist.',
  sourceNodeRequired:
    'Add at least one source node or choose a workload source before running the simulation.',
  conditionalEdgeExpression: 'Conditional edges need a condition expression.',
  simulationTiming: 'Simulation duration must be greater than warmup duration.'
} as const

export type ValidationCopyKey = keyof typeof VALIDATION_COPY

export function validationMessage(key: ValidationCopyKey): string {
  return VALIDATION_COPY[key]
}

export function queueFieldLabels(componentType: string | undefined): QueueFieldLabels {
  return QUEUE_FIELD_LABELS_BY_TYPE[componentType as ComponentType] ?? DEFAULT_QUEUE_FIELD_LABELS
}

export function wholeNumberAtLeastOne(label: string): string {
  return `${label} must be a whole number of 1 or more.`
}

export function positiveNumber(label: string, unit?: string): string {
  return `${label} must be greater than 0${unit ? ` ${unit}` : ''}.`
}

export function nonNegativeNumber(label: string, unit?: string): string {
  return `${label} must be 0${unit ? ` ${unit}` : ''} or greater.`
}

export function probability(label: string): string {
  return `${label} must be between 0 and 1 (0-100%).`
}

export function validDistribution(label: string): string {
  return `${label} must be a valid distribution.`
}

export function oneOf(label: string, values: readonly string[]): string {
  if (values.length <= 1) {
    return `${label} must be ${values[0] ?? 'a supported value'}.`
  }
  return `${label} must be ${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}.`
}

export function queueCapacityAtLeastWorkers(capacityLabel: string, workersLabel: string): string {
  return `${capacityLabel} must be at least as large as ${workersLabel}.`
}

export function routingRuleUnsupportedMatchField(
  index: number,
  allowedLabels: readonly string[]
): string {
  return `Routing rule ${index + 1} uses an unsupported match field. Choose ${allowedLabels.join(', ')}.`
}

export function routingRuleMissingMatchValue(index: number): string {
  return `Routing rule ${index + 1} needs a match value.`
}

export function routingRuleMissingTarget(index: number): string {
  return `Routing rule ${index + 1} needs a target node.`
}
