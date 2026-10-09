import type { ComponentNode, ComponentType, TopologyJSON } from '../../../engine/core/types'
import { deriveNodeConcurrency } from '../../../engine/nodes/resourceDerivation'
import { exitMode } from '../context'
import { flattenConfig } from '../configDump'
import { contextNode, latestSnapshot, nodeInterfaces, postWarmupSeconds, simState } from '../data'
import {
  fmtCount,
  fmtMs,
  fmtPct,
  fmtRps,
  fmtValue,
  heading,
  keyValues,
  note,
  table
} from '../format'
import { interfaceLines } from './node'
import { CommandError, type CommandDefinition, type CommandScope } from '../types'

/**
 * Per-type idioms: psql for relational databases, redis-cli for caches, Cisco
 * IOS for networking nodes, kafka-topics for brokers. They are thin aliases
 * over the same node data the generic show commands read, phrased the way
 * those tools phrase it. Anything the engine does not model (tables, keys,
 * slow-log entries, topics as named objects) is said to be not simulated.
 */

const POSTGRES_TYPES: readonly ComponentType[] = ['relational-db']
const REDIS_TYPES: readonly ComponentType[] = ['in-memory-cache', 'kv-store']
const IOS_TYPES: readonly ComponentType[] = [
  'load-balancer',
  'load-balancer-l4',
  'load-balancer-l7',
  'global-traffic-manager',
  'edge-router',
  'nat-gateway',
  'transit-gateway',
  'vpn-gateway',
  'api-gateway',
  'service-mesh',
  'ingress-controller',
  'reverse-proxy',
  'routing-rule',
  'routing-policy',
  'firewall',
  'waf'
]
const KAFKA_TYPES: readonly ComponentType[] = [
  'stream',
  'message-broker',
  'pub-sub',
  'queue',
  'event-bus',
  'task-queue'
]

function nodeIs(types: readonly ComponentType[]) {
  return (scope: CommandScope): boolean => {
    const { topology } = scope.deps.topology()
    const node = topology?.nodes.find((candidate) => candidate.id === scope.ctx.nodeId)
    return node !== undefined && types.includes(node.type)
  }
}

function idiom(
  name: string,
  types: readonly ComponentType[],
  label: string,
  summary: string,
  run: (
    scope: CommandScope,
    topology: TopologyJSON,
    node: ComponentNode,
    args: string[]
  ) => string[],
  aliases?: string[]
): CommandDefinition {
  return {
    name,
    aliases,
    modes: ['node'],
    idiom: label,
    summary,
    appliesTo: nodeIs(types),
    execute: (scope, args) => {
      const { topology, node } = contextNode(scope)
      return { lines: run(scope, topology, node, args.raw) }
    }
  }
}

function configEntries(node: ComponentNode, match: RegExp): Array<[string, string]> {
  return flattenConfig(node.config ?? {}).filter(([path]) => match.test(path))
}

function liveState(scope: CommandScope, node: ComponentNode) {
  const live = latestSnapshot(scope)
  return { live, state: live?.snapshot.node[node.id] }
}

// ─── psql ─────────────────────────────────────────────────────────────────────

function psqlConninfo(scope: CommandScope, topology: TopologyJSON, node: ComponentNode): string[] {
  const derived = deriveNodeConcurrency(node)
  const clients = topology.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => edge.source)
  return [
    `You are connected to database "${node.label || node.id}" (${node.provider ?? 'relational-db'}) as node "${node.id}".`,
    ...keyValues(
      [
        [
          'max_connections',
          `${fmtCount(derived.effectiveC)} ${note('(= workers c, derived from the instance)', scope.deps.palette)}`
        ],
        ['clients', clients.join(', ') || 'none']
      ],
      scope.deps.palette
    )
  ]
}

function psqlTables(scope: CommandScope, _topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const storage = configEntries(node, /latency|storage|read|write|scan/i)
  return [
    `${c.yellow}Tables are not simulated.${c.reset} The engine models ${node.id} as a G/G/c/K server whose read, write and scan costs are latencies, not as a schema with rows.`,
    ...(storage.length > 0
      ? [heading('Storage profile', c), ...keyValues(storage, c)]
      : [note('No storage profile set on this node.', c)])
  ]
}

