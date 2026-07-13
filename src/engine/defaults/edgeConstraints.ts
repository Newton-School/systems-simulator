import type { ComponentType, EdgeDefinition } from '../core/types'

const ALL_PROTOCOLS: EdgeDefinition['protocol'][] = [
  'https',
  'grpc',
  'tcp',
  'udp',
  'websocket',
  'amqp',
  'kafka'
]

const ALL_MODES: EdgeDefinition['mode'][] = [
  'synchronous',
  'asynchronous',
  'streaming',
  'conditional'
]

const DATABASE_TARGETS = new Set<ComponentType>([
  'relational-db',
  'nosql-db',
  'object-storage',
  'search-index',
  'time-series-db',
  'graph-db',
  'vector-db',
  'data-warehouse',
  'data-lake',
  'kv-store',
  'shard-node',
  'partition-node'
])

const CACHE_TARGETS = new Set<ComponentType>(['in-memory-cache', 'cdn', 'reverse-proxy'])
const DNS_TARGETS = new Set<ComponentType>(['internal-dns'])
const STREAM_TARGETS = new Set<ComponentType>(['stream'])
const MESSAGE_TARGETS = new Set<ComponentType>(['queue', 'message-broker', 'pub-sub'])
const LOAD_BALANCER_SOURCES = new Set<ComponentType>([
  'load-balancer',
  'load-balancer-l4',
  'load-balancer-l7'
])

export interface EdgeConstraints {
  allowedProtocols: readonly EdgeDefinition['protocol'][]
  allowedModes: readonly EdgeDefinition['mode'][]
  reasons: {
    protocol: Partial<Record<EdgeDefinition['protocol'], string>>
    mode: Partial<Record<EdgeDefinition['mode'], string>>
  }
  reliabilityText: string
}

function protocolReasonsFor(
  allowedProtocols: readonly EdgeDefinition['protocol'][],
  reason: string
): Partial<Record<EdgeDefinition['protocol'], string>> {
  return Object.fromEntries(
    ALL_PROTOCOLS.filter((protocol) => !allowedProtocols.includes(protocol)).map((protocol) => [
      protocol,
      reason
    ])
  )
}

function modeReasonsFor(
  allowedModes: readonly EdgeDefinition['mode'][],
  reason: string
): Partial<Record<EdgeDefinition['mode'], string>> {
  return Object.fromEntries(
    ALL_MODES.filter((mode) => !allowedModes.includes(mode)).map((mode) => [mode, reason])
  )
}

export function getEdgeConstraints(
  sourceType?: ComponentType,
  targetType?: ComponentType
): EdgeConstraints {
  if (targetType && (DATABASE_TARGETS.has(targetType) || CACHE_TARGETS.has(targetType))) {
    const reason = 'Datastores and caches speak TCP wire protocols, not HTTP, Kafka, or AMQP.'
    return {
      allowedProtocols: ['tcp'],
      allowedModes: sourceType === 'load-balancer-l4' ? ['synchronous', 'streaming'] : ALL_MODES,
      reasons: {
        protocol: protocolReasonsFor(['tcp'], reason),
        mode:
          sourceType === 'load-balancer-l4'
            ? modeReasonsFor(
                ['synchronous', 'streaming'],
                'L4 load balancers route transport connections, not conditional application branches.'
              )
            : {}
      },
      reliabilityText: 'Reliable - retransmits on loss'
    }
  }

  if (targetType && DNS_TARGETS.has(targetType)) {
    return {
      allowedProtocols: ['udp', 'tcp'],
      allowedModes: ALL_MODES,
      reasons: {
        protocol: protocolReasonsFor(
          ['udp', 'tcp'],
          'DNS typically uses UDP for lookups and TCP for larger or retried responses.'
        ),
        mode: {}
      },
      reliabilityText: 'UDP may drop packets; TCP retries'
    }
  }

  if (targetType && STREAM_TARGETS.has(targetType)) {
    return {
      allowedProtocols: ['kafka', 'tcp'],
      allowedModes: ALL_MODES,
      reasons: {
        protocol: protocolReasonsFor(
          ['kafka', 'tcp'],
          'Kafka-style streams use a broker protocol, not HTTP request/response semantics.'
        ),
        mode: {}
      },
      reliabilityText: 'Reliable - broker acknowledgements depend on protocol settings'
    }
  }

  if (targetType && MESSAGE_TARGETS.has(targetType)) {
    return {
      allowedProtocols: ['amqp', 'tcp'],
      allowedModes: ALL_MODES,
      reasons: {
        protocol: protocolReasonsFor(
          ['amqp', 'tcp'],
          'Queues and brokers use messaging protocols or raw TCP, not HTTP application routing.'
        ),
        mode: {}
      },
      reliabilityText: 'Reliable - broker acknowledgements on enqueue'
    }
  }

  const allowedModes =
    sourceType && sourceType === 'load-balancer-l4'
      ? (['synchronous', 'streaming', 'asynchronous'] as const)
      : ALL_MODES

  const reasons =
    sourceType && sourceType === 'load-balancer-l4'
      ? modeReasonsFor(
          allowedModes,
          'L4 load balancers operate on transport connections and cannot evaluate application-layer conditions.'
        )
      : {}

  return {
    allowedProtocols:
      sourceType && LOAD_BALANCER_SOURCES.has(sourceType)
        ? ['https', 'grpc', 'tcp', 'udp', 'websocket']
        : ['https', 'grpc', 'tcp', 'udp', 'websocket', 'amqp', 'kafka'],
    allowedModes,
    reasons: {
      protocol:
        sourceType && LOAD_BALANCER_SOURCES.has(sourceType)
          ? protocolReasonsFor(
              ['https', 'grpc', 'tcp', 'udp', 'websocket'],
              'Load balancers forward client traffic, not broker-native protocols.'
            )
          : {},
      mode: reasons
    },
    reliabilityText: 'Reliable protocols retry; UDP trades reliability for speed'
  }
}

export function validateEdgeConstraintSelection(
  edge: Pick<
    EdgeDefinition,
    'protocol' | 'mode' | 'packetLossRate' | 'maxConcurrentRequests' | 'bandwidth'
  >,
  sourceType?: ComponentType,
  targetType?: ComponentType
): string[] {
  const constraints = getEdgeConstraints(sourceType, targetType)
  const warnings: string[] = []

  if (!constraints.allowedProtocols.includes(edge.protocol)) {
    warnings.push(
      constraints.reasons.protocol[edge.protocol] ?? 'This protocol is unrealistic here.'
    )
  }

  if (!constraints.allowedModes.includes(edge.mode)) {
    warnings.push(constraints.reasons.mode[edge.mode] ?? 'This edge mode is unrealistic here.')
  }

  if (sourceType && LOAD_BALANCER_SOURCES.has(sourceType) && edge.mode === 'asynchronous') {
    warnings.push(
      'Load balancers normally proxy live requests; async edges here are a deliberate simplification.'
    )
  }

  if (edge.bandwidth < 10 && edge.mode !== 'asynchronous') {
    warnings.push(
      'Bandwidth below 10 Mbps is unusually low for an actively routed application edge.'
    )
  }

  if (edge.maxConcurrentRequests > 10_000) {
    warnings.push(
      'Max concurrent requests above 10,000 is unusually high and may hide connection-pool bottlenecks.'
    )
  }

  if (edge.packetLossRate > 0.1) {
    warnings.push(
      'Packet loss above 10% is extremely severe outside intentionally hostile networks.'
    )
  }

  return warnings
}
