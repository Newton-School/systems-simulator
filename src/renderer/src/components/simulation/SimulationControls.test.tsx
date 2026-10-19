// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCENARIO_STATE, type SourceNodeOption } from '@renderer/types/ui'
import { SimulationControls } from './SimulationControls'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sourceNodes = [
  {
    id: 'client',
    label: 'Client',
    workload: { baseRps: 120, pattern: 'poisson' }
  }
] as unknown as SourceNodeOption[]

describe('SimulationControls Run and Workload', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    document.body.innerHTML = ''
    container = null
    root = null
  })

  function render(separateRun: boolean, onRun: () => void) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <SimulationControls
          onRun={onRun}
          onReset={() => {}}
          isPostRun={false}
          onPause={() => {}}
          onResume={() => {}}
          onStop={() => {}}
          isRunning={false}
          isPaused={false}
          sourceNodes={sourceNodes}
          faultTargets={[]}
          scenario={DEFAULT_SCENARIO_STATE}
          onScenarioChange={() => {}}
          separateRun={separateRun}
        />
      )
    )
    return container
  }

  const button = (view: HTMLElement, label: RegExp) =>
    [...view.querySelectorAll('button')].find((b) => label.test(b.textContent ?? '')) ?? null

  it('separate mode: Run starts the run and never opens the workload panel', () => {
    const onRun = vi.fn()
    const view = render(true, onRun)
    act(() => button(view, /^Run$/)?.click())
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain('Base RPS')
  })

  it('separate mode: Workload opens the panel without running', () => {
    const onRun = vi.fn()
    const view = render(true, onRun)
    act(() => button(view, /Workload/)?.click())
    expect(onRun).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Base RPS')
  })

  it('default mode: Run opens the workload panel and has no Workload button', () => {
    const onRun = vi.fn()
    const view = render(false, onRun)
    expect(button(view, /Workload/)).toBeNull()
    act(() => button(view, /^Run$/)?.click())
    expect(onRun).not.toHaveBeenCalled()
  })

  it('separate mode: a blocked experiment opens the Workload panel on Run instead of going dead', () => {
    const onRun = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <SimulationControls
          onRun={onRun}
          onReset={() => {}}
          isPostRun={false}
          onPause={() => {}}
          onResume={() => {}}
          onStop={() => {}}
          isRunning={false}
          isPaused={false}
          sourceNodes={sourceNodes}
          faultTargets={[]}
          scenario={{
            ...DEFAULT_SCENARIO_STATE,
            experiment: [{ preset: 'database-failover' }] as never
          }}
          onScenarioChange={() => {}}
          previewExperiment={() => ({ ok: false, reason: 'needs a replica' }) as never}
          separateRun
        />
      )
    )
    const run = button(container, /^Run$/)
    expect(run?.disabled).toBe(false)
    act(() => run?.click())
    expect(onRun).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Base RPS')
  })
})
