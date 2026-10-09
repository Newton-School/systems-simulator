/**
 * Held persistent connections (the `persistentConnFanout` trait, node side).
 *
 * A WebSocket / push gateway keeps every client's connection open. Idle
 * connections are not requests, but they are not free either:
 *
 *   - each pins memory (socket buffers, TLS state, the per-connection task),
 *     so the RAM left for request work shrinks and admission K falls;
 *   - a box holds at most `maxConnectionsPerInstance` (file descriptors, ports),
 *     and at most as many as fit in RAM; the rest are refused;
 *   - keepalive heartbeats are steady background CPU: held / interval pings a
 *     second, each costing `heartbeatCostMs` of a core, taken off the cores
 *     that serve requests.
 *
 * All of it is a function of the node's config and instance shape, so it is
 * folded into the derived c / K (resourceDerivation.ts) and shown in the panel.
 */

export const DEFAULT_MEM_PER_CONNECTION_KB = 32
export const DEFAULT_HEARTBEAT_COST_MS = 0.01

export interface HeldConnectionLoad {
  offered: number
  held: number
  /** Offered connections no instance could hold (fd/port ceiling or RAM). */
  refused: number
  refusedBy: 'none' | 'connection-limit' | 'ram'
  /** RAM pinned by held connections, MB (whole fleet). */
  connectionRamMb: number
  heartbeatRps: number
  /** Cores kept busy by heartbeats (whole fleet). */
  heartbeatCores: number
  /** Share of the fleet's cores left for request work (0..1). */
  coreShare: number
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function readHeldConnections(config: Record<string, unknown> | undefined): number | null {
  const held = positive(config?.['heldConnections'])
  return held === null ? null : Math.floor(held)
}

/** Null when the node declares no held connections (the trait is off). */
export function deriveHeldConnectionLoad(
  config: Record<string, unknown> | undefined,
  fleet: { instanceCount: number; vcpuPerInstance: number; ramGbPerInstance: number }
): HeldConnectionLoad | null {
  const offered = readHeldConnections(config)
  if (offered === null) return null
  const instances = Math.max(0, fleet.instanceCount)
  const memKb = positive(config?.['memPerConnectionKb']) ?? DEFAULT_MEM_PER_CONNECTION_KB
  const perInstance = positive(config?.['maxConnectionsPerInstance'])
  const totalRamMb = fleet.ramGbPerInstance * 1024 * instances
  const ramCap = Math.floor((totalRamMb * 1024) / memKb)
  const limitCap = perInstance === null ? Infinity : Math.floor(perInstance) * instances
  const held = Math.max(0, Math.min(offered, limitCap, ramCap))
  const refused = offered - held
  const refusedBy: HeldConnectionLoad['refusedBy'] =
    refused === 0 ? 'none' : limitCap <= ramCap ? 'connection-limit' : 'ram'

  const intervalMs = positive(config?.['heartbeatIntervalMs'])
  const costMs = nonNegative(config?.['heartbeatCostMs']) ?? DEFAULT_HEARTBEAT_COST_MS
  const heartbeatRps = intervalMs === null ? 0 : held / (intervalMs / 1000)
  const heartbeatCores = (heartbeatRps * costMs) / 1000
  const cores = fleet.vcpuPerInstance * instances
  const coreShare = cores > 0 ? Math.max(0, Math.min(1, 1 - heartbeatCores / cores)) : 0

  return {
    offered,
    held,
    refused,
    refusedBy,
    connectionRamMb: (held * memKb) / 1024,
    heartbeatRps,
    heartbeatCores,
    coreShare
  }
}
