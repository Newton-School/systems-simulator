import { memo } from 'react'
import { Cloud, Lock, LucideIcon } from 'lucide-react'
import { InlineEditableLabel } from '@renderer/components/properties/InlineEditable'
interface VpcHeaderProps {
  label: string
  isSuccessState: boolean
  icon?: LucideIcon
  onLabelChange?: (newLabel: string) => void
  children?: React.ReactNode
}

export const VpcHeader = memo(
  ({ label, isSuccessState, icon: Icon = Cloud, onLabelChange, children }: VpcHeaderProps) => {
    return (
      <div
        className={`
      absolute top-0 left-0 right-0 px-4 py-2 border-b border-dashed flex items-start gap-2
      ${isSuccessState ? 'border-[rgb(var(--nss-success))]/30' : 'border-[var(--nss-vpc-border)]'}
        `}
      >
        <div className="p-1 rounded bg-nss-surface border border-nss-border shrink-0">
          <Icon
            size={14}
            className={isSuccessState ? 'text-[rgb(var(--nss-success))]' : 'text-nss-primary'}
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          {onLabelChange ? (
            <InlineEditableLabel
              value={label || 'VPC Region'}
              onSave={(newLabel) => onLabelChange(newLabel)}
              wrapLines={2}
              textClassName="min-w-0 w-full text-xs font-bold text-nss-muted uppercase tracking-wider"
              inputClassName="text-xs font-bold text-nss-text uppercase tracking-wider w-full min-w-[100px]"
            />
          ) : (
            <span
              style={{
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden'
              }}
              className="min-w-0 break-words text-xs font-bold text-nss-muted uppercase tracking-wider leading-tight"
            >
              {label || 'VPC Region'}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {!isSuccessState && (
            <div title="Grouped" className="flex items-center">
              <Lock size={12} className="text-nss-muted opacity-50" />
            </div>
          )}

          {children}
        </div>
      </div>
    )
  }
)

VpcHeader.displayName = 'VpcHeader'
