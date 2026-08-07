import { clsx } from 'clsx'
import { HoverTooltip } from '@renderer/components/ui/Tooltip'
import type { LensCardData } from './nodePresentation'

const GLYPH_COLOR: Record<LensCardData['tone'], string> = {
  healthy: 'text-nss-success',
  degraded: 'text-nss-warning',
  critical: 'text-nss-danger'
}

interface LensMetricCardProps {
  card: LensCardData
}

/**
 * The C2 "value / limit ✓⚠✕" card body - one number, its limit, and a
 * one-line explainer. Never more than one metric family at a time; full
 * detail lives behind selection instead of on the canvas.
 */
export const LensMetricCard = ({ card }: LensMetricCardProps) => (
  <div>
    <div className="flex items-baseline gap-1.5 tabular-nums">
      <span className="text-lg font-bold text-nss-text">{card.value}</span>
      <span className="text-xs text-nss-muted">{card.limit}</span>
      <HoverTooltip
        content={
          <div className="space-y-1.5">
            <div className={clsx('text-xs font-semibold', GLYPH_COLOR[card.tone])}>
              {card.glyphTooltip.title}
            </div>
            <div className="text-[11px] leading-relaxed text-nss-muted">
              {card.glyphTooltip.detail}
            </div>
          </div>
        }
        width={300}
        estimatedHeight={132}
      >
        {(triggerProps) => (
          <button
            type="button"
            aria-label={card.glyphTooltip.label}
            className={clsx(
              'nodrag nopan ml-auto inline-flex h-5 w-5 self-center items-center justify-center rounded-full border border-transparent text-sm transition-colors hover:border-nss-border hover:bg-nss-panel focus:outline-none focus:ring-2 focus:ring-nss-primary/50 focus:ring-offset-1 focus:ring-offset-nss-surface',
              GLYPH_COLOR[card.tone]
            )}
            {...triggerProps}
          >
            {card.glyph}
          </button>
        )}
      </HoverTooltip>
    </div>
    <div className="mt-1 text-[10px] text-nss-muted truncate" title={card.why}>
      {card.why}
    </div>
  </div>
)
