import React from 'react'
import { CatalogItem } from '@renderer/types/ui'
import { HoverTooltip } from '../ui/Tooltip'

interface LibraryItemProps {
  item: CatalogItem
}

function LibraryItemTooltipContent({ item }: LibraryItemProps) {
  const { icon: Icon, label, subLabel, color, info } = item
  const { bg, text } = color

  return (
    <>
      <div className="mb-2 flex items-start gap-2">
        <div
          className={`mt-0.5 h-6 w-6 shrink-0 rounded flex items-center justify-center ${bg} bg-opacity-30`}
        >
          <Icon size={12} className={text} />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-nss-text leading-tight">{label}</div>
          <div className="text-[10px] text-nss-muted leading-tight">{subLabel}</div>
        </div>
      </div>

      <div className="space-y-2 text-[10px] leading-snug">
        <div>
          <div className="font-semibold uppercase tracking-wide text-nss-muted">Represents</div>
          <div className="mt-0.5 text-nss-text">{info.represents}</div>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-wide text-nss-muted">
            Real World Examples
          </div>
          <div className="mt-0.5 text-nss-text">{info.realWorld}</div>
        </div>
        <div>
          <div className="font-semibold uppercase tracking-wide text-nss-muted">Key Config</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {info.config.map((config) => (
              <span
                key={config}
                className="rounded border border-nss-border bg-nss-surface px-1.5 py-0.5 text-nss-muted"
              >
                {config}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

export const LibraryItem = ({ item }: LibraryItemProps) => {
  const { icon: Icon, label, color, type, templateId } = item
  const { bg, text } = color

  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/reactflow/type', type)
    event.dataTransfer.setData('application/reactflow/template-id', templateId)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <HoverTooltip content={<LibraryItemTooltipContent item={item} />}>
      {(triggerProps) => (
        <div
          draggable
          {...triggerProps}
          onDragStart={(event) => {
            if (triggerProps.onDragStart) (triggerProps as any).onDragStart()
            onDragStart(event)
          }}
          className="
            group relative flex flex-col items-center gap-1.5 p-1.5 rounded-lg
            cursor-grab active:cursor-grabbing select-none
            bg-transparent hover:bg-nss-surface
            border border-transparent hover:border-nss-border
            transition-all duration-200
          "
        >
          {/* Icon tile */}
          <div
            className={`
              w-12 h-12 rounded-lg flex items-center justify-center
              ${bg} bg-opacity-30 group-hover:bg-opacity-40
              dark:bg-opacity-30 dark:group-hover:bg-opacity-30 transition-all
            `}
          >
            <Icon size={16} className={`${text} dark:!text-nss-bg`} />
          </div>

          {/* Label */}
          <span className="text-[10px] font-medium text-nss-text text-center leading-tight line-clamp-2 w-full">
            {label}
          </span>
        </div>
      )}
    </HoverTooltip>
  )
}
