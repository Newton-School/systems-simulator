import { CatalogCategory } from '@renderer/types/ui'
import { NODE_REGISTRY } from '@renderer/config/nodeRegistry'
import { getTheme } from '@renderer/config/themeConfig'
import { getLibraryItemInfo } from '@renderer/config/libraryInfo'

const fromRegistry = (id: string) => {
  const def = NODE_REGISTRY[id]
  if (!def) {
    console.warn(`Node registry missing definition for node id: ${id}`)
    return null // Handle error gracefully
  }
  const theme = getTheme(def.lookupKey)

  const item = {
    id: def.id,
    templateId: def.id,
    type: def.type,
    label: def.label,
    subLabel: def.subLabel,
    icon: def.icon,
    color: theme
  }

  return {
    ...item,
    info: getLibraryItemInfo(item)
  }
}

const getItems = (ids: string[]) => {
  return ids.map(fromRegistry).filter((item): item is NonNullable<typeof item> => item !== null)
}

export const CATALOG_CONFIG: CatalogCategory[] = [
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    items: getItems([
      'vpc-region',
      'availability-zone',
      'subnet',
      'dns-server',
      'discovery-service'
    ])
  },
  {
    id: 'clients-edge',
    title: 'Clients & Edge',
    items: getItems(['client-user', 'dns', 'cdn'])
  },
  {
    id: 'network',
    title: 'Network',
    items: getItems([
      'api-gateway',
      'load-balancer-l4',
      'load-balancer-l7',
      'ingress-controller',
      'reverse-proxy',
      'service-mesh',
      'nat-gateway',
      'vpn-gateway',
      'edge-router',
      'network-interface',
      'routing-rule',
      'routing-policy'
    ])
  },
  {
    id: 'security',
    title: 'Security',
    items: getItems(['waf', 'firewall-rule', 'security-group'])
  },
  {
    id: 'compute',
    title: 'Compute',
    items: getItems([
      'backend-server',
      'lambda-function',
      'async-worker',
      'cron-job',
      'auth-service',
      'search-service',
      'sidecar-proxy'
    ])
  },
  {
    id: 'messaging',
    title: 'Messaging',
    items: getItems(['message-queue', 'message-broker', 'pub-sub', 'stream'])
  },
  {
    id: 'datastore',
    title: 'Data Stores',
    items: getItems([
      'primary-db',
      'read-replica',
      'redis-cache',
      'nosql-db',
      'object-storage',
      'search-index',
      'time-series-db',
      'graph-db',
      'vector-db',
      'data-warehouse',
      'data-lake',
      'kv-store'
    ])
  },
  {
    id: 'app-support',
    title: 'App Services',
    items: getItems(['push-notification-service', 'streaming-analytics'])
  },
  {
    id: 'external',
    title: 'External',
    items: getItems(['external-service'])
  },
  {
    id: 'templates',
    title: 'Templates',
    items: getItems(['generic-service', 'my-service', 'input-source', 'output-sink'])
  },
  {
    id: 'ai-agents',
    title: 'AI & Agents',
    items: getItems([
      'llm-gateway',
      'tool-registry',
      'memory-fabric',
      'agent-orchestrator',
      'safety-observability-mesh'
    ])
  },
  {
    id: 'control-plane',
    title: 'Control Plane',
    items: getItems(['config-store', 'secrets-manager', 'feature-flag-service'])
  },
  {
    id: 'scaling',
    title: 'Scaling & Partitioning',
    items: getItems(['sharding', 'hashing', 'shard-node', 'partition-node'])
  },
  {
    id: 'observability',
    title: 'Observability',
    items: getItems([
      'metrics-collector-agent',
      'log-collector-agent',
      'log-aggregation-service',
      'distributed-tracing-collector',
      'alerting-engine',
      'health-check-monitor'
    ])
  }
]
