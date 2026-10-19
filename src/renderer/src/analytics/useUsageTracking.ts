import { useEffect, useRef } from 'react'
import { startAnalytics, track, trackOnce } from './analytics'
import type { AnalyticsEventMap } from './events'

export interface UsageTrackingState {
  layout: AnalyticsEventMap['app_opened']['layout']
  /** The canvas has at least one node. */
  hasCanvasNodes: boolean
  /** The simulation's status; a run starts when it becomes 'running'. */
  runStatus: string
  /** The finished run's verdict, once the summary has one. */
  runVerdict: AnalyticsEventMap['run_completed']['verdict'] | undefined
  /** Identity of the finished run's output, so a new run reports again even with the same verdict. */
  runResultsKey: unknown
  paletteOpen: boolean
  addPopoverOpen: boolean
}

/**
 * Reports the usage events that follow from workspace state (see events.ts): it starts the
 * configured sinks once, then turns state changes into events. Click-driven events (details
 * opened, layout toggled) are sent where the click is handled.
 */
export function useUsageTracking({
  layout,
  hasCanvasNodes,
  runStatus,
  runVerdict,
  runResultsKey,
  paletteOpen,
  addPopoverOpen
}: UsageTrackingState): void {
  const openedAtRef = useRef(Date.now())
  const runCountRef = useRef(0)

  useEffect(() => {
    startAnalytics()
    trackOnce('app-opened', 'app_opened', { layout })
    // Once per page load (StrictMode mounts twice in development); a layout switch later is
    // reported as layout_toggled, not a new open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (hasCanvasNodes) {
      trackOnce('canvas-populated', 'canvas_populated', {
        ms_since_open: Date.now() - openedAtRef.current
      })
    }
  }, [hasCanvasNodes])

  useEffect(() => {
    if (runStatus !== 'running') return
    runCountRef.current += 1
    track('run_started', {
      first: runCountRef.current === 1,
      layout,
      ms_since_open: Date.now() - openedAtRef.current
    })
  }, [layout, runStatus])

  useEffect(() => {
    if (runVerdict) track('run_completed', { verdict: runVerdict })
  }, [runVerdict, runResultsKey])

  useEffect(() => {
    if (paletteOpen) track('palette_opened', {})
  }, [paletteOpen])

  useEffect(() => {
    if (addPopoverOpen) track('add_popover_opened', {})
  }, [addPopoverOpen])
}
