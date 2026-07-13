import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type { ComponentType, EdgeDefinition } from '../core/types'

type EdgeProtocol = EdgeDefinition['protocol']
type EdgePathType = EdgeDefinition['latency']['pathType']
type LogNormalLatencyProfile = Extract<
  EdgeDefinition['latency']['distribution'],
  { type: 'log-normal' }
>

const DATABASE_TYPES = new Set<ComponentType>([
  'relational-db',
  'nosql-db',
  'time-series-db',
  'columnar-db',
  'graph-db',
  'vector-db',
  'data-warehouse',
  'data-lake',
  'kv-store'
])

const CACHE_TYPES = new Set<ComponentType>([
  'in-memory-cache',
  'cdn',
  'reverse-proxy',
  'search-index'
])

const MESSAGING_TYPES = new Set<ComponentType>([
  'queue',
  'pub-sub',
  'event-bus',
  'message-broker',
  'task-queue'
])

const STREAM_TYPES = new Set<ComponentType>(['stream', 'event-sourcing-store'])

const INTERNET_FACING_TYPES = new Set<ComponentType>([
  'api-endpoint',
  'cdn',
  'load-balancer-l7',
  'global-traffic-manager',
  'api-gateway',
  'reverse-proxy',
  'ingress-controller',
  'websockets-gateway',
  'webhook-gateway'
])

const EXTERNAL_TARGET_TYPES = new Set<ComponentType>([
  'third-party-api-connector',
  'payment-gateway',
  'third-party-auth'
])

const PATH_TYPE_LATENCY_PROFILES: Record<EdgePathType, LogNormalLatencyProfile> = {
  'same-rack': { type: 'log-normal', mu: -1.2, sigma: 0.3 },
  'same-dc': { type: 'log-normal', mu: 0.0, sigma: 0.4 },
  'cross-zone': { type: 'log-normal', mu: 0.7, sigma: 0.4 },
  'cross-region': { type: 'log-normal', mu: 4.1, sigma: 0.3 },
  internet: { type: 'log-normal', mu: 4.6, sigma: 0.8 }
}

const PATH_TYPE_BANDWIDTH_DEFAULTS: Record<EdgePathType, number> = {
  'same-rack': 10_000,
  'same-dc': 5_000,
  'cross-zone': 2_500,
  'cross-region': 1_000,
  internet: 100
}

const PROTOCOL_LATENCY_OVERHEAD_MS: Record<EdgeProtocol, number> = {
  https: 0.5,
  grpc: 0.2,
  tcp: 0,
  udp: 0,
  websocket: 0.1,
  amqp: 1,
  kafka: 2
}

export interface EdgeDefaults {
  protocol: EdgeProtocol
  pathType: EdgePathType
  latencyDistribution: LogNormalLatencyProfile
  bandwidth: number
  maxConcurrentRequests: number
  packetLossRatePercent: number
  errorRatePercent: number
}

function getType(node: CanvasNodeDataV2 | undefined): ComponentType | undefined {
  return node?.componentType
}

function isSourceNode(node: CanvasNodeDataV2 | undefined): boolean {
  return (
    node?.profile === 'source' ||
    node?.structuralRole === 'source' ||
    node?.componentType === 'api-endpoint'
  )
}

function isDatabase(type: ComponentType | undefined): boolean {
  return type !== undefined && DATABASE_TYPES.has(type)
}

function isCache(type: ComponentType | undefined): boolean {
  return type !== undefined && CACHE_TYPES.has(type)
}

function isMessaging(type: ComponentType | undefined): boolean {
  return type !== undefined && MESSAGING_TYPES.has(type)
}

function isStream(type: ComponentType | undefined): boolean {
  return type !== undefined && STREAM_TYPES.has(type)
}

function isInternetFacing(type: ComponentType | undefined): boolean {
  return type !== undefined && INTERNET_FACING_TYPES.has(type)
}

function isExternalTarget(type: ComponentType | undefined): boolean {
  return type !== undefined && EXTERNAL_TARGET_TYPES.has(type)
}

