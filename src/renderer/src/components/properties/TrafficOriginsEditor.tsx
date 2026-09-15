import { useMemo } from 'react'
import type { TrafficOrigin } from '../../../../engine/core/types'
import useStore from '@renderer/store/useStore'
import type { AnyNodeData } from '@renderer/types/ui'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select } from '../ui/Select'

interface TrafficOriginsEditorProps {
  entries: TrafficOrigin[]
  onChange: (entries: TrafficOrigin[]) => void
}

function nextOriginId(entries: readonly TrafficOrigin[]): string {
  let suffix = entries.length + 1
  while (entries.some((entry) => entry.id === `origin-${suffix}`)) suffix++
  return `origin-${suffix}`
}

export function TrafficOriginsEditor({ entries, onChange }: TrafficOriginsEditorProps) {
  // Zustand calls selectors while React reads the external-store snapshot. Returning
  // a freshly allocated array from the selector makes every read look like a new
  // snapshot and can trigger an infinite render loop. Subscribe to the stable nodes
  // array, then derive the region options only when that array actually changes.
  const nodes = useStore((state) => state.nodes)
  const regions = useMemo(
    () =>
      nodes.flatMap((node) => {
        const data = node.data as Partial<AnyNodeData>
        if (data.templateId !== 'vpc-region') return []
        return [
          {
            id: node.id,
            label: data.label || data.sim?.locationId || node.id,
            code: data.sim?.locationId
          }
        ]
      }),
    [nodes]
  )
  const totalWeightPct = entries.reduce((sum, entry) => sum + entry.weight * 100, 0)

  const update = (index: number, entry: TrafficOrigin) =>
    onChange(entries.map((current, currentIndex) => (currentIndex === index ? entry : current)))

  const add = () => {
    const region = regions[0]
    onChange([
      ...entries,
      {
        id: nextOriginId(entries),
        label: region?.label ?? `Traffic origin ${entries.length + 1}`,
        weight: entries.length === 0 ? 1 : 0,
        location: region
          ? { kind: 'region', regionId: region.id }
          : { kind: 'coordinates', latitude: 0, longitude: 0 }
      }
    ])
  }

  return (
    <div className="mb-5" data-field-path="source.defaultWorkload.origins">
      <Label>Traffic origins</Label>
      <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">
        Split clients across regions or coordinates. The engine samples this mix per request and
        uses the origin for geo-aware latency and routing. Weights must total 100%.
      </p>

      <div className="space-y-2">
        {entries.map((entry, index) => {
          return (
            <div
              key={entry.id}
              className="space-y-2 rounded border border-nss-border bg-nss-surface p-3"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-2">
                <Input
                  type="text"
                  value={entry.label}
                  placeholder="Origin label"
                  onChange={(event) => update(index, { ...entry, label: event.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={Number((entry.weight * 100).toFixed(3))}
                  rightElement="%"
                  className="pr-8"
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    update(index, { ...entry, weight: Number.isFinite(value) ? value / 100 : 0 })
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove traffic origin ${entry.label}`}
                  onClick={() => onChange(entries.filter((_, current) => current !== index))}
                  className="rounded border border-nss-border px-2 text-xs text-nss-muted hover:border-nss-danger hover:text-nss-danger"
                >
                  ✕
                </button>
              </div>

              <Select
                value={
                  entry.location.kind === 'coordinates' ? '__coordinates' : entry.location.regionId
                }
                onChange={(event) => {
                  const value = event.target.value
                  if (value === '__coordinates') {
                    update(index, {
                      ...entry,
                      location: { kind: 'coordinates', latitude: 0, longitude: 0 }
                    })
                    return
                  }
                  update(index, { ...entry, location: { kind: 'region', regionId: value } })
                }}
              >
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.label}
                    {region.code ? ` (${region.code})` : ''}
                  </option>
                ))}
                <option value="__coordinates">Custom coordinates</option>
              </Select>

              {entry.location.kind === 'coordinates' && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    min={-90}
                    max={90}
                    step={0.0001}
                    value={entry.location.latitude}
                    rightElement="lat"
                    className="pr-9"
                    onChange={(event) =>
                      update(index, {
                        ...entry,
                        location: {
                          kind: 'coordinates',
                          latitude: Number(event.target.value) || 0,
                          longitude:
                            entry.location.kind === 'coordinates' ? entry.location.longitude : 0
                        }
                      })
                    }
                  />
                  <Input
                    type="number"
                    min={-180}
                    max={180}
                    step={0.0001}
                    value={entry.location.longitude}
                    rightElement="lon"
                    className="pr-9"
                    onChange={(event) =>
                      update(index, {
                        ...entry,
                        location: {
                          kind: 'coordinates',
                          latitude:
                            entry.location.kind === 'coordinates' ? entry.location.latitude : 0,
                          longitude: Number(event.target.value) || 0
                        }
                      })
                    }
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={add}
          className="rounded border border-dashed border-nss-border px-3 py-1.5 text-[11px] font-semibold text-nss-muted hover:border-nss-primary hover:text-nss-primary"
        >
          + Add origin
        </button>
        <span
          className={`text-[10px] font-semibold tabular-nums ${Math.abs(totalWeightPct - 100) < 0.01 || entries.length === 0 ? 'text-nss-muted' : 'text-nss-warning'}`}
        >
          {entries.length === 0
            ? 'Uses source placement'
            : `Total weight ${totalWeightPct.toFixed(1)}%`}
        </span>
      </div>
    </div>
  )
}
