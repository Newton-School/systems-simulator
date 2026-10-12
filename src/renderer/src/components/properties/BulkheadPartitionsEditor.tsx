import { useMemo, useState } from 'react'
import useStore from '@renderer/store/useStore'
import type { AnyNodeData } from '@renderer/types/ui'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import {
  newRowKey,
  parsePartitionLimit,
  partitionsFromRows,
  rowsFromWeights,
  type WeightRow
} from './queueWeights'

interface BulkheadPartitionsEditorProps {
  nodeId: string
  partitions: Record<string, number> | undefined
  /** When set, compartments are metadata values, so request types are not suggested. */
  keyField: string | undefined
  onChange: (partitions: Record<string, number> | undefined) => void
}

export function BulkheadPartitionsEditor({
  nodeId,
  partitions,
  keyField,
  onChange
}: BulkheadPartitionsEditorProps) {
  // Rows live locally so a half-typed row survives re-renders; only valid rows are written.
  const [rows, setRows] = useState<WeightRow[]>(() => rowsFromWeights(partitions))

  const nodes = useStore((state) => state.nodes)
  const knownTypes = useMemo(() => {
    if (keyField?.trim()) return []
    const types = new Set<string>()
    for (const node of nodes) {
      const distribution = (node.data as Partial<AnyNodeData>).source?.requestDistribution
      if (!Array.isArray(distribution)) continue
      for (const entry of distribution) {
        if (typeof entry?.type === 'string' && entry.type.trim()) types.add(entry.type.trim())
      }
    }
    return [...types].sort()
  }, [nodes, keyField])

  const commit = (nextRows: WeightRow[]) => {
    setRows(nextRows)
    onChange(partitionsFromRows(nextRows))
  }

  const update = (key: number, patch: Partial<WeightRow>) =>
    commit(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const add = () => {
    const used = new Set(rows.map((row) => row.type.trim()))
    const suggestion = knownTypes.find((type) => !used.has(type)) ?? ''
    commit([...rows, { key: newRowKey(), type: suggestion, weight: '1' }])
  }

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    const name = row.type.trim()
    if (name) acc[name] = (acc[name] ?? 0) + 1
    return acc
  }, {})
  const datalistId = `bulkhead-compartments-${nodeId}`
  const compartmentLabel = keyField?.trim() ? `${keyField.trim()} value` : 'Request type'

  return (
    <div className="mb-5" data-field-path="sim.bulkheadPartitions">
      <Label>Compartment caps</Label>
      <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">
        Each compartment may hold at most its cap of this node&apos;s requests at once, queued plus
        in service. Give the slow one a small cap so it cannot take every worker.
      </p>

      <datalist id={datalistId}>
        {knownTypes.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      <div className="space-y-2">
        {rows.map((row) => {
          const name = row.type.trim()
          const invalid = parsePartitionLimit(row.weight) === null
          const duplicate = name !== '' && (counts[name] ?? 0) > 1
          return (
            <div key={row.key}>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] gap-2">
                <Input
                  type="text"
                  value={row.type}
                  placeholder={compartmentLabel}
                  list={datalistId}
                  aria-label={compartmentLabel}
                  onChange={(event) => update(row.key, { type: event.target.value })}
                />
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={row.weight}
                  aria-label={`Cap for ${name || 'new compartment'}`}
                  aria-invalid={invalid}
                  onChange={(event) => update(row.key, { weight: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`Remove cap for ${name || 'new compartment'}`}
                  onClick={() => commit(rows.filter((current) => current.key !== row.key))}
                  className="rounded border border-nss-border px-2 text-xs text-nss-muted hover:border-nss-danger hover:text-nss-danger"
                >
                  ✕
                </button>
              </div>
              {(invalid || duplicate) && (
                <p className="mt-1 text-[10px] text-nss-warning">
                  {invalid
                    ? 'Cap must be a whole number of at least 1 - this row is ignored.'
                    : 'Compartment listed twice - the last cap is used.'}
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
        + Add compartment
      </button>
    </div>
  )
}
