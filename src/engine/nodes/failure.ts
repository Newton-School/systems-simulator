/**
 * Node failure semantics.
 *
 * A real server failure is usually *silence*: clients keep their connections
 * open and burn their full timeout before erroring, so latency during an outage
 * walls at the timeout rather than dropping. The legacy `reject` behavior — an
 * instant `node_failed` rejection one edge-hop after arrival — only models a TCP
 * RST or an LB-shielded failure. These modes let a scenario pick the realistic
 * shape while keeping `reject` available for backward compatibility.
 */

/** How a failed node treats *newly arriving* requests. */
export type NodeFailureMode =
  | 'reject' // instant node_failed rejection (legacy / TCP RST)
  | 'blackhole' // packets vanish; client burns its timeout, no slot consumed
  | 'hang' // accept backlog fills to K then overflows to blackhole; all wall at the timeout
  | 'degraded' // still serving, only the service-time sampler changes

export interface NodeFailureSpec {
  mode: NodeFailureMode
  /** Fate of queued/in-service requests at failure onset. */
  inFlightPolicy: 'reset' | 'hang'
  /** hang only: fate of still-held requests at recovery. */
  recoveryPolicy: 'resume' | 'reset'
  /** degraded only. */
  degradation?: { fraction: number; serviceTimeMultiplier: number }
}

/**
 * Out-of-the-box chaos injection defaults to a silent dead server: new arrivals
 * are blackholed, in-flight requests hang (their clients keep waiting), and a
 * recovery treats any still-held requests as connection resets (crash-restart
 * loses in-flight state). This makes the default demo show a timeout wall rather
 * than the misleading low "failure latency" of the legacy reject path.
 */
export const DEFAULT_CHAOS_FAILURE_SPEC: NodeFailureSpec = {
  mode: 'blackhole',
  inFlightPolicy: 'hang',
  recoveryPolicy: 'reset'
}

/**
 * Backward-compatible fallback used when a `node-failure` event carries no spec
 * and the node declares none: the historical instant-reject behavior.
 */
export const LEGACY_REJECT_FAILURE_SPEC: NodeFailureSpec = {
  mode: 'reject',
  inFlightPolicy: 'reset',
  recoveryPolicy: 'reset'
}

function isNodeFailureMode(value: unknown): value is NodeFailureMode {
  return value === 'reject' || value === 'blackhole' || value === 'hang' || value === 'degraded'
}

/**
 * Parse a failure spec from loosely-typed input (event payload or node config).
 * Returns null when there is nothing usable, so callers can fall back to a
 * default. Unknown fields are ignored; missing policies get sensible defaults.
 */
export function parseFailureSpec(raw: unknown): NodeFailureSpec | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const record = raw as Record<string, unknown>
  if (!isNodeFailureMode(record.mode)) {
    return null
  }

  const inFlightPolicy = record.inFlightPolicy === 'hang' ? 'hang' : 'reset'
  const recoveryPolicy = record.recoveryPolicy === 'resume' ? 'resume' : 'reset'

  const spec: NodeFailureSpec = { mode: record.mode, inFlightPolicy, recoveryPolicy }

  if (record.mode === 'degraded') {
    const degradation = record.degradation
    if (degradation && typeof degradation === 'object') {
      const d = degradation as Record<string, unknown>
      const fraction =
        typeof d.fraction === 'number' && Number.isFinite(d.fraction)
          ? Math.max(0, Math.min(1, d.fraction))
          : 0
      const serviceTimeMultiplier =
        typeof d.serviceTimeMultiplier === 'number' && Number.isFinite(d.serviceTimeMultiplier)
          ? Math.max(0, d.serviceTimeMultiplier)
          : 1
      spec.degradation = { fraction, serviceTimeMultiplier }
    } else {
      spec.degradation = { fraction: 0, serviceTimeMultiplier: 1 }
    }
  }

  return spec
}
