import type { AnyNodeData } from '@renderer/types/ui'
import {
  FIELD_DEFINITIONS,
  PROFILE_FIELD_GROUPS,
  type FieldPath
} from '@renderer/config/fieldConfig'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select } from '../ui/Select'
import { FormField } from './FormField'
import {
  HEALTH_PRESET_ERROR_RATE,
  clamp,
  formatErrorRatePercent,
  getHealthPreset,
  normalizeErrorRate,
  type HealthPreset
} from './nodeHealth'

interface PropertiesFormProps {
  data: AnyNodeData
  onUpdate: (path: FieldPath, value: unknown) => void
}

function getVisibleFieldPaths(data: AnyNodeData, paths: FieldPath[]): FieldPath[] {
  return paths.filter((path) => {
    const config = FIELD_DEFINITIONS[path]
    if (!config) return false
    return config.visible ? config.visible(data) : true
  })
}

function getPathValue(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      return Number.isInteger(index) ? current[index] : undefined
    }
    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, target)
}

function NodeHealthField({
  value,
  onChange
}: {
  value: unknown
  onChange: (value: unknown) => void
}) {
  const errorRate = normalizeErrorRate(value)
  const preset = getHealthPreset(errorRate)

  return (
    <div className="mb-5" data-field-path="sim.nodeErrorRate">
      <Label>Node Health</Label>

      <div className="grid grid-cols-[minmax(0,1fr)_5.75rem] gap-2">
        <Select
          value={preset}
          onChange={(event) => {
            const nextPreset = event.target.value as HealthPreset
            onChange(HEALTH_PRESET_ERROR_RATE[nextPreset])
          }}
        >
          <option value="healthy">Healthy</option>
          <option value="degraded">Degraded</option>
          <option value="critical">Critical</option>
          <option value="down">Down</option>
        </Select>

        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={formatErrorRatePercent(errorRate)}
          rightElement="%"
          className="pr-8"
          onChange={(event) => {
            const parsed = Number(event.target.value)
            onChange(Number.isNaN(parsed) ? 0 : clamp(parsed, 0, 100) / 100)
          }}
        />
      </div>
    </div>
  )
}

export const PropertiesForm = ({ data, onUpdate }: PropertiesFormProps) => {
  const groups = PROFILE_FIELD_GROUPS[data.profile]

  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b border-nss-border pb-6">
        <label className="text-[10px] font-bold text-nss-muted uppercase tracking-wider">
          Node Label
        </label>
        <input
          type="text"
          value={data.label}
          onChange={(event) => onUpdate('label', event.target.value)}
          placeholder="Enter node label"
          className="w-full bg-nss-bg border border-nss-border rounded px-2 py-1.5 text-xs text-nss-text focus:border-nss-primary outline-none transition-colors"
        />
      </div>

      {data.profile === 'composite' ? (
        <div className="rounded-md border border-nss-border bg-nss-surface p-3 text-xs text-nss-muted">
          Composite nodes are canvas containers only. They are not serialized into the simulation
          engine.
        </div>
      ) : (
        Object.entries(groups).map(([groupLabel, paths]) => {
          const visiblePaths = getVisibleFieldPaths(data, paths)
          if (visiblePaths.length === 0) return null

          return (
            <section key={groupLabel} className="space-y-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">
                {groupLabel}
              </h3>
              <div className="rounded-lg border border-nss-border bg-nss-surface px-4 py-3">
                {visiblePaths.map((path) => {
                  const config = FIELD_DEFINITIONS[path]
                  if (!config) return null

                  return (
                    <div key={path}>
                      {path === 'sim.nodeErrorRate' ? (
                        <NodeHealthField
                          value={getPathValue(data, path)}
                          onChange={(value) => onUpdate(path, value)}
                        />
                      ) : (
                        <FormField
                          fieldPath={path}
                          config={config}
                          value={getPathValue(data, path)}
                          onChange={(value) => onUpdate(path, value)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
