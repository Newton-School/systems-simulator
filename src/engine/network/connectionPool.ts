/**
 * Edge connection model (issue #181 tasks 5, 6, 8): TLS handshakes, HTTP/2
 * multiplexing and persistent WebSocket connections.
 *
 * Opt-in per edge through `edge.connection`. Without it the engine keeps its
 * historical assumption: every request finds an already-open, warm connection
 * and pays no setup cost.
 *
 * With it, the source keeps a pool of real connections to the target:
 *
 * - A request needs a free stream on a connection. HTTP/1.1-style protocols
 *   (https, tcp) carry one request per connection at a time; HTTP/2 (grpc)
 *   carries up to `maxStreamsPerConnection` concurrent streams on one
 *   connection; WebSocket frames, AMQP channels and Kafka produce requests are
 *   not paired with a response on the connection.
 * - Opening a connection costs handshake round trips (TCP, then TLS, then any
 *   application handshake such as the WebSocket upgrade). One round trip is one
 *   sample of the edge's propagation latency (path-type defaults are RTT
 *   figures). A request that joins a connection still handshaking waits until
 *   it is ready.
 * - `keep-alive` keeps a released connection warm until it has been idle for
 *   `idleTimeoutMs`; `persistent` never idles out (heartbeats keep it open);
 *   `per-request` closes the connection after every request.
 * - When every connection is busy and the pool is at `maxConnections`, the
 *   request waits FIFO for a stream to free up (HTTP/1.1 head-of-line
 *   blocking at the pool). That wait is reported as edge connection wait.
 * - TLS session resumption: after one full handshake with a pool's server,
 *   later new connections resume (TLS 1.2: 1 RTT; TLS 1.3: 0-RTT early data).
 *
 * Pools are per edge for service-to-service traffic (the caller's outbound
 * pool). An edge leaving the workload source carries many clients, so pools
 * are keyed per client identity there (sessionId, clientIp, or the workload
 * key); a request with no client identity is treated as a new client.
 */

import type {
  EdgeConnectionConfig,
  EdgeConnectionReuse,
  EdgeDefinition,
  EdgeTlsVersion
} from '../core/types'

export type EdgeProtocol = EdgeDefinition['protocol']
export type ConnectionReuse = EdgeConnectionReuse
export type TlsVersion = EdgeTlsVersion
export type { EdgeConnectionConfig }

export interface ProtocolConnectionProfile {
  /** UDP has no connection, so the connection model does not apply. */
  connectionOriented: boolean
  /** Application handshake round trips after TCP/TLS (WebSocket upgrade, AMQP open). */
  appHandshakeRtts: number
  /** Default concurrent requests a single connection carries. */
  defaultStreams: number
  /** A synchronous request holds its stream until its response returns. */
  responsePaired: boolean
  /** TLS version assumed when the edge does not set one. */
  defaultTls: TlsVersion
}

export const DEFAULT_KEEP_ALIVE_IDLE_TIMEOUT_MS = 60_000

/**
 * Real-world rationale per protocol:
 * - https: HTTP/1.1 keep-alive, one in-flight request per connection, TLS on.
 * - grpc: HTTP/2, SETTINGS_MAX_CONCURRENT_STREAMS is commonly 100, TLS on;
 *   the connection preface does not wait a round trip.
 * - tcp: database / cache wire protocols run one query at a time per connection.
 * - websocket: HTTP Upgrade (GET + 101) is one extra round trip; frames flow
 *   without pairing to a response, TLS on (wss).
 * - amqp: connection.start / tune / open and channel.open are four round trips;
 *   publishes are not paired (no publisher confirms modeled).
 * - kafka: one ApiVersions round trip; max.in.flight.requests.per.connection = 5.
 */
const PROTOCOL_CONNECTION_PROFILES: Record<EdgeProtocol, ProtocolConnectionProfile> = {
  https: {
    connectionOriented: true,
    appHandshakeRtts: 0,
    defaultStreams: 1,
    responsePaired: true,
    defaultTls: '1.3'
  },
  grpc: {
    connectionOriented: true,
    appHandshakeRtts: 0,
    defaultStreams: 100,
    responsePaired: true,
    defaultTls: '1.3'
  },
  tcp: {
    connectionOriented: true,
    appHandshakeRtts: 0,
    defaultStreams: 1,
    responsePaired: true,
    defaultTls: 'none'
  },
  udp: {
    connectionOriented: false,
    appHandshakeRtts: 0,
    defaultStreams: Number.POSITIVE_INFINITY,
    responsePaired: false,
    defaultTls: 'none'
  },
  websocket: {
    connectionOriented: true,
    appHandshakeRtts: 1,
    defaultStreams: Number.POSITIVE_INFINITY,
    responsePaired: false,
    defaultTls: '1.3'
  },
  amqp: {
    connectionOriented: true,
    appHandshakeRtts: 4,
    defaultStreams: Number.POSITIVE_INFINITY,
    responsePaired: false,
    defaultTls: 'none'
  },
  kafka: {
    connectionOriented: true,
    appHandshakeRtts: 1,
    defaultStreams: 5,
    responsePaired: false,
    defaultTls: 'none'
  }
}

