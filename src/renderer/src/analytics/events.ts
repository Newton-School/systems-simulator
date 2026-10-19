/**
 * Every usage event the app can report, with the properties each carries. Call sites import
 * `track` and name an event from this list; nothing outside this folder knows which service
 * receives it. Keep the list short and free of anything that identifies a person.
 */
export interface AnalyticsEventMap {
  /** The workspace finished loading. */
  app_opened: { layout: 'simple' | 'full' }
  /** The canvas went from empty to having nodes, once per session. A loaded question's scaffold
   * or a sample counts too: this is "got something on the canvas", not "placed it by hand". */
  canvas_populated: { ms_since_open: number }
  /** A run started. `first` is true for the session's first one. */
  run_started: { first: boolean; layout: 'simple' | 'full'; ms_since_open: number }
  /** A run finished with a verdict from the summary strip. */
  run_completed: { verdict: 'passed' | 'needs-work' | 'failed' }
  /** See details opened the collapsed results tray. */
  details_opened: Record<string, never>
  /** The command palette (Cmd/Ctrl+K) opened. */
  palette_opened: Record<string, never>
  /** The Add popover opened. */
  add_popover_opened: Record<string, never>
  /** Someone turned the simple layout on or off in settings. */
  layout_toggled: { to: 'simple' | 'full' }
}

export type AnalyticsEventName = keyof AnalyticsEventMap

export interface AnalyticsEvent<N extends AnalyticsEventName = AnalyticsEventName> {
  name: N
  properties: AnalyticsEventMap[N]
  /** Milliseconds since the epoch, taken when `track` was called. */
  timestamp: number
}
