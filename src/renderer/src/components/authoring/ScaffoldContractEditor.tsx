import { Lock, Play, Unlock } from 'lucide-react'
import type { SimulationVerdict } from '../../../../engine/analysis/verdict'
import type { TopologyJSON } from '../../../../engine/core/types'

export interface ScaffoldContractDraft {
  lockedNodeIds?: string[]
  lockedEdgeIds?: string[]
  baselineVerdict?: SimulationVerdict
}

export function ScaffoldContractEditor({
  topology,
  contract,
  canCaptureBaseline,
  capturingBaseline,
  onChange,
  onCaptureBaseline
}: {
  topology?: TopologyJSON
  contract: ScaffoldContractDraft
  canCaptureBaseline: boolean
  capturingBaseline: boolean
  onChange: (contract: ScaffoldContractDraft) => void
  onCaptureBaseline: () => void
}): React.JSX.Element {
  const lockedNodes = new Set(contract.lockedNodeIds ?? [])
  const lockedEdges = new Set(contract.lockedEdgeIds ?? [])
  const toggle = (kind: 'node' | 'edge', id: string): void => {
    const current = kind === 'node' ? lockedNodes : lockedEdges
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange({
      ...contract,
      ...(kind === 'node' ? { lockedNodeIds: [...next] } : { lockedEdgeIds: [...next] })
    })
  }

  return (
    <section className="rounded-xl border border-nss-border bg-nss-panel p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-nss-text">
            <Lock size={15} className="text-nss-primary" /> Scaffold contract
          </h3>
          <p className="mt-1 text-xs leading-5 text-nss-muted">
            Lock individual elements for guided labs and capture an optimize baseline from the
            current scaffold and first valid scenario.
          </p>
        </div>
        <button
          type="button"
          disabled={!canCaptureBaseline || capturingBaseline}
          onClick={onCaptureBaseline}
          className="flex items-center gap-2 rounded-md border border-nss-border px-3 py-2 text-xs font-semibold text-nss-text hover:border-nss-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={13} />
          {capturingBaseline
            ? 'Running baseline…'
            : contract.baselineVerdict
              ? 'Refresh baseline'
              : 'Capture baseline'}
        </button>
      </div>
      {!topology ? (
        <p className="mt-4 rounded-md border border-dashed border-nss-border p-4 text-center text-[11px] text-nss-muted">
          Draw a scaffold to configure locks or a baseline.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Nodes
            </p>
            <div className="mt-2 space-y-1.5">
              {topology.nodes.map((node) => (
                <label
                  key={node.id}
                  className="flex items-center justify-between rounded border border-nss-border bg-nss-surface px-3 py-2 text-xs text-nss-text"
                >
                  <span className="truncate">
                    {node.label || node.id}
                    <span className="ml-2 font-mono text-[9px] text-nss-muted">{node.id}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={lockedNodes.has(node.id)}
                    onChange={() => toggle('node', node.id)}
                    aria-label={`Lock node ${node.id}`}
                  />
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
              Connections
            </p>
            <div className="mt-2 space-y-1.5">
              {topology.edges.length === 0 ? (
                <p className="rounded border border-dashed border-nss-border px-3 py-3 text-[10px] text-nss-muted">
                  No connections yet.
                </p>
              ) : (
                topology.edges.map((edge) => (
                  <label
                    key={edge.id}
                    className="flex items-center justify-between rounded border border-nss-border bg-nss-surface px-3 py-2 text-xs text-nss-text"
                  >
                    <span className="truncate">
                      {edge.source} → {edge.target}
                    </span>
                    <input
                      type="checkbox"
                      checked={lockedEdges.has(edge.id)}
                      onChange={() => toggle('edge', edge.id)}
                      aria-label={`Lock edge ${edge.id}`}
                    />
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-nss-muted">
        <span className="inline-flex items-center gap-1">
          <Lock size={11} />
          {lockedNodes.size} nodes locked
        </span>
        <span className="inline-flex items-center gap-1">
          <Unlock size={11} />
          {lockedEdges.size} edges locked
        </span>
        {contract.baselineVerdict && (
          <span className="text-nss-success">
            Baseline captured ·{' '}
            {Math.round(contract.baselineVerdict.summary.throughput).toLocaleString()} req/s
          </span>
        )}
      </div>
    </section>
  )
}
