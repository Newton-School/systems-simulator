/**
 * Small presentational controls shared across settings tabs — a segmented picker,
 * a toggle row, and an optional-number ("unbounded when empty") field. Kept dumb:
 * they render current value + call back on change; the tab owns the state wiring.
 */

export function SettingRow({
  label,
  hint,
  children,
  disabled
}: {
  label: string
  hint?: string
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`flex items-start justify-between gap-4 py-2.5 ${disabled ? 'opacity-50' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-nss-text">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-relaxed text-nss-muted">{hint}</div>}
      </div>
      {/* Right-aligned control cell. Controls hug the panel's right edge; number
          inputs align because their unit suffix is a fixed-width column (below). */}
      <div className="flex shrink-0 justify-end pt-0.5">{children}</div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-nss-border">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? 'bg-nss-primary text-white'
                : 'bg-nss-surface text-nss-muted hover:text-nss-text'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-nss-primary' : 'bg-nss-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-150 ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

/** A number input where an empty value means "unbounded" (returns undefined). */
export function OptionalNumber({
  value,
  onChange,
  placeholder = 'unbounded',
  min = 0,
  step = 1,
  disabled,
  suffix
}: {
  value: number | undefined
  onChange: (value: number | undefined) => void
  placeholder?: string
  min?: number
  step?: number
  disabled?: boolean
  suffix?: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={min}
        step={step}
        disabled={disabled}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.trim()
          if (raw === '') return onChange(undefined)
          const parsed = Number(raw)
          onChange(Number.isFinite(parsed) && parsed >= min ? parsed : undefined)
        }}
        className="w-24 rounded border border-nss-border bg-nss-input-bg px-2 py-1 text-right text-[11px] tabular-nums text-nss-text placeholder-nss-placeholder focus:border-nss-info focus:outline-none focus:ring-1 focus:ring-nss-info"
      />
      {/* Fixed-width unit so the input box lands on the same line across rows. */}
      <span className="w-10 shrink-0 text-left text-[11px] text-nss-muted">{suffix ?? ''}</span>
    </div>
  )
}
