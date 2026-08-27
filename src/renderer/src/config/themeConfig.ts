import { ColorTheme } from '@renderer/types/ui'

export const THEME_CONFIG: Record<string, ColorTheme> = {
  // Compute
  SERVER: { bg: 'bg-indigo-500', border: 'border-indigo-600', text: 'text-indigo-600' },
  LAMBDA: { bg: 'bg-yellow-500', border: 'border-yellow-600', text: 'text-yellow-600' },
  WORKER: { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-emerald-600' },
  CRON: { bg: 'bg-gray-500', border: 'border-gray-600', text: 'text-gray-600' },
  AUTH: { bg: 'bg-red-500', border: 'border-red-600', text: 'text-red-600' },
  SEARCH_SERVICE: { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-violet-600' },
  SIDECAR: { bg: 'bg-cyan-500', border: 'border-cyan-600', text: 'text-cyan-600' },

  // Infrastructure
  cloud: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-blue-600' },
  az: { bg: 'bg-orange-400', border: 'border-orange-500', text: 'text-orange-500' },
  subnet: { bg: 'bg-sky-500', border: 'border-sky-600', text: 'text-sky-600' },
  'server-cog': { bg: 'bg-slate-500', border: 'border-slate-600', text: 'text-slate-600' },
  'book-open': { bg: 'bg-fuchsia-500', border: 'border-fuchsia-600', text: 'text-fuchsia-600' },

  // Service Nodes (existing)
  database: { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-emerald-600' },
  server: { bg: 'bg-orange-500', border: 'border-orange-600', text: 'text-orange-600' }, // Redis/Cache
  network: { bg: 'bg-indigo-500', border: 'border-indigo-600', text: 'text-indigo-600' },
  globe: { bg: 'bg-purple-500', border: 'border-purple-600', text: 'text-purple-600' }, // API Gateway
  routing: { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-violet-600' },
  'edge-router': { bg: 'bg-indigo-600', border: 'border-indigo-700', text: 'text-indigo-700' },
  'network-interface': {
    bg: 'bg-sky-500',
    border: 'border-sky-600',
    text: 'text-sky-600'
  },
  'service-mesh': {
    bg: 'bg-fuchsia-500',
    border: 'border-fuchsia-600',
    text: 'text-fuchsia-600'
  },
  'load-balancer-l4': {
    bg: 'bg-blue-500',
    border: 'border-blue-600',
    text: 'text-blue-600'
  },
  'load-balancer-l7': {
    bg: 'bg-violet-500',
    border: 'border-violet-600',
    text: 'text-violet-600'
  },

  // Clients & Edge
  monitor: { bg: 'bg-sky-500', border: 'border-sky-600', text: 'text-sky-600' }, // Client/User
  dns: { bg: 'bg-slate-400', border: 'border-slate-500', text: 'text-slate-500' }, // DNS
  cdn: { bg: 'bg-teal-500', border: 'border-teal-600', text: 'text-teal-600' }, // CDN
  'input-source': {
    bg: 'bg-emerald-500',
    border: 'border-emerald-600',
    text: 'text-emerald-600'
  },
  'output-sink': { bg: 'bg-rose-500', border: 'border-rose-600', text: 'text-rose-600' },

  // Messaging
  queue: { bg: 'bg-amber-500', border: 'border-amber-600', text: 'text-amber-600' }, // Message Queue
  broker: { bg: 'bg-red-500', border: 'border-red-600', text: 'text-red-600' }, // Event Broker
  'pub-sub': { bg: 'bg-pink-500', border: 'border-pink-600', text: 'text-pink-600' },
  stream: { bg: 'bg-orange-500', border: 'border-orange-600', text: 'text-orange-600' },

  // Data Stores (new)
  nosql: { bg: 'bg-lime-500', border: 'border-lime-600', text: 'text-lime-600' }, // NoSQL DB
  replica: { bg: 'bg-cyan-500', border: 'border-cyan-600', text: 'text-cyan-600' }, // Read Replica
  storage: { bg: 'bg-stone-500', border: 'border-stone-600', text: 'text-stone-600' }, // Object Storage
  search: { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-violet-600' }, // Search Index
  'time-series-db': {
    bg: 'bg-blue-500',
    border: 'border-blue-600',
    text: 'text-blue-600'
  },
  'graph-db': { bg: 'bg-lime-600', border: 'border-lime-700', text: 'text-lime-700' },
  'vector-db': {
    bg: 'bg-fuchsia-500',
    border: 'border-fuchsia-600',
    text: 'text-fuchsia-600'
  },
  'data-warehouse': {
    bg: 'bg-slate-600',
    border: 'border-slate-700',
    text: 'text-slate-700'
  },
  'data-lake': { bg: 'bg-teal-500', border: 'border-teal-600', text: 'text-teal-600' },
  'kv-store': { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-emerald-600' },

  // App Support
  notification: { bg: 'bg-fuchsia-500', border: 'border-fuchsia-600', text: 'text-fuchsia-600' }, // Push Notification
  analytics: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-blue-600' }, // Streaming Analytics
  'llm-gateway': { bg: 'bg-violet-500', border: 'border-violet-600', text: 'text-violet-600' },
  'tool-registry': {
    bg: 'bg-amber-500',
    border: 'border-amber-600',
    text: 'text-amber-600'
  },
  'memory-fabric': {
    bg: 'bg-indigo-500',
    border: 'border-indigo-600',
    text: 'text-indigo-600'
  },
  'agent-orchestrator': {
    bg: 'bg-cyan-500',
    border: 'border-cyan-600',
    text: 'text-cyan-600'
  },
  'safety-mesh': {
    bg: 'bg-rose-500',
    border: 'border-rose-600',
    text: 'text-rose-600'
  },
  'generic-service': {
    bg: 'bg-slate-500',
    border: 'border-slate-600',
    text: 'text-slate-600'
  },
  'my-service': { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-blue-600' },
  sharding: { bg: 'bg-purple-500', border: 'border-purple-600', text: 'text-purple-600' },
  hashing: { bg: 'bg-amber-500', border: 'border-amber-600', text: 'text-amber-600' },
  'shard-node': { bg: 'bg-cyan-500', border: 'border-cyan-600', text: 'text-cyan-600' },
  'partition-node': {
    bg: 'bg-emerald-500',
    border: 'border-emerald-600',
    text: 'text-emerald-600'
  },

  // External
  external: { bg: 'bg-rose-500', border: 'border-rose-600', text: 'text-rose-600' }, // External Service

  waf: {
    bg: 'bg-rose-500',
    border: 'border-rose-600',
    text: 'text-rose-600'
  },
  firewall: {
    bg: 'bg-orange-500',
    border: 'border-orange-500',
    text: 'text-orange-600'
  },
  'security-group': {
    bg: 'bg-emerald-500',
    border: 'border-emerald-600',
    text: 'text-emerald-600'
  },
  ingress: {
    bg: 'bg-indigo-500',
    border: 'border-indigo-500',
    text: 'text-indigo-600'
  },
  proxy: {
    bg: 'bg-indigo-500',
    border: 'border-indigo-500',
    text: 'text-indigo-600'
  },

  nat: {
    bg: 'bg-teal-500',
    border: 'border-teal-600',
    text: 'text-teal-600'
  },
  vpn: {
    bg: 'bg-slate-500',
    border: 'border-slate-500',
    text: 'text-slate-600'
  },
  'rate-limiter': {
    bg: 'bg-amber-500',
    border: 'border-amber-600',
    text: 'text-amber-600'
  },
  'circuit-breaker-controller': {
    bg: 'bg-rose-500',
    border: 'border-rose-600',
    text: 'text-rose-600'
  },
  'distributed-lock': {
    bg: 'bg-teal-500',
    border: 'border-teal-600',
    text: 'text-teal-600'
  },
  'idempotency-manager': {
    bg: 'bg-cyan-500',
    border: 'border-cyan-600',
    text: 'text-cyan-600'
  },
  'reservation-store': {
    bg: 'bg-cyan-500',
    border: 'border-cyan-600',
    text: 'text-cyan-600'
  },

  // Observability
  'metrics-collector': { bg: 'bg-pink-500', border: 'border-pink-600', text: 'text-pink-600' },
  'log-collector': { bg: 'bg-amber-400', border: 'border-amber-500', text: 'text-amber-500' },
  'log-aggregator': { bg: 'bg-amber-600', border: 'border-amber-700', text: 'text-amber-700' },
  tracing: { bg: 'bg-indigo-400', border: 'border-indigo-500', text: 'text-indigo-500' },
  alerting: { bg: 'bg-red-500', border: 'border-red-600', text: 'text-red-600' },
  'health-check': { bg: 'bg-emerald-400', border: 'border-emerald-500', text: 'text-emerald-500' },

  // Fallbacks
  default: { bg: 'bg-slate-500', border: 'border-slate-600', text: 'text-slate-600' }
}

export const getTheme = (key: string) => {
  return THEME_CONFIG[key] || THEME_CONFIG.default
}