function psqlDescribe(
  scope: CommandScope,
  _topology: TopologyJSON,
  node: ComponentNode,
  args: string[]
): string[] {
  const c = scope.deps.palette
  const lines: string[] = []
  if (args[0])
    lines.push(
      note(`Relation "${args[0]}" is not modelled (no tables); describing the server instead.`, c)
    )
  lines.push(
    heading(`Server "${node.id}"`, c, node.type),
    ...flattenConfig({ ...node, position: undefined, id: undefined }).map(
      ([path, value]) => `  ${path} ${value}`
    )
  )
  return lines
}

function pgStatActivity(
  scope: CommandScope,
  _topology: TopologyJSON,
  node: ComponentNode,
  args: string[]
): string[] {
  const c = scope.deps.palette
  const query = args.join(' ').toLowerCase()
  if (!query.includes('pg_stat_activity')) {
    throw new CommandError(
      'SQL is not simulated. The one supported query is: SELECT * FROM pg_stat_activity (the connection table).'
    )
  }
  const derived = deriveNodeConcurrency(node)
  const { live, state } = liveState(scope, node)
  if (!state || !live) return [note("(0 rows) - no run yet. 'run' from sim> first.", c)]
  const workers = state.workers ?? derived.effectiveC
  const rows = [
    ['active', fmtCount(state.activeWorkers), 'running a query'],
    ['idle', fmtCount(Math.max(0, workers - state.activeWorkers)), 'free worker slot'],
    ['waiting', fmtCount(state.queueLength), 'queued for a worker']
  ]
  return [
    ...table(['state', 'count', 'meaning'], rows, c, { align: ['left', 'right', 'left'] }),
    note(
      `(${rows.length} rows) ${live.source === 'live' ? `live at t=${(live.snapshot.timestamp / 1000).toFixed(1)}s` : 'at the end of the last run'}; aggregated per state, the engine does not keep per-connection rows.`,
      c
    )
  ]
}

// ─── redis-cli ────────────────────────────────────────────────────────────────

function redisInfo(scope: CommandScope, topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const results = simState(scope)?.results ?? null
  const metrics = results?.perNode[node.id]
  const { state } = liveState(scope, node)
  const derived = deriveNodeConcurrency(node)
  const cacheConfig = configEntries(node, /cache|ttl/i)
  const lines = [
    '# Server',
    `node_id:${node.id}`,
    `node_type:${node.type}`,
    `instance:${node.resources?.instanceType ?? '(default)'} x${node.resources?.instanceCount ?? 1}`,
    '',
    '# Clients',
    `connected_clients:${state ? state.activeWorkers + state.queueLength : 0}`,
    `maxclients:${derived.effectiveK}`,
    `blocked_clients:${state ? state.queueLength : 0}`,
    '',
    '# Config',
    ...cacheConfig.map(([path, value]) => `${path}:${value}`),
    '',
    '# Stats'
  ]
  if (metrics && results) {
    lines.push(
      `total_commands_processed:${metrics.totalProcessed}`,
      `instantaneous_ops_per_sec:${Math.round(metrics.throughput)}`,
      `keyspace_hits:${metrics.cacheHits}`,
      `keyspace_misses:${metrics.cacheMisses}`,
      `hit_ratio:${fmtPct(metrics.cacheHitRatio)}`,
      `rejected_connections:${metrics.totalRejected}`
    )
  } else {
    lines.push(note('(run a simulation for stats)', c))
  }
  lines.push(
    note(
      `Memory and keyspace size are not simulated; the topology has ${topology.nodes.length} nodes.`,
      c
    )
  )
  return lines
}

function redisDbsize(scope: CommandScope, _topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const model = (node.config?.cacheModel as string | undefined) ?? 'declared-rate'
  return [
    `${c.yellow}Key count is not simulated.${c.reset} ` +
      (model === 'derived-lru'
        ? 'This cache runs the derived LRU model: hits come from a bounded LRU over the request keyspace, but the engine does not report its size.'
        : `This cache uses a declared hit rate (${fmtValue(node.config?.cacheHitRate)}), so there are no keys at all.`)
  ]
}

