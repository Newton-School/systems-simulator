import { RequiredIndicator } from './RequiredIndicator'

/** A labelled number input with a unit suffix; empty means null. */
export function DraftNumberInput({
  label,
  suffix,
  value,
  min = 0,
  max,
  required = false,
  placeholder,
  onChange
}: {
  label: string
  suffix: string
  value: number | null | undefined
  min?: number
  max?: number
  required?: boolean
  placeholder?: string
  onChange: (value: number | null) => void
}): React.JSX.Element {
  return (
    <label className="text-[11px] font-semibold text-nss-text">
      {label} {required && <RequiredIndicator />}
      <div className="relative mt-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step="any"
          value={value ?? ''}
          required={required}
          placeholder={placeholder}
          onChange={(event) =>
            onChange(event.currentTarget.value === '' ? null : event.currentTarget.valueAsNumber)
          }
          className="block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 pr-12 text-xs font-normal tabular-nums text-nss-text outline-none placeholder:text-nss-placeholder focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] font-normal text-nss-muted">
          {suffix}
        </span>
      </div>
    </label>
  )
}

export const AUTHORING_SELECT_CLASS =
  'mt-1.5 block w-full rounded-md border border-nss-border bg-nss-input-bg px-2.5 py-2 text-xs font-normal text-nss-text outline-none focus:border-nss-primary focus:ring-2 focus:ring-nss-primary/15'
