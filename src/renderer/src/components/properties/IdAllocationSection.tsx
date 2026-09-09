import {
  deriveIdAllocationDistribution,
  idAllocationMeanMs,
  isDecentralizedKind,
  type IdAllocationConfig,
  type IdGeneratorKind
} from '../../../../engine/catalog/idAllocation'

const KIND_OPTIONS: Array<{ id: IdGeneratorKind; label: string; note: string }> = [
  {
    id: 'range-allocator',
    label: 'Range allocator',
    note: 'Hands out blocks of IDs — off the hot path, no contention.'
  },
  {
    id: 'db-sequence',
    label: 'DB sequence',
    note: 'Central DB counter — gap-free, but per-request coordination unless batched.'
  },
  {
    id: 'zookeeper',
    label: 'ZooKeeper sequence',
    note: 'Central coordination service — same tradeoff as a DB sequence.'
  },
  {
    id: 'snowflake',
    label: 'Snowflake',
    note: 'Decentralized: each node generates IDs locally from time + machine id — no coordination.'
  }
]

/**
 * Config for the ID Generator palette node (spec: id-sequence-generator-node.md). The
 * chosen kind + allocation mode DERIVE the node's service-time distribution (via
 * `deriveIdAllocationDistribution`) — a real simulated effect, not documentation.
 */
export function IdAllocationSection({
  idAllocation,
  onChange
}: {
  idAllocation: IdAllocationConfig
  onChange: (next: {
    idAllocation: IdAllocationConfig
    distribution: ReturnType<typeof deriveIdAllocationDistribution>
  }) => void
}): React.JSX.Element {
  const decentralized = isDecentralizedKind(idAllocation.kind)
  const meanMs = idAllocationMeanMs(idAllocation)
  const activeKind = KIND_OPTIONS.find((option) => option.id === idAllocation.kind)

  const emit = (next: IdAllocationConfig): void => {
    onChange({ idAllocation: next, distribution: deriveIdAllocationDistribution(next) })
  }

  return (
    <section className="mb-5 rounded-md border border-nss-border bg-nss-surface/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-nss-text">ID allocation</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-nss-muted">
            The generator kind and allocation mode set this node&apos;s service time — the
            difference that decides whether it bottlenecks under a write spike.
          </p>
        </div>
        <span className="shrink-0 rounded border border-nss-border px-1.5 py-0.5 text-[10px] text-nss-muted">
          ~{meanMs.toFixed(2)}ms/req
        </span>
      </div>

      <label className="mb-2 block text-[11px] text-nss-muted">
        Kind
        <select
          value={idAllocation.kind}
          onChange={(event) =>
            emit({ ...idAllocation, kind: event.target.value as IdGeneratorKind })
          }
          className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {activeKind ? (
        <p className="mb-3 text-[10px] leading-snug text-nss-muted">{activeKind.note}</p>
      ) : null}

      {decentralized ? (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-[10px] leading-snug text-emerald-700 dark:text-emerald-200">
          Snowflake generates IDs locally — no central coordination, so allocation mode does not
          apply and it never contends under load.
        </div>
      ) : (
        <>
          <label className="mb-2 block text-[11px] text-nss-muted">
            Allocation mode
            <select
              value={idAllocation.mode}
              onChange={(event) =>
                emit({ ...idAllocation, mode: event.target.value as IdAllocationConfig['mode'] })
              }
              className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
            >
              <option value="block">Block / range allocation</option>
              <option value="central">Central counter (per request)</option>
            </select>
          </label>
          {idAllocation.mode === 'block' ? (
            <label className="mb-2 block text-[11px] text-nss-muted">
              Block size
              <input
                type="number"
                min={1}
                value={idAllocation.blockSize}
                onChange={(event) =>
                  emit({ ...idAllocation, blockSize: Number(event.target.value) })
                }
                className="mt-1 w-full rounded border border-nss-border bg-nss-input-bg px-2 py-1.5 text-xs text-nss-text"
              />
            </label>
          ) : null}
          <p className="text-[10px] leading-snug text-nss-muted">
            {idAllocation.mode === 'central'
              ? 'Central: every request pays a coordination round-trip, so throughput is capped and p99 spikes under a write burst — the classic bottleneck.'
              : `Block: ~1 request in ${Math.max(1, Math.round(idAllocation.blockSize))} pays coordination; the rest are near-instant local serves, so the allocator stays off the hot path.`}
          </p>
        </>
      )}
    </section>
  )
}
