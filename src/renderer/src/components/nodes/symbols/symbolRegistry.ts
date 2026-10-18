import type React from 'react'
import type { GlyphProps, SymbolOverlay, SymbolShape } from './glyphs'
import {
  Client,
  Cdn,
  Gateway,
  LoadBalancer,
  Server,
  Auth,
  Queue,
  Database,
  Cache,
  Region,
  Zone,
  Subnet
} from './glyphs'

type Glyph = (props: GlyphProps) => React.JSX.Element

/** A bespoke glyph, or a shape with an inner mark. */
type SymbolDef = { color: string } & (
  | { glyph: Glyph; shape?: never; overlay?: never }
  | { glyph?: never; shape: SymbolShape; overlay?: SymbolOverlay }
)

// Reusable inner marks (24px box centred on 32,32).
const GLOBE: SymbolOverlay = {
  circles: [[32, 32, 9]],
  paths: ['M28.4 32a3.6 9 0 1 0 7.2 0a3.6 9 0 1 0-7.2 0', 'M23 32h18']
}
const MAGNIFIER: SymbolOverlay = { circles: [[29, 29, 8]], paths: ['M35 35l9 9'] }
const LOCK: SymbolOverlay = { paths: ['M24 31h16v12H24Z', 'M28 31v-4a4 4 0 0 1 8 0v4'] }
const HUB: SymbolOverlay = {
  paths: ['M32 32V20M32 32l-11 7M32 32l11 7'],
  dots: [
    [32, 32],
    [32, 20],
    [21, 39],
    [43, 39]
  ]
}
const BELL_MARK: SymbolOverlay = {
  paths: [
    'M32 21a2 2 0 0 1 2 2 8 8 0 0 1 6 8v6l3 4H21l3-4v-6a8 8 0 0 1 6-8 2 2 0 0 1 2-2Z',
    'M29 45a3 3 0 0 0 6 0'
  ]
}
const CHART_LINE: SymbolOverlay = { paths: ['M22 41l6-8 5 4 8-12'] }
const GRID: SymbolOverlay = {
  paths: ['M23 23h8v8h-8Z', 'M33 23h8v8h-8Z', 'M23 33h8v8h-8Z', 'M33 33h8v8h-8Z']
}
const DOC: SymbolOverlay = { paths: ['M25 21h14v22H25Z', 'M29 27h6M29 32h6M29 37h4'] }