export function getProtocolConnectionProfile(protocol: EdgeProtocol): ProtocolConnectionProfile {
  return PROTOCOL_CONNECTION_PROFILES[protocol]
}

/** TCP three-way handshake: the request rides with the final ACK, so one round trip. */
export const TCP_HANDSHAKE_RTTS = 1

/** Round trips a new connection's TLS handshake costs. */
export function tlsHandshakeRtts(version: TlsVersion, resumed: boolean): number {
  if (version === '1.2') return resumed ? 1 : 2
  if (version === '1.3') return resumed ? 0 : 1
  return 0
}

export interface ResolvedConnectionConfig {
  reuse: ConnectionReuse
  tls: TlsVersion
  tlsSessionResumption: boolean
  idleTimeoutUs: number
  maxConnections: number
  maxStreams: number
  /** Whether a request holds its stream until its response (vs. until delivery). */
  paired: boolean
  appHandshakeRtts: number
}

/**
 * Resolve the edge's connection model, or null when it does not apply (unset,
 * or a connectionless protocol).
 */
export function resolveEdgeConnection(edge: EdgeDefinition): ResolvedConnectionConfig | null {
  const config = edge.connection
  if (!config) return null
  const profile = getProtocolConnectionProfile(edge.protocol)
  if (!profile.connectionOriented) return null
  const positive = (value: number | undefined): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
  const idleTimeoutMs = positive(config.idleTimeoutMs) ?? DEFAULT_KEEP_ALIVE_IDLE_TIMEOUT_MS
  return {
    reuse: config.reuse,
    tls: config.tls ?? profile.defaultTls,
    tlsSessionResumption: config.tlsSessionResumption === true,
    idleTimeoutUs: config.reuse === 'persistent' ? Number.POSITIVE_INFINITY : idleTimeoutMs * 1000,
    maxConnections: positive(config.maxConnections)
      ? Math.floor(config.maxConnections as number)
      : Number.POSITIVE_INFINITY,
    maxStreams: positive(config.maxStreamsPerConnection)
      ? Math.floor(config.maxStreamsPerConnection as number)
      : profile.defaultStreams,
    paired: profile.responsePaired && (edge.mode === 'synchronous' || edge.mode === 'conditional'),
    appHandshakeRtts: profile.appHandshakeRtts
  }
}

interface PooledConnection {
  id: number
  activeStreams: number
  /** When the handshake finishes and requests can be sent (µs). */
  readyAtUs: number
  /** When the connection last became idle (µs). */
  idleSinceUs: number
}

interface ConnectionPoolState<W> {
  connections: PooledConnection[]
  /** A TLS session ticket from an earlier full handshake becomes usable at this time. */
  sessionTicketAtUs: number
  waiters: W[]
}

export interface ConnectionLease {
  poolId: string
  connectionId: number
}

export type ConnectionGrant =
  | {
      kind: 'granted'
      lease: ConnectionLease
      /** Handshake round trips this request pays to open a new connection. */
      handshakeRtts: number
      /** For a reused connection still handshaking: wait until it is ready. */
      readyWaitUs: number
      opened: boolean
      resumed: boolean
      /** Idle keep-alive connections closed by their idle timeout on this acquire. */
      closedIdle: number
    }
  | { kind: 'wait'; closedIdle: number }

/** All connection pools of one run, keyed by pool id (edge id, plus client key). */
export class EdgeConnectionPools<W> {
  private readonly pools = new Map<string, ConnectionPoolState<W>>()
  private nextConnectionId = 1

  private pool(poolId: string): ConnectionPoolState<W> {
    let pool = this.pools.get(poolId)
    if (!pool) {
      pool = { connections: [], sessionTicketAtUs: Number.POSITIVE_INFINITY, waiters: [] }
      this.pools.set(poolId, pool)
    }
    return pool
  }

  /** Number of pools currently tracked (for tests and memory checks). */
  get size(): number {
    return this.pools.size
  }

