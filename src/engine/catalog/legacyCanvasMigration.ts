import type { Node } from 'reactflow'
import { getComponentSpec } from './componentSpecs'
import { getPaletteTemplate, instantiateTemplate } from './paletteTemplates'
import { isCanvasAnnotationNodeType } from './canvasAnnotations'
import type { CanvasNodeDataV2 } from './nodeSpecTypes'

const LEGACY_COMPUTE_TYPE_TO_TEMPLATE: Record<string, string> = {
  SERVER: 'backend-server',
  LAMBDA: 'lambda-function',
  WORKER: 'async-worker',
  CRON: 'cron-job',
  AUTH: 'auth-service',
  SEARCH_SERVICE: 'search-service',
  SIDECAR: 'sidecar-proxy'
}

const LEGACY_ICON_KEY_TO_TEMPLATE: Record<string, string> = {
  cloud: 'vpc-region',
  az: 'availability-zone',
  subnet: 'subnet',
  database: 'primary-db',
  server: 'redis-cache',
  network: 'load-balancer',
  'load-balancer-l4': 'load-balancer-l4',
  'load-balancer-l7': 'load-balancer-l7',
  ingress: 'ingress-controller',
  proxy: 'reverse-proxy',
  'service-mesh': 'service-mesh',
  nat: 'nat-gateway',
  vpn: 'vpn-gateway',
  'routing-rule': 'routing-rule',
  'routing-policy': 'routing-policy',
  'edge-router': 'edge-router',
  'network-interface': 'network-interface',
  waf: 'waf',
  firewall: 'firewall-rule',
  'security-group': 'security-group',
  'server-cog': 'dns-server',
  'book-open': 'discovery-service',
  monitor: 'client-user',
  dns: 'dns',
  cdn: 'cdn',
  globe: 'api-gateway',
  queue: 'message-queue',
  broker: 'message-broker',
  'pub-sub': 'pub-sub',
  stream: 'stream',
  nosql: 'nosql-db',
  replica: 'read-replica',
  storage: 'object-storage',
  search: 'search-index',
  'time-series-db': 'time-series-db',
  'graph-db': 'graph-db',
  'vector-db': 'vector-db',
  'data-warehouse': 'data-warehouse',
  'data-lake': 'data-lake',
  'kv-store': 'kv-store',
  notification: 'push-notification-service',
  analytics: 'streaming-analytics',
  'llm-gateway': 'llm-gateway',
  'tool-registry': 'tool-registry',
  'memory-fabric': 'memory-fabric',
  'agent-orchestrator': 'agent-orchestrator',
  'safety-mesh': 'safety-observability-mesh',
  'generic-service': 'generic-service',
  'my-service': 'my-service',
  'input-source': 'input-source',
  'output-sink': 'output-sink',
  external: 'external-service',
  sharding: 'sharding',
  hashing: 'hashing',
  'shard-node': 'shard-node',
  'partition-node': 'partition-node',
  config: 'config-store',
  secrets: 'secrets-manager',
  flags: 'feature-flag-service',
  'metrics-collector': 'metrics-collector-agent',
  'log-collector': 'log-collector-agent',
  'log-aggregator': 'log-aggregation-service',
  tracing: 'distributed-tracing-collector',
  alerting: 'alerting-engine',
  'health-check': 'health-check-monitor'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCanvasNodeDataV2(value: unknown): value is CanvasNodeDataV2 {
  return (
    isRecord(value) &&
    value['schemaVersion'] === 2 &&
    typeof value['templateId'] === 'string' &&
    typeof value['profile'] === 'string'
  )
}

function resolveLegacyTemplateId(node: Node): string | null {
  const data = isRecord(node.data) ? node.data : {}

  const registryId = typeof data.registryId === 'string' ? data.registryId : undefined
  if (registryId && getPaletteTemplate(registryId)) {
    return registryId
  }

  if (node.type === 'computeNode' && typeof data.computeType === 'string') {
    return LEGACY_COMPUTE_TYPE_TO_TEMPLATE[data.computeType] ?? null
  }

  const iconKey = typeof data.iconKey === 'string' ? data.iconKey : undefined
  if (iconKey && LEGACY_ICON_KEY_TO_TEMPLATE[iconKey]) {
    return LEGACY_ICON_KEY_TO_TEMPLATE[iconKey]
  }

  return null
}

export function migrateCanvasNodeData(node: Node): CanvasNodeDataV2 {
  if (isCanvasNodeDataV2(node.data)) {
    return node.data
  }

  const templateId = resolveLegacyTemplateId(node)
  if (!templateId) {
    throw new Error(`Unable to migrate legacy node '${node.id}' — unknown template.`)
  }

  const next = instantiateTemplate(templateId)
  const legacy = isRecord(node.data) ? node.data : {}
  const spec = getComponentSpec(next.componentType)

  if (typeof legacy.label === 'string' && legacy.label.trim().length > 0) {
    next.label = legacy.label
  }

  if (typeof legacy.subLabel === 'string' && legacy.subLabel.trim().length > 0) {
    next.subLabel = legacy.subLabel
  }

  if (next.profile === 'source') {
    if (next.source) {
      const baseRps =
        typeof legacy.throughput === 'number' && legacy.throughput > 0
          ? legacy.throughput
          : next.source.defaultWorkload.baseRps
      next.source.defaultWorkload.baseRps = baseRps
    }
    return next
  }

  if (spec) {
    next.sim = spec.createDefaultSimulationConfig({
      throughput: typeof legacy.throughput === 'number' ? legacy.throughput : undefined,
      load: typeof legacy.load === 'number' ? legacy.load : undefined,
      queueDepth: typeof legacy.queueDepth === 'number' ? legacy.queueDepth : undefined,
      workers: typeof legacy.workers === 'number' ? legacy.workers : undefined,
      capacity: typeof legacy.capacity === 'number' ? legacy.capacity : undefined,
      queueDiscipline:
        legacy.queueDiscipline === 'fifo' ||
        legacy.queueDiscipline === 'lifo' ||
        legacy.queueDiscipline === 'priority' ||
        legacy.queueDiscipline === 'wfq'
          ? legacy.queueDiscipline
          : undefined,
      meanServiceMs: typeof legacy.meanServiceMs === 'number' ? legacy.meanServiceMs : undefined,
      timeoutMs: typeof legacy.timeoutMs === 'number' ? legacy.timeoutMs : undefined,
      vCPU: typeof legacy.vCPU === 'number' ? legacy.vCPU : undefined,
      ram: typeof legacy.ram === 'number' ? legacy.ram : undefined,
      nodeErrorRate: typeof legacy.errorRate === 'number' ? legacy.errorRate : undefined,
      blockRate: typeof legacy.blockRate === 'number' ? legacy.blockRate : undefined,
      droppedPackets: typeof legacy.droppedPackets === 'number' ? legacy.droppedPackets : undefined,
      overloadPreview: Boolean(legacy.isOverloaded)
    })
  }

  return next
}

export function migrateCanvasNode(node: Node): Node {
  if (isCanvasAnnotationNodeType(node.type)) {
    return node
  }

  return {
    ...node,
    data: migrateCanvasNodeData(node)
  }
}

export function migrateCanvasNodes(nodes: Node[]): Node[] {
  return nodes.map(migrateCanvasNode)
}
