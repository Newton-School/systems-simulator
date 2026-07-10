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
      <div className="bg-nss-panel p-3 border-b border-nss-border flex justify-between items-center rounded-t-lg">
        <div className="flex items-center gap-3 overflow-hidden">
          <div
            className={`
              p-1.5 rounded flex items-center justify-center shrink-0
              ${safeBg} bg-opacity-30 dark:bg-opacity-30
            `}
          >
            <SafeIcon size={16} className={`${safeText} dark:!text-nss-bg`} />
          </div>

          {onLabelChange ? (
            <InlineEditableLabel
              value={label}
              onSave={(newLabel) => onLabelChange(newLabel)}
              textClassName="font-bold text-sm max-w-[120px]"
              inputClassName="font-bold text-sm w-24"
            />
          ) : (
            <span className="font-bold text-sm max-w-[120px] truncate">{label}</span>
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
