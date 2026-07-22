import type { FocusEvent, MouseEvent, ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { clsx } from 'clsx'

interface TooltipPosition {
  top: number
  left: number
}

export interface TooltipTriggerProps {
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void
  onMouseLeave: () => void
  onMouseDown: () => void
  onDragStart: () => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onBlur: () => void
  'aria-describedby'?: string
}

interface HoverTooltipProps {
  children: (triggerProps: TooltipTriggerProps) => ReactNode
  content: ReactNode
  delayMs?: number
  width?: number
  offset?: number
  estimatedHeight?: number
  className?: string
}

export function HoverTooltip({
  children,
  content,
  delayMs = 350,
  width = 260,
  offset = 8,
  estimatedHeight = 180,
  className
}: HoverTooltipProps) {
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const tooltipId = useId()
  const showTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  const clearShowTimer = () => {
    if (showTimer.current) {
      window.clearTimeout(showTimer.current)
      showTimer.current = null
    }
  }

  const hide = () => {
    clearShowTimer()
    setPosition(null)
  }

  const scheduleShowFromElement = (element: HTMLElement) => {
    clearShowTimer()

    const rect = element.getBoundingClientRect()
    const nextLeft = Math.min(rect.right + offset, window.innerWidth - width - offset)
    const nextTop = Math.min(rect.top - 4, window.innerHeight - estimatedHeight)
    const nextPosition = {
      top: Math.max(offset, nextTop),
      left: Math.max(offset, nextLeft)
    }

    showTimer.current = window.setTimeout(() => {
      setPosition(nextPosition)
      showTimer.current = null
    }, delayMs)
  }

  const scheduleShow = (event: MouseEvent<HTMLElement>) => {
    scheduleShowFromElement(event.currentTarget)
  }

  const scheduleShowOnFocus = (event: FocusEvent<HTMLElement>) => {
    scheduleShowFromElement(event.currentTarget)
  }

  useEffect(() => clearShowTimer, [])

  return (
    <>
      {children({
        onMouseEnter: scheduleShow,
        onMouseLeave: hide,
        onMouseDown: hide,
        onDragStart: hide,
        onFocus: scheduleShowOnFocus,
        onBlur: hide,
        'aria-describedby': position ? tooltipId : undefined
      })}

      {position && (
        <div
          id={tooltipId}
          role="tooltip"
          style={{ top: position.top, left: position.left, width }}
          className={clsx(
            'fixed z-[80] rounded-md border border-nss-border bg-nss-panel shadow-2xl p-3 text-left pointer-events-none',
            className
          )}
        >
          {content}
        </div>
      )}
    </>
  )
}

interface TooltipInfoProps {
  label: string
  content: ReactNode
  width?: number
  className?: string
}

export function TooltipInfo({ label, content, width = 260, className }: TooltipInfoProps) {
  return (
    <HoverTooltip content={content} width={width}>
      {(triggerProps) => (
        <button
          type="button"
          aria-label={label}
          className={clsx(
            'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-nss-border text-[9px] font-semibold leading-none text-nss-muted transition-colors hover:text-nss-text focus:outline-none focus:ring-2 focus:ring-nss-primary/50 focus:ring-offset-1 focus:ring-offset-nss-surface',
            className
          )}
          {...triggerProps}
        >
          i
        </button>
      )}
    </HoverTooltip>
  )
}
