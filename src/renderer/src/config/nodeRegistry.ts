import {
  Activity,
  ArrowRightLeft,
  Bell,
  BellRing,
  BookOpen,
  Box,
  Cloud,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  Fingerprint,
  GitBranch,
  Globe,
  HardDrive,
  HeartPulse,
  Key,
  LayoutGrid,
  Layers,
  Library,
  LineChart,
  LockKeyhole,
  LucideIcon,
  Monitor,
  Navigation,
  Network,
  Radar,
  Radio,
  Router,
  Search,
  Server,
  ServerCog,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  ToggleLeft,
  Waypoints,
  Wifi,
  Zap
} from 'lucide-react'
import { instantiateTemplate, PALETTE_TEMPLATES } from '../../../engine/catalog/paletteTemplates'
import { getTheme } from './themeConfig'
import type { AnyNodeData } from '@renderer/types/ui'
import type { RendererNodeType } from '../../../engine/catalog/nodeSpecTypes'

export interface NodeDef {
  id: string
  type: RendererNodeType
  label: string
  subLabel: string
  icon: LucideIcon
  lookupKey: string
  defaultData: AnyNodeData
}

const ICON_BY_TEMPLATE: Record<string, LucideIcon> = {
  'backend-server': Server,
  'lambda-function': Zap,
  'async-worker': Cpu,
  'cron-job': Clock,
  'auth-service': Fingerprint,
  'search-service': Search,
  'sidecar-proxy': ArrowRightLeft,
  'primary-db': Database,
  'redis-cache': Server,
  'load-balancer': Network,
  'load-balancer-l4': Network,
  'load-balancer-l7': Globe,
  'ingress-controller': Waypoints,
  'reverse-proxy': ArrowRightLeft,
  'service-mesh': Waypoints,
  'nat-gateway': Router,
  'vpn-gateway': LockKeyhole,
  'routing-rule': GitBranch,
  'routing-policy': Waypoints,
  'edge-router': Router,
  'network-interface': ArrowRightLeft,
  waf: Shield,
  'firewall-rule': ShieldAlert,
  'security-group': ShieldCheck,
  'vpc-region': Cloud,
  'availability-zone': Box,
  subnet: LayoutGrid,
  'dns-server': ServerCog,
  'discovery-service': BookOpen,
  'client-user': Monitor,
  dns: Navigation,
  cdn: Wifi,
  'api-gateway': Globe,
  'message-queue': BellRing,
  'message-broker': Radio,
  'pub-sub': Bell,
  stream: Activity,
  'nosql-db': Layers,
  'read-replica': GitBranch,
  'object-storage': HardDrive,
  'search-index': Search,
  'time-series-db': LineChart,
  'graph-db': GitBranch,
  'vector-db': Radar,
  'data-warehouse': HardDrive,
  'data-lake': Layers,
  'kv-store': Database,
  'push-notification-service': Bell,
  'streaming-analytics': LineChart,
  'llm-gateway': Globe,
  'tool-registry': Library,
  'memory-fabric': Cpu,
  'agent-orchestrator': Cpu,
  'safety-observability-mesh': ShieldCheck,
  'generic-service': Box,
  'my-service': Server,
  'input-source': Navigation,
  'output-sink': ExternalLink,
  'external-service': ExternalLink,
  sharding: GitBranch,
  hashing: Fingerprint,
  'shard-node': Box,
  'partition-node': LayoutGrid,
  'config-store': Sliders,
  'secrets-manager': Key,
  'feature-flag-service': ToggleLeft,
  'rate-limiter': Clock,
  'circuit-breaker-controller': ShieldAlert,
  'distributed-lock': LockKeyhole,
  'idempotency-manager': Key,
  'reservation-store': Key,
  'metrics-collector-agent': Activity,
  'log-collector-agent': FileText,
  'log-aggregation-service': Library,
  'distributed-tracing-collector': Activity,
  'alerting-engine': BellRing,
  'health-check-monitor': HeartPulse
}

export const NODE_REGISTRY: Record<string, NodeDef> = Object.fromEntries(
  Object.values(PALETTE_TEMPLATES).map((template) => [
    template.id,
    {
      id: template.id,
      type: template.rendererType,
      label: template.label,
      subLabel: template.subLabel,
      icon: ICON_BY_TEMPLATE[template.id] ?? Settings,
      lookupKey: template.iconKey,
      defaultData: instantiateTemplate(template.id)
    }
  ])
)

export const resolveNodeConfig = (key: string | undefined) => {
  if (!key) return { icon: Settings, theme: getTheme('default'), label: 'Unknown', subLabel: '' }

  const byId = NODE_REGISTRY[key]
  if (byId) return { ...byId, theme: getTheme(byId.lookupKey) }

  const byLookup = Object.values(NODE_REGISTRY).find((def) => def.lookupKey === key)
  if (byLookup) return { ...byLookup, theme: getTheme(byLookup.lookupKey) }

  return {
    icon: Settings,
    theme: getTheme('default'),
    label: 'Unknown',
    subLabel: ''
  }
}

export const COMPUTE_DEFAULTS = {
  SERVER: {
    label: NODE_REGISTRY['backend-server'].label,
    subLabel: NODE_REGISTRY['backend-server'].subLabel
  },
  LAMBDA: {
    label: NODE_REGISTRY['lambda-function'].label,
    subLabel: NODE_REGISTRY['lambda-function'].subLabel
  },
  WORKER: {
    label: NODE_REGISTRY['async-worker'].label,
    subLabel: NODE_REGISTRY['async-worker'].subLabel
  },
  CRON: { label: NODE_REGISTRY['cron-job'].label, subLabel: NODE_REGISTRY['cron-job'].subLabel },
  AUTH: {
    label: NODE_REGISTRY['auth-service'].label,
    subLabel: NODE_REGISTRY['auth-service'].subLabel
  },
  SEARCH_SERVICE: {
    label: NODE_REGISTRY['search-service'].label,
    subLabel: NODE_REGISTRY['search-service'].subLabel
  },
  SIDECAR: {
    label: NODE_REGISTRY['sidecar-proxy'].label,
    subLabel: NODE_REGISTRY['sidecar-proxy'].subLabel
  }
}
