// @vitest-environment jsdom
import { act, StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureAnalytics } from './analytics'
import { useUsageTracking, type UsageTrackingState } from './useUsageTracking'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let setState: (patch: Partial<UsageTrackingState>) => void = () => {}

function Harness(): null {
  const [state, set] = useState<UsageTrackingState>({
    layout: 'simple',
    hasCanvasNodes: false,
    runStatus: 'idle',
    runVerdict: undefined,
    runResultsKey: null,
    paletteOpen: false,
    addPopoverOpen: false
  })
  setState = (patch) => set((current) => ({ ...current, ...patch }))
  useUsageTracking(state)
  return null
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let info: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  // The debug console flag is what makes events observable without a PostHog key.
  localStorage.setItem('nssimulator.analytics-debug', 'console')
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  info.mockRestore()
  configureAnalytics([])
  localStorage.clear()
})

function events(): Array<{ name: string; properties: Record<string, unknown> }> {
  return info.mock.calls
    .filter((call: unknown[]) => call[0] === '[analytics]')
    .map((call: unknown[]) => ({
      name: String(call[1]),
      properties: call[2] as Record<string, unknown>
    }))
}

function mount(): void {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
}

describe('usage tracking, end to end through the debug console sink', () => {
  it('reports a session in order: open, canvas, first run, verdict, then the menus', () => {
    mount()
    act(() => setState({ hasCanvasNodes: true }))
    act(() => setState({ runStatus: 'running' }))
    act(() => setState({ runStatus: 'complete', runVerdict: 'passed', runResultsKey: {} }))
    act(() => setState({ paletteOpen: true }))
    act(() => setState({ addPopoverOpen: true }))

    expect(events().map((event) => event.name)).toEqual([
      'app_opened',
      'canvas_populated',
      'run_started',
      'run_completed',
      'palette_opened',
      'add_popover_opened'
    ])
    const [opened, , started, completed] = events()
    expect(opened.properties).toEqual({ layout: 'simple' })
    expect(started.properties).toMatchObject({ first: true, layout: 'simple' })
    expect(typeof started.properties.ms_since_open).toBe('number')
    expect(completed.properties).toEqual({ verdict: 'passed' })
  })

  it('marks only the first run as first, and reports each run once when it finishes', () => {
    mount()
    act(() => setState({ runStatus: 'running' }))
    act(() => setState({ runStatus: 'complete', runVerdict: 'passed', runResultsKey: {} }))
    act(() => setState({ runStatus: 'running' }))
    act(() => setState({ runStatus: 'complete', runVerdict: 'passed', runResultsKey: {} }))

    const runs = events().filter((event) => event.name === 'run_started')
    expect(runs.map((event) => event.properties.first)).toEqual([true, false])
    expect(events().filter((event) => event.name === 'run_completed')).toHaveLength(2)
  })

  it('reports the canvas getting its first nodes once, not on every change', () => {
    mount()
    act(() => setState({ hasCanvasNodes: true }))
    act(() => setState({ hasCanvasNodes: false }))
    act(() => setState({ hasCanvasNodes: true }))
    expect(events().filter((event) => event.name === 'canvas_populated')).toHaveLength(1)
  })

  it('sends nothing once the person has opted out', () => {
    localStorage.setItem('nssimulator.analytics-opt-out', '1')
    mount()
    act(() => setState({ hasCanvasNodes: true, runStatus: 'running' }))
    expect(events()).toEqual([])
  })

  it('reports the app opening once even when React mounts the effect twice (StrictMode)', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <StrictMode>
          <Harness />
        </StrictMode>
      )
    )
    expect(events().filter((event) => event.name === 'app_opened')).toHaveLength(1)
  })
})
