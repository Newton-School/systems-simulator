import {
  HTTP_METHODS,
  inferHttpMethodFromRequestType,
  type HttpMethod
} from '../../../../engine/core/requestSemantics'
import type { WorkloadProfile } from '../../../../engine/core/types'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select } from '../ui/Select'

type RequestDistributionEntry = WorkloadProfile['requestDistribution'][number]

type EditableMetadataField = 'method' | 'host' | 'path'

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function cloneMetadata(entry: RequestDistributionEntry): Record<string, unknown> {
  return entry.metadata && typeof entry.metadata === 'object' ? { ...entry.metadata } : {}
}

function readMetadataField(entry: RequestDistributionEntry, field: EditableMetadataField): string {
  if (field === 'method') {
    return (
      asNonEmptyString(entry.metadata?.method)?.toUpperCase() ??
      inferHttpMethodFromRequestType(entry.type) ??
      ''
    )
  }

  return asNonEmptyString(entry.metadata?.[field]) ?? ''
}

function writeMetadataField(
  entry: RequestDistributionEntry,
  field: EditableMetadataField,
  rawValue: string
): RequestDistributionEntry {
  const metadata = cloneMetadata(entry)
  const normalized =
    field === 'method' ? asNonEmptyString(rawValue)?.toUpperCase() : asNonEmptyString(rawValue)

  if (normalized) {
    metadata[field] = normalized
  } else {
    delete metadata[field]
  }

  return {
    ...entry,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}

type KeyspaceConfig = NonNullable<RequestDistributionEntry['keyspace']>

function writeKeyspace(
  entry: RequestDistributionEntry,
  patch: Partial<{ field: string; size: number; skew: number }>
): RequestDistributionEntry {
  const current = entry.keyspace
  const field = patch.field !== undefined ? patch.field : (current?.field ?? '')
  const size = patch.size !== undefined ? patch.size : (current?.size ?? 0)
  const skew = patch.skew !== undefined ? patch.skew : current?.skew

  const trimmedField = field.trim()
  // A keyspace only exists once it has a field and a positive size.
  if (trimmedField.length === 0 || !Number.isFinite(size) || size <= 0) {
    const { keyspace: _drop, ...rest } = entry
    void _drop
    return rest
  }

  const keyspace: KeyspaceConfig = { field: trimmedField, size: Math.floor(size) }
  if (typeof skew === 'number' && Number.isFinite(skew) && skew > 0) {
    keyspace.skew = skew
  }
  return { ...entry, keyspace }
}

// Headers live under metadata.headers as a flat string map.
function readHeaders(entry: RequestDistributionEntry): [string, string][] {
  const headers = entry.metadata?.headers
  if (!headers || typeof headers !== 'object') return []
  return Object.entries(headers as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
}

function writeHeaders(
  entry: RequestDistributionEntry,
  headers: [string, string][]
): RequestDistributionEntry {
  const metadata = cloneMetadata(entry)
  const map: Record<string, string> = {}
  for (const [k, v] of headers) {
    const name = k.trim()
    if (name.length > 0) map[name] = v
  }
  if (Object.keys(map).length > 0) {
    metadata.headers = map
  } else {
    delete metadata.headers
  }
  return {
    ...entry,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}

interface RequestDistributionEditorProps {
  entries: RequestDistributionEntry[]
  onChange: (entries: RequestDistributionEntry[]) => void
}

export const RequestDistributionEditor = ({
  entries,
  onChange
}: RequestDistributionEditorProps) => {
  const totalWeightPct = entries.reduce((sum, entry) => sum + entry.weight * 100, 0)

  const updateEntry = (index: number, nextEntry: RequestDistributionEntry) => {
    onChange(entries.map((entry, currentIndex) => (currentIndex === index ? nextEntry : entry)))
  }

  const updateField = <K extends keyof RequestDistributionEntry>(
    index: number,
    field: K,
    value: RequestDistributionEntry[K]
  ) => {
    updateEntry(index, {
      ...entries[index],
      [field]: value
    })
  }

  const updateMetadataField = (index: number, field: EditableMetadataField, value: string) => {
    updateEntry(index, writeMetadataField(entries[index], field, value))
  }

  const updateKeyspace = (
    index: number,
    patch: Partial<{ field: string; size: number; skew: number }>
  ) => {
    updateEntry(index, writeKeyspace(entries[index], patch))
  }

  const updateHeaders = (index: number, headers: [string, string][]) => {
    updateEntry(index, writeHeaders(entries[index], headers))
  }

  const addEntry = () => {
    onChange([
      ...entries,
      {
        type: `request-${entries.length + 1}`,
        weight: 0,
        sizeBytes: 1024
      }
    ])
  }

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, currentIndex) => currentIndex !== index))
  }

  return (
    <div className="mb-5" data-field-path="source.requestDistribution">
      <Label>Requests</Label>
      <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">
        Each entry is a request template. Type is the transport-agnostic request class the simulator
        routes and grades on (e.g. create, resolve, send, op). Method, host, and path are optional
        HTTP routing hints for content-aware routers &mdash; leave them blank for non-HTTP frames
        (WebSocket, gRPC). The connection transport is set on the edge, not here.
      </p>

      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div
            key={index}
            className="space-y-2 rounded border border-nss-border bg-nss-surface p-3"
          >
            <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_7rem_8rem_auto]">
              <Input
                type="text"
                value={entry.type}
                placeholder="e.g. create-order"
                onChange={(event) => updateField(index, 'type', event.target.value)}
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
                  const parsed = Number(event.target.value)
                  updateField(index, 'weight', Number.isFinite(parsed) ? parsed / 100 : 0)
                }}
              />
              <Input
                type="number"
                min={1}
                step={1}
                value={entry.sizeBytes}
                rightElement="B"
                className="pr-8"
                onChange={(event) => {
                  const parsed = Number(event.target.value)
                  updateField(index, 'sizeBytes', Number.isFinite(parsed) ? parsed : 1024)
                }}
              />
              <button
                type="button"
                onClick={() => removeEntry(index)}
                aria-label={`Remove request template ${index + 1}`}
                className="shrink-0 rounded border border-nss-border px-2 py-2 text-xs text-nss-muted transition-colors hover:border-nss-danger hover:text-nss-danger"
              >
                ✕
              </button>
            </div>

            <div className="grid gap-2 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.2fr)]">
              <Select
                value={readMetadataField(entry, 'method')}
                onChange={(event) =>
                  updateMetadataField(index, 'method', event.target.value as HttpMethod | '')
                }
              >
                <option value="">Method</option>
                {HTTP_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </Select>
              <Input
                type="text"
                value={readMetadataField(entry, 'host')}
                placeholder="Host, e.g. api.internal"
                onChange={(event) => updateMetadataField(index, 'host', event.target.value)}
              />
              <Input
                type="text"
                value={readMetadataField(entry, 'path')}
                placeholder="Path, e.g. /checkout"
                onChange={(event) => updateMetadataField(index, 'path', event.target.value)}
              />
            </div>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                Keyspace{' '}
                <span className="font-normal normal-case">
                  — drives affinity, sharding, cache & partitioning
                </span>
              </p>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1.2fr)_6rem_6rem]">
                <Input
                  type="text"
                  value={entry.keyspace?.field ?? ''}
                  placeholder="Key field, e.g. sessionId / shardKey"
                  onChange={(event) => updateKeyspace(index, { field: event.target.value })}
                />
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={entry.keyspace?.size ?? ''}
                  placeholder="# keys"
                  onChange={(event) => updateKeyspace(index, { size: Number(event.target.value) })}
                />
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={entry.keyspace?.skew ?? ''}
                  placeholder="skew (0=uniform)"
                  onChange={(event) => updateKeyspace(index, { skew: Number(event.target.value) })}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-nss-muted">
                  Headers{' '}
                  <span className="font-normal normal-case">— for header-based routing</span>
                </p>
                <button
                  type="button"
                  onClick={() => updateHeaders(index, [...readHeaders(entry), ['', '']])}
                  className="rounded border border-dashed border-nss-border px-2 py-0.5 text-[10px] font-semibold text-nss-muted transition-colors hover:border-nss-primary hover:text-nss-primary"
                >
                  + Header
                </button>
              </div>
              <div className="space-y-1.5">
                {readHeaders(entry).map((header, headerIndex) => (
                  <div
                    key={headerIndex}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5"
                  >
                    <Input
                      type="text"
                      value={header[0]}
                      placeholder="Name, e.g. X-Api-Version"
                      onChange={(event) => {
                        const next = readHeaders(entry)
                        next[headerIndex] = [event.target.value, next[headerIndex][1]]
                        updateHeaders(index, next)
                      }}
                    />
                    <Input
                      type="text"
                      value={header[1]}
                      placeholder="Value, e.g. 2"
                      onChange={(event) => {
                        const next = readHeaders(entry)
                        next[headerIndex] = [next[headerIndex][0], event.target.value]
                        updateHeaders(index, next)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateHeaders(
                          index,
                          readHeaders(entry).filter((_, i) => i !== headerIndex)
                        )
                      }
                      aria-label="Remove header"
                      className="shrink-0 rounded border border-nss-border px-2 text-xs text-nss-muted transition-colors hover:border-nss-danger hover:text-nss-danger"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addEntry}
          className="rounded border border-dashed border-nss-border px-3 py-1.5 text-[11px] font-semibold text-nss-muted transition-colors hover:border-nss-primary hover:text-nss-primary"
        >
          + Add request
        </button>
        <div
          className={[
            'text-[10px] font-semibold tabular-nums',
            Math.abs(totalWeightPct - 100) < 0.01 ? 'text-nss-muted' : 'text-nss-warning'
          ].join(' ')}
        >
          Total weight {totalWeightPct.toFixed(1)}%
        </div>
      </div>
    </div>
  )
}
