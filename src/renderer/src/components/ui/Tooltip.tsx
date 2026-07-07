import type { MouseEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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

  const scheduleShow = (event: MouseEvent<HTMLElement>) => {
    clearShowTimer()

    const rect = event.currentTarget.getBoundingClientRect()
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

  useEffect(() => clearShowTimer, [])

  return (
    <>
      {children({
        onMouseEnter: scheduleShow,
        onMouseLeave: hide,
        onMouseDown: hide,
        onDragStart: hide
      })}

      {position && (
        <div
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
