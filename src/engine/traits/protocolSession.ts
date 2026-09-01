import type { ComponentType } from '../core/types'
import { routeSession } from '../semantics/v2StateMachines'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

const TYPES = [
  'load-balancer-l4',
  'load-balancer-l7',
  'api-gateway'
] as const satisfies readonly ComponentType[]
export const protocolSessionTrait: NodeBehaviourTrait = {
  name: 'protocol.session',
  beforeArrival: ({ node, request }) => {
    const protocol = node.config?.['sessionProtocol'] === 'websocket' ? 'websocket' : 'http'
    const open = node.config?.['sessionOpen'] !== false
    const window = typeof node.config?.['streamWindow'] === 'number' ? node.config.streamWindow : 1
    const paths =
      typeof node.config?.['allowedPaths'] === 'string'
        ? node.config.allowedPaths
            .split(',')
            .map((path) => path.trim())
            .filter(Boolean)
        : []
    const result = routeSession(
      { protocol, open, streamWindow: window },
      node.type === 'load-balancer-l4' ? 'l4' : 'l7',
      { path: typeof request.metadata.path === 'string' ? request.metadata.path : undefined },
      paths
    )
    if (result === 'forwarded')
      return { action: 'continue', payload: { protocolSessionOpen: true } }
    return {
      action: 'rejected',
      reason: result === 'flow-controlled' ? 'stream_flow_controlled' : 'protocol_policy_rejected',
      payload: {
        protocolSessionOpen: open,
        protocolL7Rejected: result === 'rejected',
        protocolFlowControlled: result === 'flow-controlled',
        metricCounters: {
          ...(result === 'rejected' ? { protocolL7Rejects: 1 } : { protocolFlowControlled: 1 })
        }
      }
    }
  }
}
export const protocolSessionCapabilityModule: NodeCapabilityModule = {
  name: 'protocol.session',
  appliesTo: TYPES,
  hooks: protocolSessionTrait,
  config: {
    sections: [
      {
        id: 'protocol-session',
        title: 'Protocol Session',
        note: 'L4 routes connections without request-content policy. L7 can enforce configured paths; WebSocket sessions observe a flow-control window.',
        noteTone: 'info',
        fields: [
          { path: 'sim.sessionOpen', type: 'boolean', label: 'Session open', altitude: 'advanced' },
          {
            path: 'sim.sessionProtocol',
            type: 'select',
            label: 'Protocol',
            options: ['http', 'websocket'],
            altitude: 'advanced'
          },
          {
            path: 'sim.streamWindow',
            type: 'input',
            inputType: 'number',
            label: 'Stream window',
            min: 0,
            altitude: 'advanced'
          },
          {
            path: 'sim.allowedPaths',
            type: 'input',
            inputType: 'text',
            label: 'Allowed paths',
            altitude: 'advanced'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['protocolL7Rejects', 'protocolFlowControlled'] },
  honesty: {
    simulates: ['connection open state, L7 path policy, and WebSocket flow-control rejection'],
    notModeled: ['TCP handshake timing, TLS, HTTP/2 multiplexing, and packet-level retransmission']
  }
}
