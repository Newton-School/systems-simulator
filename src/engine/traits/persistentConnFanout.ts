import type { ComponentNode, ComponentType } from '../core/types'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import { DEFAULT_HEARTBEAT_COST_MS, DEFAULT_MEM_PER_CONNECTION_KB } from '../nodes/heldConnections'
import { deriveNodeConcurrency } from '../nodes/resourceDerivation'
import { SERVICE_TIME_CPU_WORK_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

/** Gateways that hold client connections open and push to them. */
export const PERSISTENT_CONN_COMPONENT_TYPES = [
  'api-gateway',
  'websockets-gateway',
  'push-notification-service'
] as const satisfies readonly ComponentType[]

export const DEFAULT_PUSH_SEND_MS = 0.01

const CONNECTED_SHARE_KEY = 'persistentConn.connectedShare'
const DELIVERY_CARRY_KEY = 'persistentConn.deliveryCarry'

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function readPushRecipients(config: Record<string, unknown> | undefined): number | null {
  const value = positive(config?.['pushRecipients'])
  return value === null ? null : Math.round(value)
}

/** Share of offered connections this fleet actually holds (1 when none are declared). */
function connectedShare(node: ComponentNode, state: TraitStateStore | undefined): number {
  const cached = state?.get<number>(CONNECTED_SHARE_KEY)
  if (cached !== undefined) return cached
  const held = deriveNodeConcurrency(node).heldConnections
  const share = held && held.offered > 0 ? held.held / held.offered : 1
  state?.set(CONNECTED_SHARE_KEY, share)
  return share
}

/**
 * Push fan-out over held connections. Each message this gateway handles is
 * written to `pushRecipients` open connections, and every write is CPU on this
 * node (`pushSendMs` each), so a big room or a hot channel costs the gateway
 * real core time and stretches under core contention. Recipients whose
 * connection the fleet refused (over its connection or RAM ceiling) cannot be
 * reached: those writes are counted as undeliverable, not performed.
 *
 * This is the node side that edge `fanoutFactor` does not cover: fanoutFactor
 * multiplies requests to a downstream node, while here the recipients are
 * clients on sockets this node holds.
 */
export const persistentConnFanoutTrait: NodeBehaviourTrait = {
  name: 'realtime.persistent-connection-fanout',
  isEnabledFor: (node) => readPushRecipients(node.config) !== null,
  beforeArrival: ({ node, request, state }) => {
    const recipients = readPushRecipients(node.config)
    if (recipients === null) return { action: 'continue' }
    const sendMs = nonNegative(node.config?.['pushSendMs']) ?? DEFAULT_PUSH_SEND_MS
    const share = connectedShare(node, state)
    // Whole-number delivery counts with a running carry, so the totals equal
    // recipients x share over the run without sampling noise.
    const exact = recipients * share + (state?.get<number>(DELIVERY_CARRY_KEY) ?? 0)
    const delivered = Math.min(recipients, Math.floor(exact + 1e-9))
    state?.set(DELIVERY_CARRY_KEY, exact - delivered)
    const undeliverable = recipients - delivered
    const workMs = delivered * sendMs
    const existing = request.metadata[SERVICE_TIME_CPU_WORK_MS_KEY]
    request.metadata[SERVICE_TIME_CPU_WORK_MS_KEY] =
      (typeof existing === 'number' ? existing : 0) + workMs
    return {
      action: 'continue',
      payload: {
        pushRecipients: recipients,
        pushWorkMs: workMs,
        metricCounters: {
          pushMessages: 1,
          pushDeliveries: delivered,
          ...(undeliverable > 0 ? { pushUndeliverable: undeliverable } : {})
        }
      }
    }
  }
}

function heldDeclared(data: CanvasNodeDataV2): boolean {
  return (data.sim?.connection?.offeredConnections ?? 0) > 0
}

/** Runtime hook: registered on every gateway type, enabled only when pushRecipients is set. */
export const persistentConnFanoutHookModule: NodeCapabilityModule = {
  name: 'realtime.persistent-connection-fanout',
  appliesTo: PERSISTENT_CONN_COMPONENT_TYPES,
  hooks: persistentConnFanoutTrait,
  defaults: [],
  metrics: {
    counters: [
      'pushMessages',
      'pushDeliveries',
      'pushUndeliverable',
      'connectionsHeld',
      'connectionsRefused'
    ]
  },
  honesty: {
    simulates: [
      'held connections pin RAM (shrinking request admission) and are capped per instance and by RAM; the overflow is refused',
      'keepalive heartbeats as steady CPU taken from request cores and counted in CPU utilization',
      'push fan-out: each message is written to every connected recipient as on-core work; recipients whose connection was refused are counted undeliverable'
    ],
    notModeled: [
      'connect / reconnect storms (held connections are a steady state)',
      'per-connection send buffers filling for slow clients, backpressure, or dropping slow consumers',
      'routing a message to the gateway instance that holds each recipient (pub/sub between gateways)',
      'held connections on a node without an instance type (no RAM or cores to derive from)'
    ]
  }
}

/** Panel: shown on gateways with a connection tier (Connection Server). */
export const persistentConnFanoutCapabilityModule: NodeCapabilityModule = {
  name: 'realtime.persistent-connection-fanout.panel',
  appliesWhen: (data) =>
    data.sim?.connection !== undefined &&
    PERSISTENT_CONN_COMPONENT_TYPES.includes(data.componentType as never),
  config: {
    sections: [
      {
        id: 'held-connections',
        title: 'Held Connections & Push',
        note: (data) => {
          if (!heldDeclared(data)) {
            return 'Set Offered connections in Connection capacity to make held connections cost RAM and heartbeat CPU in the run. Push recipients makes every message a write to that many open sockets.'
          }
          const resources = data.sim?.resources
          if (!resources?.instanceType || !data.componentType) return null
          const node = {
            id: 'preview',
            type: data.componentType,
            resources,
            queue: data.sim?.queue,
            config: {
              heldConnections: data.sim?.connection?.offeredConnections,
              maxConnectionsPerInstance: data.sim?.connection?.maxConnectionsPerInstance,
              heartbeatIntervalMs: data.sim?.connection?.heartbeatIntervalMs,
              memPerConnectionKb: data.sim?.memPerConnectionKb,
              heartbeatCostMs: data.sim?.heartbeatCostMs
            }
          } as unknown as ComponentNode
          const derived = deriveNodeConcurrency(node)
          const held = derived.heldConnections
          if (!held) return null
          const refused =
            held.refused > 0
              ? ` · ${held.refused.toLocaleString()} refused (${held.refusedBy === 'ram' ? 'out of RAM' : 'connection limit'})`
              : ''
          return `${held.held.toLocaleString()} held · ${Math.round(held.connectionRamMb).toLocaleString()} MB pinned · ${held.heartbeatCores.toFixed(2)} cores on heartbeats${refused} → requests get c ${derived.effectiveC} · K ${derived.effectiveK}`
        },
        noteTone: 'info',
        fields: [
          {
            path: 'sim.memPerConnectionKb',
            type: 'input',
            inputType: 'number',
            label: 'Memory per connection',
            unit: 'KB',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_MEM_PER_CONNECTION_KB} KB`,
            why: 'RAM each open connection pins (socket buffers, TLS state, the connection’s task). Held connections use RAM before requests do.'
          },
          {
            path: 'sim.heartbeatCostMs',
            type: 'input',
            inputType: 'number',
            label: 'Heartbeat CPU cost',
            unit: 'ms',
            min: 0,
            step: 0.001,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_HEARTBEAT_COST_MS} ms`,
            why: 'Core time to handle one keepalive ping. Times held connections / heartbeat interval, it is steady CPU taken from request work.'
          },
          {
            path: 'sim.pushRecipients',
            type: 'input',
            inputType: 'number',
            label: 'Push recipients per message',
            min: 1,
            altitude: 'primary',
            optional: true,
            why: 'Connections each message is written to (room or channel size). Every write is CPU on this gateway.'
          },
          {
            path: 'sim.pushSendMs',
            type: 'input',
            inputType: 'number',
            label: 'Send cost per recipient',
            unit: 'ms',
            min: 0,
            step: 0.001,
            altitude: 'advanced',
            placeholder: `Default ${DEFAULT_PUSH_SEND_MS} ms`,
            why: 'Core time to frame and write one message to one socket.'
          }
        ]
      }
    ]
  },
  defaults: [],
  honesty: persistentConnFanoutHookModule.honesty
}
