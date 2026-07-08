import type { ReactNode } from 'react'
import { Label } from '../ui/Label'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Slider } from '../ui/Slider'
import type { FieldDefinition, FieldPath } from '@renderer/config/fieldConfig'

interface FormFieldProps {
  fieldPath: FieldPath
  config: FieldDefinition
  value: unknown
  onChange: (value: unknown) => void
  controlRight?: ReactNode
}

export const FormField = ({ fieldPath, config, value, onChange, controlRight }: FormFieldProps) => {
  const normalizedValue = (() => {
    if (value !== undefined) return value

    switch (config.type) {
      case 'slider':
        return config.min
      case 'select':
        return config.options[0] ?? ''
      case 'boolean':
        return false
      case 'input':
      default:
        return 0
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
            type={typeof normalizedValue === 'number' ? 'number' : 'text'}
            step={config.step}
            value={normalizedValue as string | number}
            rightElement={config.unit}
            onChange={(e) => {
              const val = e.target.value
              if (typeof normalizedValue === 'number') {
                const parsed = Number(val)
                onChange(Number.isNaN(parsed) ? 0 : parsed)
                return
              }
              onChange(val)
            }}
          />
        )
    }
  }

  if (config.type === 'boolean') {
    return (
      <div className="mb-5 flex items-center justify-between rounded border border-nss-border bg-nss-surface px-3 py-2">
        <Label className="mb-0">{config.label}</Label>
        {renderInput()}
      </div>
    )
  }

  return (
    <div className="mb-5" data-field-path={fieldPath}>
      <Label>{config.label}</Label>
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
