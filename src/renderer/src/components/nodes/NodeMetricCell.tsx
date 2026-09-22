import { TooltipInfo } from '@renderer/components/ui/Tooltip'

export function NodeMetricCell({
  label,
  value,
  tone = 'text-nss-text',
  tooltip,
  title
}: {
  label: string
  value: string
  tone?: string
  tooltip?: string
  /** Full, unabbreviated value shown on hover when `value` is a compact form. */
  title?: string
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1">
        <div className="text-[9px] text-nss-muted uppercase tracking-wide font-semibold leading-tight">
          {label}
        </div>
        {tooltip ? (
          <TooltipInfo
            label={`Explain ${label}`}
            content={tooltip}
            width={220}
            className="h-3 w-3 text-[8px]"
          />
        ) : null}
      </div>
      <div
        className={`mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] leading-tight tabular-nums ${tone}`}
        title={title ?? value}
      >
        {value}
      </div>
    </div>
  )
}
