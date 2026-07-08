export interface HealthCheckManagerConfig {
  monitoredNodes: string[]
  checkIntervalMs: number
  unhealthyThreshold: number
  healthyThreshold: number
}

export interface ProbeState {
  consecutiveFailures: number
  consecutiveSuccesses: number
  healthy: boolean
}

const DEFAULT_CHECK_INTERVAL_MS = 5_000
const DEFAULT_UNHEALTHY_THRESHOLD = 3
const DEFAULT_HEALTHY_THRESHOLD = 2

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

/**
 * Reads Health Check Manager config off node.config. Returns null when
 * monitoredNodes is missing/empty — a manager with nothing to watch is a
 * no-op, not an error.
 */
export function parseHealthCheckManagerConfig(
  config: Record<string, unknown> | undefined
): HealthCheckManagerConfig | null {
  const rawMonitoredNodes = config?.['monitoredNodes']
  if (!Array.isArray(rawMonitoredNodes)) {
    return null
  }

  const monitoredNodes = rawMonitoredNodes.filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  )
  if (monitoredNodes.length === 0) {
    return null
  }

  return {
    monitoredNodes,
    checkIntervalMs: asPositiveInt(config?.['checkIntervalMs'], DEFAULT_CHECK_INTERVAL_MS),
    unhealthyThreshold: asPositiveInt(
      config?.['unhealthyThreshold'],
      DEFAULT_UNHEALTHY_THRESHOLD
    ),
    healthyThreshold: asPositiveInt(config?.['healthyThreshold'], DEFAULT_HEALTHY_THRESHOLD)
  }
}

/**
 * Health Check Manager assumes a monitored node is healthy until enough
 * failed probes accumulate — mirrors a real prober's optimistic start.
 */
export function createInitialProbeState(): ProbeState {
  return { consecutiveFailures: 0, consecutiveSuccesses: 0, healthy: true }
}

/**
 * Advances probe state by one tick. State only flips once consecutive
 * failures/successes cross their threshold — this is what produces the
 * real-world detection window between an actual failure and the registry
 * reflecting it.
 */
export function evaluateProbe(
  state: ProbeState,
  actualHealthy: boolean,
  config: HealthCheckManagerConfig
): ProbeState {
  if (actualHealthy) {
    const consecutiveSuccesses = state.consecutiveSuccesses + 1
    return {
      consecutiveFailures: 0,
      consecutiveSuccesses,
      healthy: consecutiveSuccesses >= config.healthyThreshold ? true : state.healthy
    }
  }

  const consecutiveFailures = state.consecutiveFailures + 1
  return {
    consecutiveFailures,
    consecutiveSuccesses: 0,
    healthy: consecutiveFailures >= config.unhealthyThreshold ? false : state.healthy
  }
}
