import { enterMode } from '../context'
import { contextNode, nodeInterfaces, nodeName } from '../data'
import { fmtCount, fmtMs, fmtPct, fmtValue, heading, keyValues, note, table } from '../format'
import { edgeMeanLatencyMs } from './topology'
import {
  CommandError,
  type CommandDefinition,
  type CommandScope,
  type ConfigFieldView,
  type ConfigWriteResult,
  type EdgeConfigAccess,
  type NodeConfigAccess
} from '../types'

// ─── Field keys ──────────────────────────────────────────────────────────────

/** Path segments too generic to stand alone as a key (`type`, `value`, ...). */
const GENERIC_SEGMENTS = new Set([
  'type',
  'value',
  'mu',
  'sigma',
  'mean',
  'lambda',
  'min',
  'max',
  'enabled'
])

function kebab(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()
}

/**
 * Terminal keys for a node's field paths: the kebab-case last segment
 * (`sim.processing.timeout` -> `timeout`), prefixed with its parent when the
 * last segment is generic or collides (`distribution-type`, `retry-max-delay`).
 */
export function fieldKeysFor(paths: readonly string[]): Map<string, string> {
  const segmentsOf = (path: string): string[] => path.split('.').filter((s) => s !== 'sim')
  const base = (path: string): string => {
    const segments = segmentsOf(path)
    const last = segments[segments.length - 1]
    if (GENERIC_SEGMENTS.has(last) && segments.length > 1) {
      return `${kebab(segments[segments.length - 2])}-${kebab(last)}`
    }
    return kebab(last)
  }
  const keys = new Map(paths.map((path) => [path, base(path)]))
  const counts = new Map<string, number>()
  for (const key of keys.values()) counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const [path, key] of keys) {
    if ((counts.get(key) ?? 0) < 2) continue
    const segments = segmentsOf(path)
    keys.set(path, segments.map(kebab).join('-'))
  }
  return keys
}

/**
 * Names from the issue / IOS habit that map onto a real key. `workers` and
 * `capacity` are deliberately absent: they are derived, see DERIVED_KEYS.
 */
const KEY_ALIASES: Record<string, string> = {
  'queue-discipline': 'discipline',
  instances: 'instance-count',
  replicas: 'instance-count',
  instance: 'instance-type',
  'error-rate': 'node-error-rate',
  'service-time': 'distribution-value',
  'hit-rate': 'cache-hit-rate',
  ttl: 'ttl-seconds'
}

const DERIVED_KEYS: Record<string, string> = {
  workers:
    'Workers (c) are derived from the instance, not set directly: c = vCPU x workers-per-vCPU x instances. ' +
    "Change instance-type, instance-count or workload-kind ('show queue' shows the derivation).",
  capacity:
    'Capacity (K) is derived from instance RAM / per-request memory, never below c. ' +
    "Change instance-type or instance-count ('explain capacity' in runtime mode breaks it down).",
  'max-capacity': 'Capacity (K) is derived; see: set capacity'
}

function findField(fields: ConfigFieldView[], key: string): ConfigFieldView | undefined {
  const wanted = KEY_ALIASES[key.toLowerCase()] ?? key.toLowerCase()
  return (
    fields.find((field) => field.key === wanted) ??
    fields.find((field) => field.path === key) ??
    fields.find((field) => field.path.endsWith(`.${key}`))
  )
}

function requireConfig(scope: CommandScope): NodeConfigAccess {
  if (!scope.deps.config)
    throw new CommandError('Config changes are available in the app terminal.')
  return scope.deps.config
}

function requireEdges(scope: CommandScope): EdgeConfigAccess {
  if (!scope.deps.edges)
    throw new CommandError('Connection changes are available in the app terminal.')
  return scope.deps.edges
}

function reportWrite(scope: CommandScope, result: ConfigWriteResult, what: string): string[] {
  const c = scope.deps.palette
  if (result.ok === false) throw new CommandError(result.reason)
  return [
    `${c.green}${what}${c.reset}${result.message ? ` ${note(result.message, c)}` : ''}` +
      (result.undoable ? note("  ('undo' reverts)", c) : '')
  ]
}

