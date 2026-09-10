import {
  deriveConnectionCapacity,
  type ConnectionConfig
} from '../../../../engine/catalog/connectionCapacity'

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return `${Math.round(value)}`
}

/**
 * Connection-tier capacity config (spec: connection-tier-capacity.md, GAP 1). Concurrent
 * held connections are a capacity dimension distinct from RPS; the derived readout shows
 * fleet capacity, utilization, refused overflow, and the required fleet size.
 */
export function ConnectionCapacitySection({
  connection,
  instanceCount,
  onChange
}: {
  connection: ConnectionConfig
  instanceCount: number
  onChange: (next: ConnectionConfig) => void
}): React.JSX.Element {
  const derived = deriveConnectionCapacity(connection, instanceCount)
  const utilPct = derived.utilization * 100

  const emit = (patch: Partial<ConnectionConfig>): void => onChange({ ...connection, ...patch })

  return (
    <section className="mb-5 rounded-md border border-nss-border bg-nss-surface/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-nss-text">Connection capacity</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-nss-muted">
            Concurrent held connections — a capacity dimension distinct from request throughput. The
            tier saturates and refuses connections past its ceiling.
          </p>
        </div>
        <span
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            derived.saturated
              ? 'border-nss-danger/50 bg-nss-danger/10 text-nss-danger'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
          }`}
        >
          {utilPct.toFixed(0)}% used
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-nss-muted">
          Max connections / instance
          <input
            type="number"
            min={1}
            value={connection.maxConnectionsPerInstance}
            onChange={(event) => emit({ maxConnectionsPerInstance: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
          />
        </label>
        <label className="text-[10px] text-nss-muted">
          Offered connections
          <input
            type="number"
            min={0}
            value={connection.offeredConnections}
            onChange={(event) => emit({ offeredConnections: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
          />
        </label>
        <label className="text-[10px] text-nss-muted">
          Heartbeat interval ms
          <input
            type="number"
            min={0}
            value={connection.heartbeatIntervalMs ?? 0}
            onChange={(event) => emit({ heartbeatIntervalMs: Number(event.target.value) })}
            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
          />
        </label>
        <label className="text-[10px] text-nss-muted">
          Session protocol
          <select
            value={connection.sessionProtocol ?? 'websocket'}
            onChange={(event) =>
              emit({ sessionProtocol: event.target.value as ConnectionConfig['sessionProtocol'] })
            }
            className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-xs text-nss-text"
          >
            <option value="websocket">WebSocket</option>
            <option value="tcp">TCP</option>
            <option value="http2">HTTP/2</option>
          </select>
        </label>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-nss-border bg-nss-panel p-2 text-[10px]">
        <span className="text-nss-muted">Fleet capacity</span>
        <span className="text-right font-semibold text-nss-text">
          {formatCount(derived.fleetCapacity)} ({instanceCount}×)
        </span>
        <span className="text-nss-muted">Held / refused</span>
        <span className="text-right font-semibold text-nss-text">
          {formatCount(derived.connectionsHeld)} /{' '}
          <span className={derived.connectionsRefused > 0 ? 'text-nss-danger' : ''}>
            {formatCount(derived.connectionsRefused)}
          </span>
        </span>
        <span className="text-nss-muted">Required instances</span>
        <span className="text-right font-semibold text-nss-text">{derived.requiredInstances}</span>
        <span className="text-nss-muted">Heartbeat load</span>
        <span className="text-right font-semibold text-nss-text">
          {formatCount(derived.heartbeatRps)} rps
        </span>
      </div>
      {derived.saturated ? (
        <p className="mt-1 text-[10px] leading-snug text-nss-danger">
          Saturated — offered connections exceed fleet capacity; scale to{' '}
          {derived.requiredInstances} instances or raise per-instance capacity.
        </p>
      ) : null}
    </section>
  )
}
