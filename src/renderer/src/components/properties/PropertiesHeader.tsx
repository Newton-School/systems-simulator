import type { ReactNode } from 'react'
import type { AnyNodeData } from '@renderer/types/ui'
import { resolveNodeConfig } from '@renderer/config/nodeRegistry'
import { HEALTH_META, getHealthPreset, normalizeErrorRate } from './nodeHealth'

interface PropertiesHeaderProps {
  data: AnyNodeData
  leadingAction?: ReactNode
}

export const PropertiesHeader = ({ data, leadingAction }: PropertiesHeaderProps) => {
  const { icon: Icon, theme, label, subLabel } = resolveNodeConfig(data.templateId || data.iconKey)
  const isOverloaded = data.ui?.overloadPreview
  const safeColor = theme.bg || 'bg-nss-primary'
  const healthPreset = getHealthPreset(normalizeErrorRate(data.sim?.nodeErrorRate))
  const healthMeta = HEALTH_META[healthPreset]

  return (
    <div className="p-5 border-b border-nss-border bg-nss-panel">
      <div className="flex items-center gap-4">
        {leadingAction}
        <div
          className={`
          shrink-0 transition-all duration-300 rounded-lg p-2 shadow-sm
          ${
            isOverloaded
              ? 'bg-nss-danger/10 border-nss-danger/30 text-nss-danger ring-1 ring-nss-danger/30'
              : `p-1.5 rounded bg-opacity-40 ${safeColor} shrink-0 flex items-center justify-center`
          }
        `}
        >
          <Icon size={24} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2
              className={`min-w-0 font-semibold text-sm leading-tight truncate ${isOverloaded ? 'text-nss-danger' : 'text-nss-text'}`}
            >
              {data.label || label}
            </h2>
            <span
              className={`shrink-0 inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${healthMeta.className}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${healthMeta.dotClassName}`} />
              {healthMeta.label}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] text-nss-muted uppercase truncate">
              {data.subLabel || subLabel}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-nss-border bg-nss-surface text-nss-muted uppercase tracking-wide">
              {data.profile}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
