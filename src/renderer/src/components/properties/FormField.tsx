import type { ReactNode } from 'react'
import type { AnyNodeData } from '@renderer/types/ui'
import { Label } from '../ui/Label'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import type { FieldPath, ResolvedFieldDefinition } from '@renderer/config/fieldConfig'

interface FormFieldProps {
  fieldPath: FieldPath
  config: ResolvedFieldDefinition
  data: AnyNodeData
  value: unknown
  onChange: (value: unknown) => void
  controlRight?: ReactNode
}

export const FormField = ({
  fieldPath,
  config,
  data,
  value,
  onChange,
  controlRight
}: FormFieldProps) => {
  const transformedValue =
    config.displayAs && value !== undefined ? config.displayAs.toDisplay(value, data) : value

  const normalizedValue = (() => {
    if (transformedValue !== undefined) return transformedValue

    switch (config.type) {
      case 'slider':
        return config.min
      case 'select':
        return config.options[0] ?? ''
      case 'boolean':
        return config.defaultValue ?? false
      case 'input':
      default:
        return ''
    }
  })()

  const renderInput = () => {
    switch (config.type) {
      case 'slider':
        return (
          <Slider
            value={Number(normalizedValue)}
            min={config.min}
            max={config.max}
            unit={config.unit}
            onChange={onChange}
          />
        )

      case 'select':
        return (
          <Select value={String(normalizedValue)} onChange={(e) => onChange(e.target.value)}>
            {config.options?.map((opt: string) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        )

      case 'boolean':
        return (
          <input
            type="checkbox"
            checked={Boolean(normalizedValue)}
            onChange={(e) => onChange(e.target.checked)}
            className="w-3.5 h-3.5 accent-nss-primary"
          />
        )

      case 'input':
      default:
        return (
          <Input
            type="number"
            step={config.step}
            value={normalizedValue as string | number}
            rightElement={config.unit}
            placeholder={config.placeholder}
            onChange={(e) => {
              const val = e.target.value
              if (val === '') {
                onChange(undefined)
                return
              }

              const parsed = Number(val)
              if (Number.isNaN(parsed)) {
                onChange(undefined)
                return
              }

              onChange(config.displayAs ? config.displayAs.fromDisplay(parsed, data) : parsed)
            }}
          />
        )
    }
  }

  if (config.type === 'boolean') {
    return (
      <div className="mb-5 flex items-center justify-between rounded border border-nss-border bg-nss-surface px-3 py-2">
        <div className="min-w-0 pr-3">
          <Label className="mb-0">{config.label}</Label>
          {config.why && (
            <p className="mt-1 text-[10px] leading-relaxed text-nss-muted">{config.why}</p>
          )}
        </div>
        {renderInput()}
      </div>
    )
  }

  return (
    <div className="mb-5" data-field-path={fieldPath}>
      <Label>{config.label}</Label>
      {config.why && (
        <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">{config.why}</p>
      )}
      {controlRight ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{renderInput()}</div>
          {controlRight}
        </div>
      ) : (
        renderInput()
      )}
    </div>
  )
}
