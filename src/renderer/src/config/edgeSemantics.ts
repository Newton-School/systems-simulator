import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import { getPaletteTemplate } from '../../../engine/catalog/paletteTemplates'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import type { EdgeDefinition } from '../../../engine/core/types'
import type { EdgeSimulationData } from '@renderer/types/ui'

export type EdgeModeValue = EdgeDefinition['mode']
export type EdgeProtocolValue = EdgeDefinition['protocol']
export type EdgePathTypeValue = EdgeDefinition['latency']['pathType']

export interface EdgeHelpEntry {
  title: string
  summary: string
  simulationEffect: string
  note?: string
}

export interface EdgeModePresentation extends EdgeHelpEntry {
  shortLabel: string
  strokeDasharray: string
  badgeClassName: string
}

export const EDGE_MODE_PRESENTATION: Record<EdgeModeValue, EdgeModePresentation> = {
  synchronous: {
    title: 'Synchronous',
    shortLabel: 'SYNC',
    summary: 'Caller sends work and waits for the downstream hop to finish.',
    simulationEffect: 'Competes with other non-async edges; the router picks one route per hop.',
    strokeDasharray: 'none',
    badgeClassName: 'border-nss-border bg-nss-surface text-nss-muted'
  },
  asynchronous: {
    title: 'Asynchronous',
    shortLabel: 'ASYNC',
    summary: 'Fire-and-forget delivery to downstream async boundaries such as queues or brokers.',
    simulationEffect: 'Every matching async edge is selected, so requests fan out in parallel.',
    strokeDasharray: '12 7',
    badgeClassName: 'border-nss-success/30 bg-nss-success/10 text-nss-success'
  },
  streaming: {
    title: 'Streaming',
    shortLabel: 'STREAM',
    summary: 'Represents a long-lived channel such as WebSocket or bidirectional RPC.',
    simulationEffect:
      'Competes like a synchronous edge for route selection, but amortizes protocol overhead to model a persistent channel.',
    note: 'Useful for teaching stream topology today; full session state and multiplexed message behavior are still not modeled.',
    strokeDasharray: '4 6',
    badgeClassName: 'border-nss-primary/30 bg-nss-primary/10 text-nss-primary'
  },
  conditional: {
    title: 'Conditional',
    shortLabel: 'IF',
    summary: 'Route is only eligible when its condition matches the request payload or metadata.',
    simulationEffect: 'Competes like a synchronous edge, but only after the condition gate passes.',
    strokeDasharray: '14 6 2 6',
    badgeClassName: 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
  }
}

export const EDGE_PROPERTY_HELP = {
  label: {
    title: 'Label',
    summary: 'Short display name shown on the canvas, inspector, validation, and results panels.',
    simulationEffect: 'No runtime effect. This is documentation for humans.'
  },
  protocol: {
    title: 'Protocol',
    summary: 'Transport used on the edge: HTTP, gRPC, TCP, UDP, WebSocket, AMQP, or Kafka.',
    simulationEffect:
      'Changes protocol overhead, retransmission behavior, and whether connection-limit rejection applies.'
  },
  mode: {
    title: 'Mode',
    summary: 'How the edge participates in routing: wait, fan out, stream, or branch by condition.',
    simulationEffect:
      'Controls whether one route is chosen, all async routes are chosen, or a condition must match first.'
  },
  pathType: {
    title: 'Path Type',
    summary:
      'Physical distance and network locality: same rack, same DC, cross-zone, cross-region, or internet.',
    simulationEffect:
      'Only drives runtime latency when the edge is still using the path-type-derived log-normal profile.',
    note: 'If you switch to constant latency or set explicit mu/sigma, path type becomes descriptive metadata.'
  },
  condition: {
    title: 'Condition',
    summary: 'Predicate that filters traffic by request type or request metadata.',
    simulationEffect:
      'A non-empty condition gates the edge even outside conditional mode; conditional mode simply makes it required.',
    note: 'Supported forms today are request.type and request.metadata.<field> with ==, ===, !=, or !==.'
  },
  latencyModel: {
    title: 'Latency Model',
    summary: 'Choose either a jittered log-normal hop delay or a fixed constant delay.',
    simulationEffect:
      'This directly changes the sampled transit time for every request on the edge.'
  },
  latencyValue: {
    title: 'Latency (ms)',
    summary: 'Fixed one-way delay added to every hop when constant latency is selected.',
    simulationEffect:
      'Every request pays exactly this transit delay before transmission and protocol overhead.'
  },
  latencyMu: {
    title: 'Latency Mu (log-space)',
    summary:
      'Natural-log median of the base latency distribution before transmission and protocol overhead.',
    simulationEffect:
      'Higher mu shifts the whole latency distribution upward and increases the typical hop time.'
  },
  latencySigma: {
    title: 'Jitter Sigma',
    summary: 'Spread of the log-normal latency distribution.',
    simulationEffect:
      'Higher sigma increases jitter and tail latency without necessarily changing the median.'
  },
  bandwidth: {
    title: 'Bandwidth (Mbps)',
    summary: 'Link throughput used to convert request size into transmission time.',
    simulationEffect:
      'Adds transmission delay as request.sizeBytes / (bandwidth * 125). Large payloads slow down more on narrow links.'
  },
  maxConcurrentRequests: {
    title: 'Max Concurrent',
    summary:
      'How many transfers the edge can carry at once before it behaves like a saturated connection pool.',
    simulationEffect:
      'Near the cap, latency inflates; at or above the cap, reliable protocols reject new transfers with connection_refused.'
  },
  packetLossRate: {
    title: 'Packet Loss (%)',
    summary: 'Probability that packets are dropped while traversing the edge.',
    simulationEffect:
      'UDP loss becomes a timeout/drop. Reliable protocols simulate retransmission by adding extra delay instead of immediate failure.'
  },
  errorRate: {
    title: 'Edge Error (%)',
    summary: 'Probability that the link itself rejects the request independent of packet loss.',
    simulationEffect:
      'Produces an immediate edge-level failure before the request arrives at the target node.'
  }
} satisfies Record<string, EdgeHelpEntry>