function unknownKey(scope: CommandScope, key: string, fields: ConfigFieldView[]): never {
  const derived = DERIVED_KEYS[key.toLowerCase()]
  if (derived) throw new CommandError(derived)
  const close = fields
    .filter((field) => field.key.includes(key.toLowerCase()))
    .map((field) => field.key)
  throw new CommandError(
    `No setting '${key}' on this node.` +
      (close.length > 0
        ? ` Did you mean: ${close.slice(0, 5).join(', ')}?`
        : " 'show config' lists the keys.") +
      ' Only settings the simulation reads are offered.'
  )
}

/** `set distribution <type> [params...]`: the type, then its parameter fields in panel order. */
function setDistribution(scope: CommandScope, nodeId: string, values: string[]): string[] {
  const config = requireConfig(scope)
  const [type, ...params] = values
  const typeField = config.fields(nodeId).find((field) => field.key === 'distribution-type')
  if (!typeField) throw new CommandError('This node has no service-time distribution setting.')
  if (!type) {
    throw new CommandError(
      `Usage: set distribution <${(typeField.options ?? []).join('|')}> <params...>`
    )
  }
  const lines = reportWrite(
    scope,
    config.set(nodeId, 'distribution-type', type),
    `distribution-type = ${type}`
  )
  const paramFields = config
    .fields(nodeId)
    .filter(
      (field) =>
        field.path.includes('.distribution.') && field.key !== 'distribution-type' && field.editable
    )
  if (params.length > paramFields.length) {
    throw new CommandError(
      `${type} takes ${paramFields.length} parameter${paramFields.length === 1 ? '' : 's'}: ${paramFields.map((f) => f.key).join(' ')}.`
    )
  }
  params.forEach((raw, index) => {
    const field = paramFields[index]
    lines.push(...reportWrite(scope, config.set(nodeId, field.key, raw), `${field.key} = ${raw}`))
  })
  if (params.length < paramFields.length) {
    lines.push(
      note(
        `Parameters: ${paramFields.map((f) => `${f.key}=${fmtValue(f.displayValue)}`).join(', ')}`,
        scope.deps.palette
      )
    )
  }
  return lines
}

function setCommand(scope: CommandScope, positionals: string[]): string[] {
  const { node } = contextNode(scope)
  const config = requireConfig(scope)
  const [key, ...rest] = positionals
  if (!key) throw new CommandError("Usage: set <key> <value>. 'show config' lists the keys.")
  if (key === 'distribution') return setDistribution(scope, node.id, rest)
  const fields = config.fields(node.id)
  const field = findField(fields, key)
  if (!field) unknownKey(scope, key, fields)
  if (!field.editable) {
    throw new CommandError(`${field.label} is a list editor; change it in the properties panel.`)
  }
  if (rest.length === 0) {
    throw new CommandError(
      `Usage: set ${field.key} <value>` +
        (field.options
          ? ` (one of: ${field.options.join(', ')})`
          : field.type === 'boolean'
            ? ' (on|off)'
            : field.unit
              ? ` (${field.unit})`
              : '')
    )
  }
  const raw = rest.join(' ')
  return reportWrite(
    scope,
    config.set(node.id, field.key, raw),
    `${field.key} = ${raw}${field.unit ? ` ${field.unit}` : ''}`
  )
}

function noCommand(scope: CommandScope, positionals: string[]): string[] {
  const { node } = contextNode(scope)
  const config = requireConfig(scope)
  const [key] = positionals
  if (!key) throw new CommandError('Usage: no <key> - resets a setting to its default.')
  if (key === 'shutdown') {
    throw new CommandError(
      'Nodes have no shutdown state to clear. To take one down, add a fault in the chaos experiment panel.'
    )
  }
  const fields = config.fields(node.id)
  const field = findField(fields, key)
  if (!field) unknownKey(scope, key, fields)
  return reportWrite(scope, config.reset(node.id, field.key), `${field.key} reset to default`)
}

