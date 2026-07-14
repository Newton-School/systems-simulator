import { memo } from 'react'
import { LucideIcon, HelpCircle } from 'lucide-react'
import { InlineEditableLabel } from '../properties/InlineEditable'
import { ColorTheme } from '@renderer/types/ui'
import { NODE_HEALTH_STYLES, type NodeHealthStatus } from './nodePresentation'

interface NodeHeaderProps {
  label: string
  icon?: LucideIcon
  status?: NodeHealthStatus
  color?: ColorTheme | string
  onLabelChange?: (newLabel: string) => void
  children?: React.ReactNode
}

export const NodeHeader = memo(
  ({
    label,
    icon: Icon = HelpCircle,
    status = 'healthy',
    color,
    onLabelChange,
    children
  }: NodeHeaderProps) => {
    const safeBg = typeof color === 'string' ? color : color?.bg || 'bg-nss-primary'
    const safeText =
      typeof color === 'string' ? color.replace('bg-', 'text-') : color?.text || 'text-nss-primary'

    const SafeIcon = Icon || HelpCircle

    return (
      <div className="bg-nss-panel p-3 border-b border-nss-border flex items-center justify-between gap-3 rounded-t-lg">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <div
            className={`p-1.5 rounded bg-opacity-50 ${safeBg} shrink-0 flex items-center justify-center`}
          >
            <SafeIcon size={16} className={safeText} />
          </div>

          {onLabelChange ? (
            <InlineEditableLabel
              value={label}
              onSave={(newLabel) => onLabelChange(newLabel)}
              wrapLines={2}
              textClassName="min-w-0 flex-1 w-full font-bold text-sm"
              inputClassName="min-w-0 flex-1 w-full font-bold text-sm"
            />
          ) : (
            <span
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden'
              }}
              className="min-w-0 flex-1 break-words font-bold text-sm leading-tight"
            >
              {label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${NODE_HEALTH_STYLES[status].dot}`}
            title={`Status: ${status}`}
          />
          {children}
        </div>
      </div>
    )
  }
)

NodeHeader.displayName = 'NodeHeader'