function redisSlowlog(scope: CommandScope, _topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const results = simState(scope)?.results ?? null
  const metrics = results?.perNode[node.id]
  if (!metrics) return [note('(empty list) - no run yet.', c)]
  return [
    note('Per-command slow-log entries are not kept; the latency distribution at this node is:', c),
    ...keyValues(
      [
        ['p50', fmtMs(metrics.latencyNodeLocal.p50)],
        ['p95', fmtMs(metrics.latencyNodeLocal.p95)],
        ['p99', fmtMs(metrics.latencyNodeLocal.p99)],
        ['max', fmtMs(metrics.latencyNodeLocal.max)],
        ['timed out', fmtCount(metrics.totalTimedOut)]
      ],
      c
    )
  ]
}

function redisClientList(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode
): string[] {
  const c = scope.deps.palette
  const results = simState(scope)?.results ?? null
  const seconds = results ? postWarmupSeconds(results) : 1
  const clients = nodeInterfaces(topology, node.id).filter((entry) => entry.direction === 'in')
  if (clients.length === 0) return ['(empty list)']
  return [
    ...clients.map((entry, index) => {
      const measured = results?.perEdge[entry.edge.id]
      return (
        `id=${index + 1} addr=${entry.peerId} edge=${entry.edge.id} proto=${entry.edge.protocol} maxconn=${entry.edge.maxConcurrentRequests}` +
        (measured ? ` ops/s=${fmtRps(measured.totalSuccessfulTransits / seconds)}` : '')
      )
    }),
    note('One line per calling node (connection). Individual client sockets are not simulated.', c)
  ]
}

// ─── Cisco IOS ────────────────────────────────────────────────────────────────

function iosRoute(scope: CommandScope, topology: TopologyJSON, node: ComponentNode): string[] {
  const c = scope.deps.palette
  const strategy = (node.config?.routingStrategy as string | undefined) ?? 'passthrough'
  const routes = nodeInterfaces(topology, node.id).filter((entry) => entry.direction === 'out')
  if (routes.length === 0) return [`${node.id} has no next hops.`]
  const weighted = strategy === 'weighted'
  const weightSum = routes.reduce(
    (sum, entry) => sum + (entry.edge.weight && entry.edge.weight > 0 ? entry.edge.weight : 1),
    0
  )
  const rows = routes.map((entry) => {
    const weight = entry.edge.weight && entry.edge.weight > 0 ? entry.edge.weight : 1
    return [
      'S',
      entry.peerId,
      `via ${entry.edge.id}`,
      `Interface ${entry.index}`,
      weighted ? fmtPct(weight / weightSum, 0) : strategy === 'broadcast' ? 'all' : '-',
      entry.edge.condition ? `if ${entry.edge.condition}` : ''
    ]
  })
  const contentRules = Array.isArray(node.config?.routingRules)
    ? (node.config?.routingRules as unknown[]).length
    : 0
  return [
    `Routing strategy: ${c.bold}${strategy}${c.reset}`,
    ...table(['', 'NEXT HOP', 'VIA', 'INTERFACE', 'SHARE', 'CONDITION'], rows, c),
    note(
      `Codes: S - static (an edge). The share column applies to weighted routing; other strategies pick per request.` +
        (contentRules > 0 ? ` ${contentRules} content routing rule(s) apply first.` : ''),
      c
    )
  ]
}

function iosRunningConfig(
  scope: CommandScope,
  _topology: TopologyJSON,
  node: ComponentNode
): string[] {
  const c = scope.deps.palette
  return [
    'Building configuration...',
    '',
    `hostname ${node.id}`,
    '!',
    ...flattenConfig({ ...node, id: undefined, position: undefined }).map(
      ([path, value]) => ` ${path} ${value}`
    ),
    '!',
    'end',
    note('Engine view of this node, as the simulation reads it.', c)
  ]
}

// ─── kafka-topics ─────────────────────────────────────────────────────────────