export const EDGE_PROTOCOL_HELP: Record<EdgeProtocolValue, EdgeHelpEntry> = {
  https: {
    title: 'HTTPS',
    summary: 'Secure request-response traffic typical for internet-facing APIs.',
    simulationEffect: 'Moderate protocol overhead with reliable retransmission semantics.'
  },
  grpc: {
    title: 'gRPC',
    summary: 'Binary RPC over reliable transport, common inside service meshes.',
    simulationEffect: 'Low fixed overhead with reliable retransmission semantics.'
  },
  tcp: {
    title: 'TCP',
    summary: 'Raw reliable transport used by databases, caches, and lower-level services.',
    simulationEffect:
      'No extra protocol overhead beyond transport, but connection limits still apply.'
  },
  udp: {
    title: 'UDP',
    summary: 'Connectionless transport used when speed matters more than guaranteed delivery.',
    simulationEffect:
      'No retransmission and no connection-limit rejection, so packet loss becomes a direct timeout/drop signal.'
  },
  websocket: {
    title: 'WebSocket',
    summary: 'Long-lived bidirectional channel for live updates and interactive sessions.',
    simulationEffect:
      'Low fixed overhead with reliable delivery; best paired with streaming mode for clear topology intent.'
  },
  amqp: {
    title: 'AMQP',
    summary: 'Broker-style messaging protocol used for queues and work distribution.',
    simulationEffect:
      'Higher fixed overhead with reliable delivery semantics and broker-style async routing.'
  },
  kafka: {
    title: 'Kafka',
    summary: 'Durable streaming/broker protocol used for event logs and stream processing.',
    simulationEffect:
      'Higher fixed overhead with reliable delivery semantics and async fan-out topologies.'
  }
}

export const EDGE_PATH_TYPE_HELP: Record<EdgePathTypeValue, EdgeHelpEntry> = {
  'same-rack': {
    title: 'Same Rack',
    summary: 'Shortest, fastest local path between tightly colocated components.',
    simulationEffect: 'Lowest inferred latency and highest default bandwidth.'
  },
  'same-dc': {
    title: 'Same DC',
    summary: 'Local datacenter traffic between nearby but not identical racks.',
    simulationEffect: 'Low inferred latency with high default bandwidth.'
  },
  'cross-zone': {
    title: 'Cross Zone',
    summary: 'Traffic crossing failure domains inside one region.',
    simulationEffect: 'Higher inferred latency and lower default bandwidth than same-DC links.'
  },
  'cross-region': {
    title: 'Cross Region',
    summary: 'Traffic crossing regional boundaries over long-haul links.',
    simulationEffect: 'High inferred latency and reduced default bandwidth.'
  },
  internet: {
    title: 'Internet',
    summary: 'Public-network or external-service traffic with the widest latency spread.',
    simulationEffect: 'Highest inferred latency variance and the lowest default bandwidth.'
  }
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function getEdgeModePresentation(
  mode: EdgeSimulationData['mode'] | EdgeDefinition['mode'] | undefined
): EdgeModePresentation {
  return EDGE_MODE_PRESENTATION[mode ?? 'synchronous']
}

export function inferCanvasEdgeMode(
  edgeData: Pick<EdgeSimulationData, 'mode' | 'protocol'> | undefined,
  targetNodeData?: CanvasNodeDataV2
): EdgeModeValue {
  if (edgeData?.mode) {
    return edgeData.mode
  }

  if (
    edgeData?.protocol === 'websocket' ||
    targetNodeData?.componentType === 'websockets-gateway'
  ) {
    return 'streaming'
  }

  const targetTemplate = getPaletteTemplate(targetNodeData?.templateId)
  const targetSpec = getComponentSpec(targetNodeData?.componentType)
  return targetTemplate?.asyncBoundary || targetSpec?.asyncBoundary ? 'asynchronous' : 'synchronous'
}

export function isPathTypeDrivingLatency(
  edgeData: Pick<
    EdgeSimulationData,
    'latencyDistributionType' | 'latencyValue' | 'latencyMu' | 'latencySigma'
  >
): boolean {
  const distributionType =
    edgeData.latencyDistributionType === 'constant'
      ? 'constant'
      : edgeData.latencyDistributionType === 'log-normal'
        ? 'log-normal'
        : hasFiniteNumber(edgeData.latencyValue) &&
            !hasFiniteNumber(edgeData.latencyMu) &&
            !hasFiniteNumber(edgeData.latencySigma)
          ? 'constant'
          : 'log-normal'

  return (
    distributionType === 'log-normal' &&
    !hasFiniteNumber(edgeData.latencyMu) &&
    !hasFiniteNumber(edgeData.latencySigma)
  )
}