  /**
   * Take a stream on a connection, opening one if allowed. Returns `wait` when
   * the pool is exhausted; the caller then parks the request with `enqueueWaiter`.
   */
  acquire(poolId: string, nowUs: number, config: ResolvedConnectionConfig): ConnectionGrant {
    const pool = this.pool(poolId)
    let closedIdle = 0
    if (config.reuse === 'keep-alive') {
      const before = pool.connections.length
      pool.connections = pool.connections.filter(
        (connection) =>
          connection.activeStreams > 0 || nowUs - connection.idleSinceUs < config.idleTimeoutUs
      )
      closedIdle = before - pool.connections.length
    }

    if (config.reuse !== 'per-request') {
      // Prefer the busiest connection with a free stream (HTTP/2 packs streams
      // onto one connection); among idle HTTP/1.1 connections take the most
      // recently used one, like most client pools.
      let best: PooledConnection | undefined
      for (const connection of pool.connections) {
        if (connection.activeStreams >= config.maxStreams) continue
        if (
          !best ||
          connection.activeStreams > best.activeStreams ||
          (connection.activeStreams === best.activeStreams &&
            connection.idleSinceUs > best.idleSinceUs)
        ) {
          best = connection
        }
      }
      if (best) {
        best.activeStreams += 1
        return {
          kind: 'granted',
          lease: { poolId, connectionId: best.id },
          handshakeRtts: 0,
          readyWaitUs: Math.max(0, best.readyAtUs - nowUs),
          opened: false,
          resumed: false,
          closedIdle
        }
      }
    }

    if (pool.connections.length >= config.maxConnections) {
      return { kind: 'wait', closedIdle }
    }

    const resumed =
      config.tls !== 'none' && config.tlsSessionResumption && pool.sessionTicketAtUs <= nowUs
    const handshakeRtts =
      TCP_HANDSHAKE_RTTS + tlsHandshakeRtts(config.tls, resumed) + config.appHandshakeRtts
    const connection: PooledConnection = {
      id: this.nextConnectionId++,
      activeStreams: 1,
      readyAtUs: nowUs,
      idleSinceUs: nowUs
    }
    pool.connections.push(connection)
    return {
      kind: 'granted',
      lease: { poolId, connectionId: connection.id },
      handshakeRtts,
      readyWaitUs: 0,
      opened: true,
      resumed,
      closedIdle
    }
  }

  /** Record when a newly opened connection finishes its handshake. */
  markReady(lease: ConnectionLease, readyAtUs: number, config: ResolvedConnectionConfig): void {
    const pool = this.pools.get(lease.poolId)
    const connection = pool?.connections.find((candidate) => candidate.id === lease.connectionId)
    if (!pool || !connection) return
    connection.readyAtUs = readyAtUs
    if (config.tls !== 'none' && readyAtUs < pool.sessionTicketAtUs) {
      pool.sessionTicketAtUs = readyAtUs
    }
  }

  enqueueWaiter(poolId: string, waiter: W, front = false): void {
    const waiters = this.pool(poolId).waiters
    if (front) waiters.unshift(waiter)
    else waiters.push(waiter)
  }

  /** Remove a parked waiter (its deadline fired). Returns whether it was still waiting. */
  removeWaiter(poolId: string, predicate: (waiter: W) => boolean): boolean {
    const pool = this.pools.get(poolId)
    if (!pool) return false
    const index = pool.waiters.findIndex(predicate)
    if (index < 0) return false
    pool.waiters.splice(index, 1)
    return true
  }

  /**
   * Free the lease's stream. Returns the waiters that can now be served, in
   * FIFO order, for the caller to dispatch (they acquire again on dispatch).
   */
  release(
    lease: ConnectionLease,
    nowUs: number,
    config: ResolvedConnectionConfig,
    ephemeral = false
  ): W[] {
    const pool = this.pools.get(lease.poolId)
    if (!pool) return []
    const index = pool.connections.findIndex((candidate) => candidate.id === lease.connectionId)
    if (index >= 0) {
      const connection = pool.connections[index]
      connection.activeStreams = Math.max(0, connection.activeStreams - 1)
      if (connection.activeStreams === 0) {
        connection.idleSinceUs = nowUs
        if (config.reuse === 'per-request') pool.connections.splice(index, 1)
      }
    }
    if (pool.waiters.length === 0) {
      // An ephemeral pool (an anonymous client) is never reused; forget it.
      if (pool.connections.length === 0 && ephemeral) this.pools.delete(lease.poolId)
      return []
    }
    const unopened = Math.max(0, config.maxConnections - pool.connections.length)
    const freeStreams =
      config.reuse === 'per-request'
        ? unopened
        : pool.connections.reduce(
            (sum, connection) => sum + Math.max(0, config.maxStreams - connection.activeStreams),
            0
          ) + (unopened > 0 ? unopened * config.maxStreams : 0)
    const count = Math.min(pool.waiters.length, freeStreams)
    return pool.waiters.splice(0, count)
  }
}
