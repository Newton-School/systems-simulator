import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'

export interface WindowedListHandle {
  /** Scroll so row `index` is visible (no-op when it already is). */
  scrollToIndex: (index: number) => void
}

interface WindowedListProps {
  count: number
  /** Fixed row height in px; every row must render at exactly this height. */
  rowHeight: number
  /** Viewport cap in px; shorter lists shrink to fit. */
  maxHeight: number
  overscan?: number
  renderRow: (index: number) => ReactNode
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  ariaLabel?: string
  className?: string
}

/**
 * Fixed-row-height windowing: only the rows inside the viewport (plus overscan)
 * are mounted, so a 25k-row event log costs ~30 DOM rows. No dependency - the
 * tray's lists all have uniform rows.
 */
export const WindowedList = forwardRef<WindowedListHandle, WindowedListProps>(function WindowedList(
  { count, rowHeight, maxHeight, overscan = 8, renderRow, onKeyDown, ariaLabel, className },
  ref
) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const height = Math.min(maxHeight, Math.max(rowHeight, count * rowHeight))

  const scrollToIndex = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const top = index * rowHeight
      if (top < scroller.scrollTop) scroller.scrollTop = top
      else if (top + rowHeight > scroller.scrollTop + height)
        scroller.scrollTop = top + rowHeight - height
      setScrollTop(scroller.scrollTop)
    },
    [height, rowHeight]
  )
  useImperativeHandle(ref, () => ({ scrollToIndex }), [scrollToIndex])

  // Clamp in case the list shrank (a new filter) while scrolled down.
  const maxScroll = Math.max(0, count * rowHeight - height)
  const effectiveTop = Math.min(scrollTop, maxScroll)
  const first = Math.max(0, Math.floor(effectiveTop / rowHeight) - overscan)
  const last = Math.min(count, Math.ceil((effectiveTop + height) / rowHeight) + overscan)
  const rows: ReactNode[] = []
  for (let index = first; index < last; index++) rows.push(renderRow(index))

  return (
    <div
      ref={scrollerRef}
      role="list"
      aria-label={ariaLabel}
      tabIndex={onKeyDown ? 0 : undefined}
      onKeyDown={onKeyDown}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className={`overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-nss-primary/50 ${className ?? ''}`}
      style={{ height }}
    >
      <div style={{ height: count * rowHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${first * rowHeight}px)` }}>{rows}</div>
      </div>
    </div>
  )
})
