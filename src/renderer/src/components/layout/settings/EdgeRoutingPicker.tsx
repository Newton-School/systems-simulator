import { clsx } from 'clsx'
import { EDGE_ROUTING_OPTIONS } from '@renderer/config/edgeRouting'
import type { EdgeRoutingStyle } from '@renderer/types/ui'

interface EdgeRoutingPickerProps {
  value: EdgeRoutingStyle
  onChange: (value: EdgeRoutingStyle) => void
}

export function EdgeRoutingPicker({ value, onChange }: EdgeRoutingPickerProps): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Canvas edge path"
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(88px, 1fr))' }}
    >
      {EDGE_ROUTING_OPTIONS.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option.label}: ${option.description}`}
            title={option.description}
            onClick={() => onChange(option.value)}
            className={clsx(
              'group rounded-md border px-2 py-2 text-left transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-nss-primary/60',
              selected
                ? 'border-nss-primary bg-nss-primary/10 text-nss-primary'
                : 'border-nss-border bg-nss-surface text-nss-muted hover:border-nss-muted/60 hover:text-nss-text'
            )}
          >
            <svg
              viewBox="0 0 72 32"
              aria-hidden="true"
              className="mb-1.5 h-8 w-full overflow-visible"
            >
              <circle cx="7" cy="25" r="2.5" fill="currentColor" />
              <path
                d={option.previewPath}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="65" cy="7" r="2.5" fill="currentColor" />
            </svg>
            <span className="block text-center text-[10px] font-semibold leading-tight">
              {option.shortLabel}
            </span>
          </button>
        )
      })}
    </div>
  )
}
