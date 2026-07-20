import { useEffect, useMemo, useState } from 'react'
import type { AnyNodeData } from '@renderer/types/ui'
import type { RoutingStrategy } from '../../../../engine/catalog/nodeSpecTypes'
import {
  getNodeConfigSections,
  type FieldPath,
  type ResolvedFieldDefinition
} from '@renderer/config/fieldConfig'
import useStore from '@renderer/store/useStore'
import {
  isSourceWorkloadFieldPath,
  resolveEffectiveSelectedSourceNodeId,
  updateWorkloadOverrideForField,
  useEffectiveSourceWorkload,
  withDisplayedSourceWorkload
} from '@renderer/hooks/useEffectiveSourceWorkload'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { Select } from '../ui/Select'
import { FormField } from './FormField'
import { RoutingRulesEditor } from './RoutingRulesEditor'
import type { ContentRoutingRule } from '../../../../engine/traits/contentRouting'
import {
  HEALTH_PRESET_ERROR_RATE,
  clamp,
  formatErrorRatePercent,
  getHealthPreset,
  normalizeErrorRate,
  type HealthPreset
} from './nodeHealth'

interface PropertiesFormProps {
  nodeId: string
  data: AnyNodeData
  onUpdate: (path: FieldPath, value: unknown) => void
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

const ROUTING_STRATEGIES = new Set<RoutingStrategy>([
  'passthrough',
  'round-robin',
  'random',
  'weighted',
  'least-conn',
  'broadcast',
  'conditional'
])

function getRoutingStrategy(data: AnyNodeData): RoutingStrategy {
  return data.routingStrategy && ROUTING_STRATEGIES.has(data.routingStrategy)
    ? data.routingStrategy
    : 'passthrough'
}

function NodeHealthField({
  label,
  why,
  value,
  onChange
}: {
  label: string
  why?: string
  value: unknown
  onChange: (value: unknown) => void
}) {
  const errorRate = normalizeErrorRate(value)
  const preset = getHealthPreset(errorRate)

  return (
    <div className="mb-5" data-field-path="sim.nodeErrorRate">
      <Label>{label}</Label>
      {why && <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">{why}</p>}

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

export const PropertiesForm = ({ nodeId, data, onUpdate }: PropertiesFormProps) => {
  const effectiveSourceWorkload = useEffectiveSourceWorkload(nodeId, data)
  const effectiveSelectedSourceNodeId = useStore((state) =>
    resolveEffectiveSelectedSourceNodeId(
      state.nodes as { id: string; data: Pick<AnyNodeData, 'profile'> }[],
      state.scenario.selectedSourceNodeId
    )
  )
  const routingVisualization = useStore((state) => state.routingStrategyVisualization)
  const setRoutingStrategyVisualization = useStore((state) => state.setRoutingStrategyVisualization)
  const updateScenario = useStore((state) => state.updateScenario)
  const isScenarioManagedSourceNode =
    data.profile === 'source' && nodeId === effectiveSelectedSourceNodeId
  const formData = useMemo(
    () =>
      isScenarioManagedSourceNode
        ? withDisplayedSourceWorkload(data, effectiveSourceWorkload)
        : data,
    [data, effectiveSourceWorkload, isScenarioManagedSourceNode]
  )
  const sections = getNodeConfigSections(formData)
  const routingStrategy = getRoutingStrategy(data)
  const isRoutingVisualizationActive = routingVisualization?.sourceNodeId === nodeId
  const [expandedOptionalFields, setExpandedOptionalFields] = useState<Set<FieldPath>>(new Set())

  useEffect(() => {
    if (!isRoutingVisualizationActive) return
    setRoutingStrategyVisualization({
      sourceNodeId: nodeId,
      sourceLabel: data.label,
      strategy: routingStrategy
    })
  }, [
    data.label,
    isRoutingVisualizationActive,
    nodeId,
    routingStrategy,
    setRoutingStrategyVisualization
  ])

  useEffect(() => {
    setExpandedOptionalFields(new Set())
  }, [nodeId])

  const toggleRoutingVisualization = () => {
    if (isRoutingVisualizationActive) {
      setRoutingStrategyVisualization(null)
      return
    }

    setRoutingStrategyVisualization({
      sourceNodeId: nodeId,
      sourceLabel: data.label,
      strategy: routingStrategy
    })
  }

  const expandOptionalField = (path: FieldPath) => {
    setExpandedOptionalFields((current) => new Set(current).add(path))
  }

  const collapseOptionalField = (path: FieldPath) => {
    setExpandedOptionalFields((current) => {
      const next = new Set(current)
      next.delete(path)
      return next
    })
  }

  const renderField = (field: ResolvedFieldDefinition) => {
    const value = getPathValue(formData, field.path)
    const isOptionalHidden =
      field.optional && value === undefined && !expandedOptionalFields.has(field.path)

    if (isOptionalHidden) {
      return (
        <button
          key={field.path}
          type="button"
          onClick={() => expandOptionalField(field.path)}
          className="mb-3 rounded border border-dashed border-nss-border px-3 py-2 text-left text-[11px] font-semibold text-nss-muted transition-colors hover:border-nss-primary hover:text-nss-primary"
        >
          + Add {field.label.toLowerCase()}
        </button>
      )
    }

    const controlRight = [
      field.path === 'routingStrategy' ? (
        <button
          key="routing-visualization"
          type="button"
          onClick={toggleRoutingVisualization}
          className={[
            'shrink-0 rounded border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
            isRoutingVisualizationActive
              ? 'border-nss-primary bg-nss-primary text-white'
              : 'border-nss-border bg-nss-panel text-nss-text hover:border-nss-primary'
          ].join(' ')}
        >
          {isRoutingVisualizationActive ? 'Preview on' : 'Show visualization'}
        </button>
      ) : null,
      field.optional ? (
        <button
          key="clear-optional"
          type="button"
          onClick={() => {
            collapseOptionalField(field.path)
            onUpdate(field.path, undefined)
          }}
          className="shrink-0 rounded border border-nss-border px-2.5 py-1.5 text-[11px] font-semibold text-nss-muted transition-colors hover:border-nss-danger hover:text-nss-danger"
        >
          Clear
        </button>
      ) : null
    ].filter(Boolean)

    if (field.renderer === 'health-preset') {
      return (
        <NodeHealthField
          key={field.path}
          label={field.label}
          why={field.why}
          value={value}
          onChange={(nextValue) => {
            if (isScenarioManagedSourceNode && isSourceWorkloadFieldPath(field.path)) {
              updateScenario((current) => ({
                ...current,
                workloadOverride: updateWorkloadOverrideForField(
                  current.workloadOverride,
                  field.path,
                  nextValue
                )
              }))
              return
            }
            onUpdate(field.path, nextValue)
          }}
        />
      )
    }

    if (field.renderer === 'routing-rules') {
      const rules = Array.isArray(data.sim?.routingRules)
        ? (data.sim.routingRules as ContentRoutingRule[])
        : []
      return (
        <RoutingRulesEditor
          key={field.path}
          nodeId={nodeId}
          rules={rules}
          onChange={(nextValue) => onUpdate(field.path, nextValue)}
        />
      )
    }

    return (
      <FormField
        key={field.path}
        fieldPath={field.path}
        config={field}
        data={formData}
        value={value}
        onChange={(nextValue) => {
          if (isScenarioManagedSourceNode && isSourceWorkloadFieldPath(field.path)) {
            updateScenario((current) => ({
              ...current,
              workloadOverride: updateWorkloadOverrideForField(
                current.workloadOverride,
                field.path,
                nextValue
              )
            }))
            return
          }

          onUpdate(field.path, nextValue)
        }}
        controlRight={controlRight.length > 0 ? <>{controlRight}</> : undefined}
      />
    )
  }

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
        sections.map((section) => {
          const primaryFields = section.fields.filter((field) => field.altitude === 'primary')
          const advancedFields = section.fields.filter((field) => field.altitude === 'advanced')

          if (primaryFields.length === 0 && advancedFields.length === 0 && !section.note) {
            return null
          }

          return (
            <section key={section.id} className="space-y-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">
                {section.title}
              </h3>
              <div className="rounded-lg border border-nss-border bg-nss-surface px-4 py-3">
                {section.note && (
                  <p
                    className={[
                      'mb-4 rounded-md border px-3 py-2 text-[11px] leading-relaxed',
                      section.note.tone === 'locked'
                        ? 'border-nss-warning/20 bg-nss-warning/10 font-medium text-nss-warning'
                        : 'border-nss-border bg-nss-panel text-nss-muted'
                    ].join(' ')}
                  >
                    {section.note.text}
                  </p>
                )}
                {primaryFields.map((field) => renderField(field))}
                {advancedFields.length > 0 && (
                  <details className="rounded-md border border-dashed border-nss-border px-3 py-2">
                    <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-nss-muted">
                      Advanced
                    </summary>
                    <div className="mt-3">{advancedFields.map((field) => renderField(field))}</div>
                  </details>
                )}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