/** Palette template id -> symbol. Templates not listed keep the card rendering. */
export const SYMBOL_BY_TEMPLATE: Readonly<Record<string, SymbolDef>> = {
  // Approved bespoke set
  'client-user': { glyph: Client, color: '#0ea5e9' },
  cdn: { glyph: Cdn, color: '#14b8a6' },
  'api-gateway': { glyph: Gateway, color: '#a855f7' },
  'load-balancer-l7': { glyph: LoadBalancer, color: '#8b5cf6' },
  'backend-server': { glyph: Server, color: '#6366f1' },
  'auth-service': { glyph: Auth, color: '#ef4444' },
  'message-queue': { glyph: Queue, color: '#f59e0b' },
  'primary-db': { glyph: Database, color: '#10b981' },
  'redis-cache': { glyph: Cache, color: '#f97316' },

  // Containers (group boxes)
  'vpc-region': { glyph: Region, color: '#3b82f6' },
  'availability-zone': { glyph: Zone, color: '#f97316' },
  subnet: { glyph: Subnet, color: '#0ea5e9' },

  // Compute
  'id-generator': { shape: 'box', overlay: { text: 'ID' }, color: '#64748b' },
  'lambda-function': {
    shape: 'box',
    overlay: { paths: ['M24 20h4l12 24M32 32l-8 12'] },
    color: '#eab308'
  },
  'async-worker': {
    shape: 'box',
    overlay: {
      circles: [[32, 32, 5.5]],
      paths: [
        'M32 19v5M32 40v5M19 32h5M40 32h5M23 23l3.5 3.5M37.5 37.5 41 41M41 23l-3.5 3.5M26.5 37.5 23 41'
      ]
    },
    color: '#10b981'
  },
  'cron-job': {
    shape: 'box',
    overlay: { circles: [[32, 32, 11]], paths: ['M32 25v7l5 3'] },
    color: '#6b7280'
  },
  'search-service': { shape: 'box', overlay: MAGNIFIER, color: '#8b5cf6' },
  'sidecar-proxy': {
    shape: 'box',
    overlay: { paths: ['M22 22h12v20H22Z', 'M38 28h6v8h-6Z'] },
    color: '#06b6d4'
  },
  'generic-service': {
    shape: 'box',
    overlay: { paths: ['M22 26h20M22 32h20M22 38h12'] },
    color: '#64748b'
  },
  'my-service': {
    shape: 'box',
    overlay: { paths: ['M22 26h20M22 32h20M22 38h12'] },
    color: '#6366f1'
  },
  'custom-node-builder': {
    shape: 'box',
    overlay: { paths: ['M32 21v22M21 32h22'] },
    color: '#94a3b8'
  },
  'input-source': { shape: 'box', overlay: { paths: ['M27 22l16 10-16 10Z'] }, color: '#10b981' },

  // Network and edge
  'load-balancer': { glyph: LoadBalancer, color: '#3b82f6' },
  'load-balancer-l4': { glyph: LoadBalancer, color: '#2563eb' },
  'ingress-controller': {
    shape: 'hex',
    overlay: { paths: ['M20 32h22m-6-6 6 6-6 6'] },
    color: '#6366f1'
  },
  'reverse-proxy': {
    shape: 'hex',
    overlay: { paths: ['M20 32h24M26 26l-6 6 6 6M38 26l6 6-6 6'] },
    color: '#3b82f6'
  },
  'service-mesh': {
    shape: 'circle',
    overlay: {
      paths: ['M24 24h16v16H24ZM24 24l16 16M40 24 24 40'],
      dots: [
        [24, 24],
        [40, 24],
        [24, 40],
        [40, 40]
      ]
    },
    color: '#d946ef'
  },
  'nat-gateway': {
    shape: 'hex',
    overlay: { paths: ['M22 24v16M26 32h16m-6-6 6 6-6 6'] },
    color: '#0ea5e9'
  },
  'vpn-gateway': { shape: 'hex', overlay: LOCK, color: '#14b8a6' },
  'routing-rule': {
    shape: 'circle',
    overlay: { paths: ['M20 32h9M29 32l12-9M29 32l12 9'] },
    color: '#8b5cf6'
  },
  'routing-policy': {
    shape: 'circle',
    overlay: { paths: ['M24 21h16v22H24Z', 'M28 27h8M28 32h8M28 37h5'] },
    color: '#7c3aed'
  },
  'edge-router': {
    shape: 'hex',
    overlay: {
      paths: ['M32 20v24M20 32h24M28 24l4-4 4 4M28 40l4 4 4-4M24 28l-4 4 4 4M40 28l4 4-4 4']
    },
    color: '#4f46e5'
  },
  'network-interface': {
    shape: 'box',
    overlay: { paths: ['M23 24h18v12H23Z', 'M27 36v5M32 36v5M37 36v5'] },
    color: '#0ea5e9'
  },
  'connection-server': {
    shape: 'box',
    overlay: { paths: ['M26 21v8M38 21v8M23 29h18v6a9 9 0 0 1-18 0Z', 'M32 44v4'] },
    color: '#64748b'
  },
  'global-traffic-manager': { shape: 'circle', overlay: GLOBE, color: '#a855f7' },

  // DNS and discovery
  dns: { shape: 'circle', overlay: GLOBE, color: '#64748b' },
  'dns-server': { shape: 'box', overlay: GLOBE, color: '#64748b' },
  'discovery-service': {
    shape: 'box',
    overlay: { paths: ['M22 22h20v20H22Z', 'M22 28h20M28 22v20'] },
    color: '#d946ef'
  },

  // Security
  waf: {
    shape: 'shield',
    overlay: { paths: ['M22 24h20M22 31h20M22 38h20M32 24v7M27 31v7M37 31v7'] },
    color: '#e11d48'
  },
  'firewall-rule': {
    shape: 'shield',
    overlay: { paths: ['M32 20c2 6 8 8 8 15a8 8 0 0 1-16 0c0-4 3-5 3-9 2 1 4 2 5-6Z'] },
    color: '#f97316'
  },
  'security-group': {
    shape: 'shield',
    overlay: {
      paths: ['M26 22h-4v4M38 22h4v4M26 42h-4v-4M38 42h4v-4'],
      dots: [[32, 32]]
    },
    color: '#f43f5e'
  },

  // Messaging and streaming
  'message-broker': { shape: 'hex', overlay: HUB, color: '#f43f5e' },
  'pub-sub': {
    shape: 'hex',
    overlay: {
      paths: [
        'M26 26a8 8 0 0 0 0 12M38 26a8 8 0 0 1 0 12M22 22a14 14 0 0 0 0 20M42 22a14 14 0 0 1 0 20'
      ],
      dots: [[32, 32]]
    },
    color: '#ec4899'
  },
  stream: {
    shape: 'pipe',
    overlay: { paths: ['M18 32q3-6 6 0t6 0t6 0t6 0'] },
    color: '#fb923c'
  },
  'push-notification-service': { shape: 'bell', color: '#f472b6' },

  // Storage and data
  'nosql-db': {
    shape: 'cylinder',
    overlay: { paths: ['M28 22c-3 0-3 2-3 4s0 4 3 4M36 22c3 0 3 2 3 4s0 4-3 4'] },
    color: '#65a30d'
  },
  'kv-store': {
    shape: 'cylinder',
    overlay: { circles: [[26, 28, 3.5]], paths: ['M29.5 28H42M38 28v4M42 28v3'] },
    color: '#84cc16'
  },
  'read-replica': {
    shape: 'cylinder',
    overlay: { paths: ['M24 22h10v9H24Z', 'M30 27h10v9H30Z'] },
    color: '#059669'
  },
  'object-storage': {
    shape: 'bucket',
    overlay: { paths: ['M24 30h16M24 38h16'] },
    color: '#ea580c'
  },
  'search-index': { shape: 'cylinder', overlay: MAGNIFIER, color: '#8b5cf6' },
  'time-series-db': {
    shape: 'cylinder',
    overlay: { paths: ['M22 34l5-7 4 4 6-9 3 4'] },
    color: '#06b6d4'
  },
  'graph-db': {
    shape: 'cylinder',
    overlay: {
      paths: ['M25 28l12-4M25 28l5 11M37 24l-7 15'],
      dots: [
        [25, 28],
        [37, 24],
        [30, 39]
      ]
    },
    color: '#7c3aed'
  },
  'vector-db': {
    shape: 'cylinder',
    overlay: {
      paths: ['M24 38l14-10m-6 0h6v6'],
      dots: [
        [25, 26],
        [31, 40],
        [40, 38]
      ]
    },
    color: '#ec4899'
  },
  'data-warehouse': {
    shape: 'warehouse',
    overlay: { paths: ['M22 26h20M22 34h20M22 42h20'] },
    color: '#0f766e'
  },
  'data-lake': {
    shape: 'circle',
    overlay: { paths: ['M17 28q4-4 8 0t8 0t8 0t6 0M17 36q4-4 8 0t8 0t8 0t6 0'] },
    color: '#0ea5e9'
  },

  // Analytics, AI and orchestration
  'streaming-analytics': {
    shape: 'box',
    overlay: { paths: ['M24 42V32M32 42V23M40 42V28'] },
    color: '#7c3aed'
  },
  'llm-gateway': {
    shape: 'hex',
    overlay: { paths: ['M32 20l3 9 9 3-9 3-3 9-3-9-9-3 9-3Z'] },
    color: '#6d28d9'
  },
  'tool-registry': {
    shape: 'box',
    overlay: {
      paths: ['M36 21a6 6 0 0 0-7 8L21 37a3 3 0 0 0 4 4l8-8a6 6 0 0 0 8-7l-4 4-4-1-1-4Z']
    },
    color: '#64748b'
  },
  'memory-fabric': {
    shape: 'chip',
    overlay: {
      paths: ['M24 24h16v16H24ZM24 24l16 16M40 24 24 40'],
      dots: [
        [24, 24],
        [40, 24],
        [24, 40],
        [40, 40]
      ]
    },
    color: '#c026d3'
  },
  'kubernetes-cluster': {
    shape: 'hex',
    overlay: {
      circles: [[32, 32, 4]],
      paths: [
        'M32 20v8M32 36v8M20 32h8M36 32h8M23.5 23.5l5.6 5.6M34.9 34.9l5.6 5.6M40.5 23.5l-5.6 5.6M29.1 34.9l-5.6 5.6'
      ]
    },
    color: '#3b82f6'
  },
  'agent-orchestrator': { shape: 'circle', overlay: HUB, color: '#8b5cf6' },
  'safety-observability-mesh': {
    shape: 'shield',
    overlay: { circles: [[32, 32, 3]], paths: ['M20 32c4-7 20-7 24 0-4 7-20 7-24 0Z'] },
    color: '#0d9488'
  },
  'external-service': {
    shape: 'cloud',
    overlay: { paths: ['M25 41l13-13m-8 0h8v8'] },
    color: '#64748b'
  },
  'output-sink': {
    shape: 'box',
    overlay: { paths: ['M32 21v16m-6-6 6 6 6-6M22 43h20'] },
    color: '#f43f5e'
  },

  // Auxiliary
  sharding: {
    shape: 'cylinder',
    overlay: { paths: ['M32 22v4M32 26l-9 7M32 26l9 7'] },
    color: '#ca8a04'
  },
  hashing: { shape: 'box', overlay: { text: '#' }, color: '#0ea5e9' },
  'shard-node': { shape: 'cylinder', overlay: { text: 'S' }, color: '#ca8a04' },
  'partition-node': { shape: 'box', overlay: GRID, color: '#6366f1' },
  'config-store': {
    shape: 'box',
    overlay: {
      paths: ['M22 26h20M22 34h20M22 42h20'],
      dots: [
        [28, 26],
        [36, 34],
        [30, 42]
      ]
    },
    color: '#64748b'
  },
  'secrets-manager': {
    shape: 'box',
    overlay: { circles: [[26, 32, 4.5]], paths: ['M30.5 32H43M39 32v5M43 32v4'] },
    color: '#f59e0b'
  },
  'feature-flag-service': {
    shape: 'box',
    overlay: { paths: ['M26 21v24M26 23h14l-3 5 3 5H26'] },
    color: '#8b5cf6'
  },
  'rate-limiter': {
    shape: 'box',
    overlay: { paths: ['M24 22h16M24 42h16M26 22c0 8 12 8 12 20M38 22c0 8-12 8-12 20'] },
    color: '#0ea5e9'
  },
  'circuit-breaker-controller': {
    shape: 'box',
    overlay: {
      paths: ['M21 36h7M36 36h7M28 36l9-11'],
      dots: [
        [28, 36],
        [36, 36]
      ]
    },
    color: '#ef4444'
  },
  'distributed-lock': { shape: 'box', overlay: LOCK, color: '#f59e0b' },
  'idempotency-manager': {
    shape: 'box',
    overlay: { circles: [[32, 32, 10]], paths: ['M27 32l4 4 7-8'] },
    color: '#10b981'
  },
  'reservation-store': {
    shape: 'box',
    overlay: { paths: ['M23 24h18v18H23Z', 'M23 30h18M28 21v5M36 21v5'] },
    color: '#6366f1'
  },

  // Observability
  'metrics-collector-agent': { shape: 'box', overlay: CHART_LINE, color: '#10b981' },
  'log-collector-agent': { shape: 'box', overlay: DOC, color: '#64748b' },
  'log-aggregation-service': {
    shape: 'box',
    overlay: { paths: ['M22 23h18v16H22Z', 'M26 28h18v16H26Z'] },
    color: '#64748b'
  },
  'distributed-tracing-collector': {
    shape: 'box',
    overlay: { paths: ['M22 25h12M28 32h14M34 39h8'] },
    color: '#8b5cf6'
  },
  'alerting-engine': { shape: 'box', overlay: BELL_MARK, color: '#ef4444' },
  'health-check-monitor': {
    shape: 'box',
    overlay: { paths: ['M20 33h6l3-8 6 16 3-8h6'] },
    color: '#10b981'
  }
}

export const hasNodeSymbol = (templateId: string | undefined): boolean =>
  Boolean(templateId && SYMBOL_BY_TEMPLATE[templateId])