function kafkaTopics(
  scope: CommandScope,
  topology: TopologyJSON,
  node: ComponentNode,
  args: string[]
): string[] {
  const c = scope.deps.palette
  const describe = args.includes('--describe')
  const list = args.includes('--list') || !describe
  if (list && !describe) {
    return [node.id, note('One topic per broker node: the engine models the node as the topic.', c)]
  }
  const partitions = (node.config?.partitionCount as number | undefined) ?? 1
  const brokerEnabled = node.config?.streamBrokerEnabled === true
  const projection = simState(scope)?.results?.streamProjection.find(
    (entry) => entry.nodeId === node.id
  )
  const consumers = topology.edges
    .filter((edge) => edge.source === node.id)
    .map((edge) => edge.target)
  const lines = [
    `Topic: ${node.id}\tPartitionCount: ${partitions}\tBroker semantics: ${brokerEnabled ? 'on' : 'off'}` +
      (node.config?.retentionMs !== undefined ? `\tretention.ms: ${node.config.retentionMs}` : ''),
    ...configEntries(node, /consumerGroup|partitionKey|retention|replay/i).map(
      ([path, value]) => `\t${path}: ${value}`
    )
  ]
  if (projection) {
    lines.push(
      ...table(
        ['PARTITION', 'START', 'NEXT', 'RETAINED'],
        projection.partitions.map((p) => [
          String(p.partition),
          fmtCount(p.startOffset),
          fmtCount(p.nextOffset),
          fmtCount(p.retainedRecords)
        ]),
        c,
        { indent: '\t' }
      )
    )
    for (const group of projection.groups) {
      const lag = Object.values(group.lag).reduce((sum, value) => sum + value, 0)
      lines.push(
        `\tgroup ${group.group}: ${group.members.length} member(s), total lag ${fmtCount(lag)}`
      )
    }
  } else if (!brokerEnabled) {
    lines.push(
      note(
        'Partition offsets and consumer lag are simulated only with broker semantics on (stream broker setting).',
        c
      )
    )
  } else {
    lines.push(note('Run a simulation for partition offsets and consumer lag.', c))
  }
  lines.push(note(`Consumers (outbound edges): ${consumers.join(', ') || 'none'}`, c))
  return lines
}

export const PER_TYPE_COMMANDS: CommandDefinition[] = [
  idiom(
    '\\conninfo',
    POSTGRES_TYPES,
    'psql',
    'Connection info (max_connections = workers c)',
    psqlConninfo
  ),
  idiom(
    '\\dt',
    POSTGRES_TYPES,
    'psql',
    'List tables (explains what is modelled instead)',
    psqlTables
  ),
  idiom('\\d', POSTGRES_TYPES, 'psql', 'Describe the server config', psqlDescribe),
  idiom(
    'select *',
    POSTGRES_TYPES,
    'psql',
    'SELECT * FROM pg_stat_activity: connections by state',
    pgStatActivity
  ),
  {
    name: '\\q',
    modes: ['node'],
    idiom: 'psql',
    summary: 'Quit (same as exit)',
    appliesTo: nodeIs(POSTGRES_TYPES),
    execute: (scope) => ({ context: exitMode(scope.ctx) })
  },
  idiom(
    'info',
    REDIS_TYPES,
    'redis-cli',
    'INFO: clients, cache config and hit/miss stats',
    redisInfo
  ),
  idiom('dbsize', REDIS_TYPES, 'redis-cli', 'DBSIZE (explains the cache model)', redisDbsize),
  idiom(
    'slowlog',
    REDIS_TYPES,
    'redis-cli',
    'SLOWLOG: latency percentiles at this cache',
    redisSlowlog,
    ['slowlog get']
  ),
  idiom(
    'client list',
    REDIS_TYPES,
    'redis-cli',
    'CLIENT LIST: one line per calling node',
    redisClientList
  ),
  idiom('ping', REDIS_TYPES, 'redis-cli', 'PING', (scope, _topology, node) => {
    const { state } = liveState(scope, node)
    return [
      state?.status === 'failed'
        ? `${scope.deps.palette.red}(error) node is down${scope.deps.palette.reset}`
        : 'PONG'
    ]
  }),
  idiom('show ip route', IOS_TYPES, 'ios', 'Routing table: strategy and next hops', iosRoute),
  idiom('show running-config', IOS_TYPES, 'ios', 'This node config, IOS style', iosRunningConfig, [
    'show run'
  ]),
  idiom('show ip interface brief', IOS_TYPES, 'ios', 'Interface summary', (scope, topology, node) =>
    interfaceLines(scope, topology, node)
  ),
  idiom(
    'kafka-topics',
    KAFKA_TYPES,
    'kafka',
    '--list | --describe: partitions, retention, consumer lag',
    kafkaTopics
  )
]
