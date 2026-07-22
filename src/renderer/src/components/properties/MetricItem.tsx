import { clsx } from 'clsx'

interface MetricItemProps {
  label: string
  value?: string | number
  unit?: string
  textColor?: string
}

export const MetricItem = ({
  label,
  value,
  unit,
  textColor = 'text-nss-text'
}: MetricItemProps) => {
  // LOGIC: Explicitly check for null/undefined so that '0' (zero) is still rendered
  if (value === undefined || value === null) return null

  return (
    <div>
      {/* Label: Uses nss-muted for secondary text */}
      <div className="text-[10px] text-nss-muted uppercase tracking-wider font-semibold">
        {label}
      </div>

      {/* Value: Uses custom textColor (defaulting to nss-text) */}
      <div className={clsx('text-lg truncate tabular-nums', textColor)}>
        {value}
        {unit && <span className={clsx('text-xs ml-0.5', textColor)}>{unit}</span>}
      </div>
    </div>
  )
}
