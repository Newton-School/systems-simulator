/**
 * Connection-tier capacity (spec: connection-tier-capacity.md, GAP 1).
 *
 * Concurrent held connections are a capacity dimension distinct from request throughput
 * (RPS) — a WebSocket / connection server holds N long-lived sessions and saturates at a
 * ceiling. Like the instance model (`resourceDefaults.ts`), this is a *pure function of
 * the configuration*, computable pre-run: given per-instance capacity, instance count,
 * and the offered connection count, it derives fleet capacity, utilization, refused
 * overflow, the required instance count, and the heartbeat background load. It is not a
 * faked runtime metric — it is capacity-planning math, the connection analogue of storage
 * GB.
 */

export interface ConnectionConfig {
  maxConnectionsPerInstance: number
  offeredConnections: number
  heartbeatIntervalMs?: number
  sessionProtocol?: 'websocket' | 'tcp' | 'http2'
}

export interface ConnectionCapacityResult {
  /** maxConnectionsPerInstance × instanceCount. */
  fleetCapacity: number
  /** Connections actually held (min of offered and fleet capacity). */
  connectionsHeld: number
  /** Offered connections that exceed capacity and are refused. */
  connectionsRefused: number
  /** offeredConnections / fleetCapacity (can exceed 1 when saturated). */
  utilization: number
  /** ceil(offeredConnections / maxConnectionsPerInstance) — the fleet size this tier needs. */
  requiredInstances: number
  /** Background keepalive load implied by the held connections, in rps. */
  heartbeatRps: number
  /** True when offered exceeds fleet capacity. */
  saturated: boolean
}

export function deriveConnectionCapacity(
  config: ConnectionConfig,
  instanceCount: number
): ConnectionCapacityResult {
  const perInstance = Math.max(1, Math.floor(config.maxConnectionsPerInstance))
  const instances = Math.max(1, Math.floor(instanceCount))
  const offered = Math.max(0, Math.floor(config.offeredConnections))

  const fleetCapacity = perInstance * instances
  const connectionsHeld = Math.min(offered, fleetCapacity)
  const connectionsRefused = Math.max(0, offered - fleetCapacity)
  const utilization = fleetCapacity > 0 ? offered / fleetCapacity : 0
  const requiredInstances = perInstance > 0 ? Math.ceil(offered / perInstance) : 0

  const heartbeatMs = config.heartbeatIntervalMs
  const heartbeatRps =
    typeof heartbeatMs === 'number' && heartbeatMs > 0 ? offered / (heartbeatMs / 1000) : 0

  return {
    fleetCapacity,
    connectionsHeld,
    connectionsRefused,
    utilization,
    requiredInstances,
    heartbeatRps,
    saturated: offered > fleetCapacity
  }
}
