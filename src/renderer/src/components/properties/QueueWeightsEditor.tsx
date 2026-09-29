import { useMemo, useState } from 'react'
import useStore from '@renderer/store/useStore'
import type { AnyNodeData } from '@renderer/types/ui'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import {
  newRowKey,
  parseWeight,
  rowsFromWeights,
  weightsFromRows,
  type WeightRow
} from './queueWeights'

interface QueueWeightsEditorProps {
  nodeId: string
  weights: Record<string, number> | undefined
  onChange: (weights: Record<string, number> | undefined) => void
}

export function QueueWeightsEditor({ nodeId, weights, onChange }: QueueWeightsEditorProps) {
  // Rows live locally so a half-typed row (no type yet, or "0.") survives re-renders;
  // only valid rows are written to the node.
  const [rows, setRows] = useState<WeightRow[]>(() => rowsFromWeights(weights))

  // Subscribe to the stable nodes array (see TrafficOriginsEditor) and derive the
  // request types the canvas's sources emit, to suggest as flow names.
  const nodes = useStore((state) => state.nodes)
  const knownTypes = useMemo(() => {
    const types = new Set<string>()
    for (const node of nodes) {
      const distribution = (node.data as Partial<AnyNodeData>).source?.requestDistribution
      if (!Array.isArray(distribution)) continue
      for (const entry of distribution) {
        if (typeof entry?.type === 'string' && entry.type.trim()) types.add(entry.type.trim())
      }
    }
    return [...types].sort()
  }, [nodes])

  const commit = (nextRows: WeightRow[]) => {
    setRows(nextRows)
    onChange(weightsFromRows(nextRows))
  }

  const update = (key: number, patch: Partial<WeightRow>) =>
    commit(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const add = () => {
    const used = new Set(rows.map((row) => row.type.trim()))
    const suggestion = knownTypes.find((type) => !used.has(type)) ?? ''
    commit([...rows, { key: newRowKey(), type: suggestion, weight: '1' }])
  }

  const effective = weightsFromRows(rows) ?? {}
  const totalWeight = Object.values(effective).reduce((sum, weight) => sum + weight, 0)
  const typeCounts = rows.reduce<Record<string, number>>((counts, row) => {
    const type = row.type.trim()
    if (type) counts[type] = (counts[type] ?? 0) + 1
    return counts
  }, {})
  const datalistId = `queue-weight-types-${nodeId}`

  return (
    <div className="mb-5" data-field-path="sim.queue.weights">
      <Label>Flow weights</Label>
      <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">
        Each request type is a flow. While flows are waiting, a weight-3 flow starts 3 requests for
        every 1 from a weight-1 flow. Types not listed here weigh 1.
      </p>

      <datalist id={datalistId}>
        {knownTypes.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      <div className="space-y-2">
        {rows.map((row) => {
          const type = row.type.trim()
          const weightInvalid = parseWeight(row.weight) === null
          const duplicate = type !== '' && (typeCounts[type] ?? 0) > 1
          const share =
            !weightInvalid &&
            type &&
            Object.keys(effective).length > 1 &&
            effective[type] !== undefined
              ? (effective[type] / totalWeight) * 100
              : null
          return (
            <div key={row.key}>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] gap-2">
                <Input
                  type="text"
                  value={row.type}
                  placeholder="Request type"
                  list={datalistId}
                  aria-label="Request type"
                  onChange={(event) => update(row.key, { type: event.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={row.weight}
                  aria-label={`Weight for ${type || 'new flow'}`}
                  aria-invalid={weightInvalid}
                  onChange={(event) => update(row.key, { weight: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Remove weight for ${type || 'new flow'}`}
                  onClick={() => commit(rows.filter((current) => current.key !== row.key))}
                  className="rounded border border-nss-border px-2 text-xs text-nss-muted hover:border-nss-danger hover:text-nss-danger"
                >
                  ✕
                </button>
              </div>
              {(weightInvalid || duplicate || share !== null) && (
                <p
                  className={`mt-1 text-[10px] tabular-nums ${weightInvalid || duplicate ? 'text-nss-warning' : 'text-nss-muted'}`}
                >
                  {weightInvalid
                    ? 'Weight must be greater than 0 - this row is ignored.'
                    : duplicate
                      ? 'Type listed twice - the last weight is used.'
                      : `${share!.toFixed(0)}% of starts when only the listed flows are waiting`}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="mt-2 rounded border border-dashed border-nss-border px-3 py-1.5 text-[11px] font-semibold text-nss-muted hover:border-nss-primary hover:text-nss-primary"
      >
        + Add weight
      </button>
    </div>
  )
}
