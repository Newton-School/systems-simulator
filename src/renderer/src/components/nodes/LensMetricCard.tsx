import { clsx } from 'clsx'
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
 * The C2 "value / limit ✓⚠✕" card body — one number, its limit, and a
 * one-line explainer. Never more than one metric family at a time; full
 * detail lives behind selection instead of on the canvas.
 */
export const LensMetricCard = ({ card }: LensMetricCardProps) => (
  <div>
    <div className="flex items-baseline gap-1.5 tabular-nums">
      <span className="text-lg font-bold text-nss-text">{card.value}</span>
      <span className="text-xs text-nss-muted">{card.limit}</span>
      <span className={clsx('ml-auto text-sm', GLYPH_COLOR[card.tone])}>{card.glyph}</span>
    </div>
    <div className="mt-1 text-[10px] text-nss-muted truncate" title={card.why}>
      {card.why}
    </div>
  </div>
)