function isReplicaLink(
  sourceNode: CanvasNodeDataV2 | undefined,
  targetNode: CanvasNodeDataV2 | undefined
): boolean {
  return (
    isDatabase(getType(sourceNode)) &&
    isDatabase(getType(targetNode)) &&
    sourceNode?.sim?.replicationRole === 'primary' &&
    targetNode?.sim?.replicationRole === 'replica'
  )
}

export function getPathTypeLatencyProfile(pathType: EdgePathType): LogNormalLatencyProfile {
  return { ...PATH_TYPE_LATENCY_PROFILES[pathType] }
}

export function getProtocolLatencyOverheadMs(protocol: EdgeProtocol): number {
  return PROTOCOL_LATENCY_OVERHEAD_MS[protocol]
}

export function isReliableProtocol(protocol: EdgeProtocol): boolean {
  return protocol !== 'udp'
}

export function protocolSupportsConnectionLimits(protocol: EdgeProtocol): boolean {
  return protocol !== 'udp'
}

export function inferEdgePathType(
  sourceNode: CanvasNodeDataV2 | undefined,
  targetNode: CanvasNodeDataV2 | undefined
): EdgePathType {
  const sourceType = getType(sourceNode)
  const targetType = getType(targetNode)

  if (isReplicaLink(sourceNode, targetNode)) {
    return 'cross-zone'
  }

  if (
    isSourceNode(sourceNode) ||
    isInternetFacing(sourceType) ||
    isInternetFacing(targetType) ||
    isExternalTarget(targetType) ||
    targetNode?.profile === 'integration'
  ) {
    return 'internet'
  }

  if (isDatabase(targetType) || isCache(targetType)) {
    return 'same-rack'
  }

  if (isMessaging(targetType) || isStream(targetType) || targetNode?.profile === 'broker') {
    return 'same-dc'
  }

  return 'same-dc'
}

export function inferEdgeProtocol(
  sourceNode: CanvasNodeDataV2 | undefined,
  targetNode: CanvasNodeDataV2 | undefined,
  pathType = inferEdgePathType(sourceNode, targetNode)
): EdgeProtocol {
  const sourceType = getType(sourceNode)
  const targetType = getType(targetNode)

  if (targetType === 'websockets-gateway') {
    return 'websocket'
  }

  if (isStream(targetType)) {
    return 'kafka'
  }

  if (isMessaging(targetType)) {
    return 'amqp'
  }

  if (isDatabase(targetType) || isCache(targetType)) {
    return 'tcp'
  }

  if (sourceType === 'load-balancer-l4' || targetType === 'load-balancer-l4') {
    return 'tcp'
  }

  if (
    pathType === 'internet' ||
    isSourceNode(sourceNode) ||
    isInternetFacing(sourceType) ||
    isInternetFacing(targetType)
  ) {
    return 'https'
  }

  return 'grpc'
}

function inferBandwidth(pathType: EdgePathType, targetType: ComponentType | undefined): number {
  if (isDatabase(targetType) || isCache(targetType)) {
    return 10_000
  }

  return PATH_TYPE_BANDWIDTH_DEFAULTS[pathType]
}

function inferMaxConcurrentRequests(
  pathType: EdgePathType,
  targetType: ComponentType | undefined
): number {
  if (isDatabase(targetType)) {
    return 50
  }

  if (isCache(targetType)) {
    return 500
  }

  if (isMessaging(targetType) || isStream(targetType)) {
    return 1_000
  }

  if (pathType === 'internet') {
    return 200
  }

  return 100
}

export function inferEdgeDefaults(
  sourceNode: CanvasNodeDataV2 | undefined,
  targetNode: CanvasNodeDataV2 | undefined
): EdgeDefaults {
  const pathType = inferEdgePathType(sourceNode, targetNode)
  const targetType = getType(targetNode)

  return {
    protocol: inferEdgeProtocol(sourceNode, targetNode, pathType),
    pathType,
    latencyDistribution: getPathTypeLatencyProfile(pathType),
    bandwidth: inferBandwidth(pathType, targetType),
    maxConcurrentRequests: inferMaxConcurrentRequests(pathType, targetType),
    packetLossRatePercent: 0,
    errorRatePercent: 0
  }
}