function enterPort(scope: CommandScope, positionals: string[]) {
  const c = scope.deps.palette
  const { topology, node } = contextNode(scope)
  const tokens = positionals[0] === 'port' ? positionals.slice(1) : positionals
  const token = tokens[0]
  const interfaces = nodeInterfaces(topology, node.id)
  if (interfaces.length === 0) throw new CommandError(`${node.id} has no connections, so no ports.`)
  if (!token)
    throw new CommandError(
      `Usage: interface port <1-${interfaces.length}> ('show ports' lists them).`
    )
  const entry =
    interfaces.find((candidate) => String(candidate.index) === token) ??
    interfaces.find((candidate) => candidate.edge.id === token)
  if (!entry) {
    throw new CommandError(
      `No port '${token}'. Ports are 1-${interfaces.length}; 'show ports' lists them.`
    )
  }
  return {
    context: enterMode(scope.ctx, {
      mode: 'port-config',
      nodeId: node.id,
      portIndex: entry.index,
      edgeId: entry.edge.id
    }),
    lines: [
      note(
        `Port ${entry.index} is connection ${entry.edge.id} (${entry.direction === 'out' ? `to ${entry.peerId}` : `from ${entry.peerId}`}). ` +
          "Settings here change that edge, exactly as the edge inspector does. 'show' lists them.",
        c
      )
    ]
  }
}

// ─── Port (edge) config ──────────────────────────────────────────────────────

const PORT_ALIASES: Record<string, string> = {
  'max-connections': 'max-concurrent',
  'max-conn': 'max-concurrent',
  'max-concurrent-requests': 'max-concurrent',
  loss: 'packet-loss',
  'packet-loss-rate': 'packet-loss',
  fanout: 'fanout-factor',
  'latency-ms': 'latency'
}

function portEdge(scope: CommandScope) {
  const { topology, node } = contextNode(scope)
  const edgeId = scope.ctx.edgeId
  const edge = topology.edges.find((candidate) => candidate.id === edgeId)
  if (!edgeId || !edge) throw new CommandError('This port no longer exists. exit and pick another.')
  return { topology, node, edge }
}

function portShow(scope: CommandScope): string[] {
  const c = scope.deps.palette
  const { topology, edge } = portEdge(scope)
  const lines = [
    heading(
      `Port ${scope.ctx.portIndex}`,
      c,
      `${edge.id}: ${nodeName(topology, edge.source)} -> ${nodeName(topology, edge.target)}`
    ),
    ...keyValues(
      [
        ['protocol', edge.protocol],
        ['mode', edge.mode],
        ['path type', edge.latency.pathType],
        ['latency', `~${fmtMs(edgeMeanLatencyMs(edge))} (${edge.latency.distribution.type})`],
        ['bandwidth', `${fmtCount(edge.bandwidth)} Mbps`],
        ['max concurrent', fmtCount(edge.maxConcurrentRequests)],
        ['packet loss', fmtPct(edge.packetLossRate, 2)],
        ['error rate', fmtPct(edge.errorRate, 2)]
      ],
      c
    )
  ]
  const fields = scope.deps.edges?.fields(edge.id)
  if (fields) {
    lines.push(
      '',
      ...table(
        ['KEY', 'AUTHORED', 'UNIT', 'LABEL'],
        fields.map((field) => [
          field.key,
          fmtValue(field.authored),
          field.unit ?? (field.options ? field.options.join('|') : ''),
          field.label
        ]),
        c
      ),
      note(
        "Values above are what the engine sees; AUTHORED is what is set on the canvas ('(default)' = derived).",
        c
      )
    )
  }
  return lines
}

const NOT_SIMULATED_PORT: Record<string, string> = {
  shutdown:
    'Port shutdown is not simulated: connections have no up/down state. To cut a dependency, remove the edge, or inject a fault on the peer node (chaos experiment panel).',
  'rate-limit':
    'Per-port rate limiting is not simulated. Put a rate-limiter node in front of the target, which the engine does model (token bucket, sliding window, fixed window).',
  'health-check':
    'Per-port health checks are not simulated. Health probing is modelled per node by health-check components, not per connection.'
}

