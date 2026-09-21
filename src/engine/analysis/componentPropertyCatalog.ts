import type { ComponentType } from '../core/types'
import type { ComponentPropertyExpectedValue, ComponentPropertyOperator } from './gradingCriteria'

export interface ComponentPropertyDefinition {
  id: string
  label: string
  valueType: 'string' | 'number' | 'boolean'
  options?: readonly ComponentPropertyExpectedValue[]
  componentTypes?: readonly ComponentType[]
  operators: readonly ComponentPropertyOperator[]
}

const COMPARISON_OPERATORS = ['equals', 'notEquals', 'atLeast', 'atMost'] as const
const EQUALITY_OPERATORS = ['equals', 'notEquals'] as const

/**
 * Engine-owned allow-list for authorable node configuration checks. Keeping this
 * registry beside the evaluator prevents the Studio from exposing arbitrary JSON paths.
 */
export const COMPONENT_PROPERTY_DEFINITIONS: readonly ComponentPropertyDefinition[] = [
  {
    id: 'dataModel',
    label: 'Data model',
    valueType: 'string',
    options: ['document', 'key-value', 'wide-column'],
    componentTypes: ['nosql-db'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'replicationEnabled',
    label: 'Replication enabled',
    valueType: 'boolean',
    options: [true, false],
    componentTypes: ['relational-db', 'nosql-db'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'replicationRole',
    label: 'Replication role',
    valueType: 'string',
    options: ['leader', 'follower', 'primary', 'replica'],
    componentTypes: ['relational-db', 'nosql-db'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'shardCount',
    label: 'Shard count',
    valueType: 'number',
    componentTypes: ['relational-db', 'nosql-db'],
    operators: COMPARISON_OPERATORS
  },
  {
    id: 'writeAckPolicy',
    label: 'Write acknowledgement policy',
    valueType: 'string',
    options: ['primary', 'quorum'],
    componentTypes: ['relational-db', 'nosql-db'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'consensusProtocol',
    label: 'Consensus protocol',
    valueType: 'string',
    options: ['raft', 'none'],
    componentTypes: ['relational-db', 'nosql-db'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'cacheStrategy',
    label: 'Cache strategy',
    valueType: 'string',
    options: ['cache-aside', 'read-through', 'write-through', 'write-behind'],
    componentTypes: ['in-memory-cache'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'cacheEngine',
    label: 'Cache engine',
    valueType: 'string',
    options: ['redis', 'memcached'],
    componentTypes: ['in-memory-cache'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'consumerGroupMode',
    label: 'Consumer-group delivery enabled',
    valueType: 'boolean',
    options: [true, false],
    componentTypes: ['queue', 'pub-sub', 'stream', 'message-broker', 'task-queue'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'streamBrokerEnabled',
    label: 'Stream broker enabled',
    valueType: 'boolean',
    options: [true, false],
    componentTypes: ['stream'],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'partitionCount',
    label: 'Partition count',
    valueType: 'number',
    componentTypes: ['stream'],
    operators: COMPARISON_OPERATORS
  },
  {
    id: 'healthCheckEnabled',
    label: 'Health checks enabled',
    valueType: 'boolean',
    options: [true, false],
    operators: EQUALITY_OPERATORS
  },
  {
    id: 'maxConcurrency',
    label: 'Maximum concurrency',
    valueType: 'number',
    operators: COMPARISON_OPERATORS
  },
  {
    id: 'maxTokens',
    label: 'Rate-limit token capacity',
    valueType: 'number',
    componentTypes: ['rate-limiter'],
    operators: COMPARISON_OPERATORS
  },
  {
    id: 'refillRatePerSecond',
    label: 'Rate-limit refill per second',
    valueType: 'number',
    componentTypes: ['rate-limiter'],
    operators: COMPARISON_OPERATORS
  },
  {
    id: 'dnsRoutingPolicy',
    label: 'DNS routing policy',
    valueType: 'string',
    options: ['simple', 'weighted', 'failover', 'latency-based', 'geolocation'],
    componentTypes: ['dns-authoritative-server', 'internal-dns'],
    operators: EQUALITY_OPERATORS
  }
]

export function getComponentPropertyDefinition(
  property: string
): ComponentPropertyDefinition | undefined {
  return COMPONENT_PROPERTY_DEFINITIONS.find((definition) => definition.id === property)
}

export function componentPropertyDefinitionsFor(
  componentType: string | undefined
): readonly ComponentPropertyDefinition[] {
  if (!componentType) return COMPONENT_PROPERTY_DEFINITIONS
  return COMPONENT_PROPERTY_DEFINITIONS.filter(
    (definition) =>
      !definition.componentTypes ||
      definition.componentTypes.includes(componentType as ComponentType)
  )
}
