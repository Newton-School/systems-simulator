import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import { getPaletteTemplate } from '../../../engine/catalog/paletteTemplates'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import type { EdgeDefinition } from '../../../engine/core/types'
import { edgeFieldTitle } from '../../../engine/defaults/edgeFieldLabels'
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

export interface EdgeProtocolPresentation {
  shortLabel: string
  /** Theme-aware accent used by the small direction marker. */
  accent: string
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
      'Competes like a synchronous edge for route selection, but amortizes protocol overhead to model a persistent channel. Messages are not paired with a response, so with a connection model they free their stream on delivery.',
    note: 'Set Connection reuse to persistent to pay the connection handshake once instead of assuming it is free.',
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
    title: edgeFieldTitle('label'),
    summary: 'Short display name shown on the canvas, inspector, validation, and results panels.',
    simulationEffect: 'No runtime effect. This is documentation for humans.'
  },
  protocol: {
    title: edgeFieldTitle('protocol'),
    summary: 'Transport used on the edge: HTTP, gRPC, TCP, UDP, WebSocket, AMQP, or Kafka.',
    simulationEffect:
      'Changes protocol overhead, retransmission behavior, and whether connection-limit rejection applies.'
  },
  mode: {
    title: edgeFieldTitle('mode'),
    summary: 'How the edge participates in routing: wait, fan out, stream, or branch by condition.',
    simulationEffect:
      'Controls whether one route is chosen, all async routes are chosen, or a condition must match first.'
  },
  connectorProtocol: {
    title: edgeFieldTitle('protocol'),
    summary: 'Describes the transport represented by this connector.',
    simulationEffect:
      'Presentation only in connector mode. It changes the badge and arrow accent, not latency, reliability, capacity, cost, or results.'
  },
  connectorMode: {
    title: edgeFieldTitle('connectorMode'),
    summary:
      'Describes whether the connection is synchronous, asynchronous, streaming, or conditional.',
    simulationEffect:
      'Presentation only in connector mode. It changes the badge and line pattern without changing routing or results.'
  },
  pathType: {
    title: edgeFieldTitle('pathType'),
    summary:
      'Physical distance and network locality: same rack, same DC, cross-zone, cross-region, or internet.',
    simulationEffect:
      'Drives runtime latency whenever the edge has not been given an explicit fixed latency or explicit log-normal parameters.',
    note: 'If you set a fixed latency value or explicit mu/sigma, path type becomes descriptive metadata.'
  },
  condition: {
    title: edgeFieldTitle('condition'),
    summary: 'Predicate that filters traffic by request type or request metadata.',
    simulationEffect:
      'A non-empty condition gates the edge even outside conditional mode; conditional mode simply makes it required.',
    note: 'Supported forms today are request.type and request.metadata.<field> with ==, ===, !=, or !==.'
  },
  latencyModel: {
    title: edgeFieldTitle('latencyModel'),
    summary:
      'Auto follows the path-type median with no jitter; manual lets you choose a fixed constant delay or a jittered log-normal profile.',
    simulationEffect:
      'Auto keeps latency derived from path type. Manual directly changes the sampled transit time for every request on the edge.'
  },
  latencyValue: {
    title: edgeFieldTitle('latencyValue'),
    summary: 'Fixed one-way delay added to every hop when constant latency is selected.',
    simulationEffect:
      'Every request pays exactly this transit delay before transmission and protocol overhead.'
  },
  latencyMu: {
    title: edgeFieldTitle('latencyMu'),
    summary:
      'Natural-log median of the base latency distribution before transmission and protocol overhead.',
    simulationEffect:
      'Higher mu shifts the whole latency distribution upward and increases the typical hop time.'
  },
  latencySigma: {
    title: edgeFieldTitle('latencySigma'),
    summary: 'Spread of the log-normal latency distribution.',
    simulationEffect:
      'Higher sigma increases jitter and tail latency without necessarily changing the median.'
  },
  bandwidth: {
    title: edgeFieldTitle('bandwidth'),
    summary: 'Link capacity in megabits per second, shared by every request crossing this edge.',
    simulationEffect:
      'Each request holds the link for sizeBytes / (bandwidth * 125) ms. Requests that arrive while it is busy wait in line, so the edge can never carry more than its bandwidth.',
    note: 'Only request payloads cross edges; response sizes are not modeled.'
  },
  maxConcurrentRequests: {
    title: edgeFieldTitle('maxConcurrentRequests'),
    summary:
      'How many transfers the edge can carry at once before it behaves like a saturated connection pool.',
    simulationEffect:
      'Near the cap, latency inflates; at or above the cap, reliable protocols reject new transfers with connection_refused.'
  },
  weight: {
    title: edgeFieldTitle('weight'),
    summary: "Relative share of the source's traffic sent down this edge under weighted routing.",
    simulationEffect:
      "Each edge gets weight ÷ sum-of-sibling-weights of the traffic. Only applies when the source's strategy is Weighted (or unset with weights present); empty is treated as 1.",
    note: 'Shown as a % badge on the edge when the source routes by weight.'
  },
  packetLossRate: {
    title: edgeFieldTitle('packetLossRate'),
    summary: 'Probability that packets are dropped while traversing the edge.',
    simulationEffect:
      'UDP loss becomes a timeout/drop. Reliable protocols simulate retransmission by adding extra delay instead of immediate failure.'
  },
  errorRate: {
    title: edgeFieldTitle('errorRate'),
    summary: 'Probability that the link itself rejects the request independent of packet loss.',
    simulationEffect:
      'Produces an immediate edge-level failure before the request arrives at the target node.'
  },
  fanoutFactor: {
    title: edgeFieldTitle('fanoutFactor'),
    summary:
      'Amplification: each request delivered over this edge fans out to this many recipients (e.g. one post → N follower feed writes). Leave empty or 1 for no amplification.',
    simulationEffect:
      'The target genuinely receives N× the load — the write storm — so it can saturate. Use an asynchronous edge so the caller does not block on all N deliveries. The extra writes are counted as fanoutAmplifiedWrites on the source.'
  },
  connectionReuse: {
    title: edgeFieldTitle('connectionReuse'),
    summary:
      'How the caller gets a connection for each request. Off keeps the default assumption that a warm connection is always ready. Per request opens and closes a connection every time; keep-alive reuses warm connections until they idle out; persistent opens once and keeps it (WebSocket, long-lived gRPC channels).',
    simulationEffect:
      'A new connection pays its handshake round trips before the request goes out: TCP 1, TLS 1.2 +2 (1.3 +1), WebSocket upgrade +1, AMQP open +4, Kafka ApiVersions +1. One round trip is one sample of this edge latency. Reused connections pay nothing, so reuse is why keep-alive and persistent connections win.',
    note: 'Pools are per edge for service-to-service calls. On an edge leaving the traffic source each client (sessionId, clientIp or workload key) has its own connections; a request with no client identity is a new client. Not used on UDP (connectionless) or on a Kafka edge with batching.'
  },
  tlsVersion: {
    title: edgeFieldTitle('tlsVersion'),
    summary:
      'TLS on new connections. Default: TLS 1.3 for HTTPS, gRPC and WebSocket (wss); none for TCP, AMQP and Kafka.',
    simulationEffect:
      'TLS 1.2 adds 2 round trips to every new connection, TLS 1.3 adds 1. This is why CDNs and load balancers terminate TLS close to the user, and why connection reuse matters.',
    note: 'The per-request record encryption cost is part of the protocol overhead already; handshake CPU cost is not modeled.'
  },
  tlsSessionResumption: {
    title: edgeFieldTitle('tlsSessionResumption'),
    summary:
      'Reuse a session ticket from an earlier full handshake with the same server when opening a new connection.',
    simulationEffect:
      'After the first full handshake, new connections resume: TLS 1.2 pays 1 round trip instead of 2; TLS 1.3 uses 0-RTT early data and pays none.',
    note: 'Assumes the server accepts 0-RTT early data for TLS 1.3 (without it, a 1.3 resumption still costs 1 round trip). Ticket expiry is not modeled.'
  },
  connectionIdleTimeoutMs: {
    title: edgeFieldTitle('connectionIdleTimeoutMs'),
    summary:
      'Keep-alive only: a warm connection that has been idle this long is closed. Default 60,000 ms (typical server keep-alive timeouts are 60-90 s).',
    simulationEffect:
      'Bursty or low-rate traffic finds its connections closed and pays the handshake again; a short timeout turns keep-alive back into per-request.'
  },
  maxConnections: {
    title: edgeFieldTitle('maxConnections'),
    summary:
      'Most connections one pool may open (a client connection pool size). Empty means open as many as the load needs.',
    simulationEffect:
      'When every connection is busy and the pool is full, requests wait in line for a free one (connection wait in the latency breakdown) or time out. With one request per connection (HTTP/1.1) a slow downstream blocks the line; HTTP/2 multiplexing does not.'
  },
  maxStreamsPerConnection: {
    title: edgeFieldTitle('maxStreamsPerConnection'),
    summary:
      'Concurrent requests one connection carries. Defaults: HTTPS and TCP 1 (HTTP/1.1, database wire protocols), gRPC 100 (HTTP/2 SETTINGS_MAX_CONCURRENT_STREAMS), Kafka 5 (max.in.flight), WebSocket and AMQP unlimited.',
    simulationEffect:
      'A synchronous HTTPS, gRPC or TCP request holds its stream until its response returns; WebSocket, AMQP and Kafka messages free it on delivery. More streams per connection means fewer connections, fewer handshakes and no head-of-line wait.'
  },
  batchLingerMs: {
    title: edgeFieldTitle('batchLingerMs'),
    summary:
      'Kafka producer linger.ms: records wait this long for more records to join their batch before it is sent. Empty means no batching (each record is its own request). Kafka 4 defaults to 5 ms.',
    simulationEffect:
      'Each batch is one produce request: one edge slot, one protocol overhead, one trip. Fewer requests in flight means more records get through the same Max concurrent requests (in-flight) cap, at the cost of each record waiting in the batch.',
    note: 'Only on Kafka edges. Compression, acks levels and buffer.memory back-pressure are not modeled.'
  },
  batchMaxBytes: {
    title: edgeFieldTitle('batchMaxBytes'),
    summary:
      'Kafka producer batch.size: a batch is sent as soon as it holds this many bytes, before linger expires. Default 16,384.',
    simulationEffect:
      'At high rates batches fill before linger expires, so the batch wait shrinks while throughput stays high.'
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

export const EDGE_PROTOCOL_PRESENTATION: Record<EdgeProtocolValue, EdgeProtocolPresentation> = {
  https: { shortLabel: 'HTTPS', accent: 'rgb(var(--nss-primary))' },
  grpc: { shortLabel: 'gRPC', accent: 'rgb(var(--nss-info))' },
  tcp: { shortLabel: 'TCP', accent: 'var(--nss-muted)' },
  udp: { shortLabel: 'UDP', accent: 'rgb(var(--nss-warning))' },
  websocket: { shortLabel: 'WebSocket', accent: 'rgb(var(--nss-info))' },
  amqp: { shortLabel: 'AMQP', accent: 'rgb(var(--nss-success))' },
  kafka: { shortLabel: 'Kafka', accent: 'rgb(var(--nss-success))' }
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

export function getEdgeProtocolPresentation(
  protocol: EdgeSimulationData['protocol'] | EdgeDefinition['protocol'] | undefined
): EdgeProtocolPresentation {
  return EDGE_PROTOCOL_PRESENTATION[protocol ?? 'https']
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
  const hasExplicitLatencyValue = hasFiniteNumber(edgeData.latencyValue)
  const hasExplicitLogNormalParams =
    hasFiniteNumber(edgeData.latencyMu) || hasFiniteNumber(edgeData.latencySigma)
  const distributionType =
    edgeData.latencyDistributionType === 'constant'
      ? 'constant'
      : edgeData.latencyDistributionType === 'log-normal'
        ? 'log-normal'
        : hasExplicitLatencyValue && !hasExplicitLogNormalParams
          ? 'constant'
          : hasExplicitLogNormalParams
            ? 'log-normal'
            : 'constant'

  return (
    (distributionType === 'constant' && !hasExplicitLatencyValue) ||
    (distributionType === 'log-normal' && !hasExplicitLogNormalParams)
  )
}