function portSet(scope: CommandScope, positionals: string[]): string[] {
  const { edge } = portEdge(scope)
  const edges = requireEdges(scope)
  const [rawKey, ...rest] = positionals
  if (!rawKey) throw new CommandError("Usage: set <key> <value>. 'show' lists the keys.")
  const key = PORT_ALIASES[rawKey.toLowerCase()] ?? rawKey.toLowerCase()
  if (NOT_SIMULATED_PORT[key]) throw new CommandError(NOT_SIMULATED_PORT[key])
  const field = edges.fields(edge.id).find((candidate) => candidate.key === key)
  if (!field) {
    throw new CommandError(
      `No connection setting '${rawKey}'. Keys: ${edges
        .fields(edge.id)
        .map((f) => f.key)
        .join(', ')}.`
    )
  }
  if (rest.length === 0) {
    throw new CommandError(
      `Usage: set ${field.key} <value>${field.options ? ` (one of: ${field.options.join(', ')})` : field.unit ? ` (${field.unit})` : ''}`
    )
  }
  const raw = rest.join(' ')
  return reportWrite(
    scope,
    edges.set(edge.id, field.key, raw),
    `${field.key} = ${raw}${field.unit ? ` ${field.unit}` : ''}`
  )
}

function portNo(scope: CommandScope, positionals: string[]): string[] {
  const { edge } = portEdge(scope)
  const edges = requireEdges(scope)
  const [rawKey] = positionals
  if (!rawKey) throw new CommandError('Usage: no <key>')
  const key = PORT_ALIASES[rawKey.toLowerCase()] ?? rawKey.toLowerCase()
  if (key === 'shutdown') {
    return [
      note(
        'Connections are always up in the simulation (shutdown is not simulated), so there is nothing to clear.',
        scope.deps.palette
      )
    ]
  }
  if (NOT_SIMULATED_PORT[key]) throw new CommandError(NOT_SIMULATED_PORT[key])
  const field = edges.fields(edge.id).find((candidate) => candidate.key === key)
  if (!field) throw new CommandError(`No connection setting '${rawKey}'.`)
  return reportWrite(scope, edges.reset(edge.id, field.key), `${field.key} reset to default`)
}

export const CONFIG_COMMANDS: CommandDefinition[] = [
  {
    name: 'set',
    modes: ['node-config'],
    summary: 'Change a setting (same validation and undo as the properties panel)',
    usage: '<key> <value> | distribution <type> <params...>',
    args: [{ name: 'key', kind: 'field' }],
    execute: (scope, args) => ({ lines: setCommand(scope, args.raw) })
  },
  {
    name: 'no',
    modes: ['node-config'],
    summary: 'Reset a setting to its default (IOS convention)',
    usage: '<key>',
    args: [{ name: 'key', kind: 'field' }],
    execute: (scope, args) => ({ lines: noCommand(scope, args.raw) })
  },
  {
    name: 'interface',
    aliases: ['int'],
    modes: ['node-config'],
    summary: 'Enter port config for one connection',
    usage: 'port <N>',
    args: [
      { name: 'port', kind: 'enum', values: ['port'] },
      { name: 'N', kind: 'interface' }
    ],
    execute: (scope, args) => enterPort(scope, args.positionals)
  },
  {
    name: 'show',
    modes: ['port-config'],
    summary: 'This port (connection) and its settings',
    execute: (scope) => ({ lines: portShow(scope) })
  },
  {
    name: 'set',
    modes: ['port-config'],
    summary: 'Change a connection setting (protocol, max-concurrent, bandwidth, ...)',
    usage: '<key> <value>',
    args: [{ name: 'key', kind: 'edge-field' }],
    execute: (scope, args) => ({ lines: portSet(scope, args.raw) })
  },
  {
    name: 'no',
    modes: ['port-config'],
    summary: 'Reset a connection setting to its default',
    usage: '<key>',
    args: [{ name: 'key', kind: 'edge-field' }],
    execute: (scope, args) => ({ lines: portNo(scope, args.raw) })
  },
  {
    name: 'shutdown',
    modes: ['port-config'],
    summary: 'Not simulated (explains why and what to use instead)',
    execute: () => {
      throw new CommandError(NOT_SIMULATED_PORT.shutdown)
    }
  },
  {
    name: 'rate-limit',
    modes: ['port-config'],
    summary: 'Not simulated per port (explains the alternative)',
    execute: () => {
      throw new CommandError(NOT_SIMULATED_PORT['rate-limit'])
    }
  },
  {
    name: 'health-check',
    modes: ['port-config'],
    summary: 'Not simulated per port (explains the alternative)',
    execute: () => {
      throw new CommandError(NOT_SIMULATED_PORT['health-check'])
    }
  }
]
