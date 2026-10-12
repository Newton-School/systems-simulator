// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAnsi } from './ansiSegments'
import { TerminalTab, type TerminalSimulationProps } from './TerminalTab'
import { useTerminalStore } from './terminalStore'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('parseAnsi', () => {
  it('splits SGR runs into styled segments', () => {
    expect(parseAnsi('\x1b[1mbold\x1b[0m \x1b[31mred\x1b[0m\x1b[2mdim')).toEqual([
      { text: 'bold', bold: true, dim: false, color: null },
      { text: ' ', bold: false, dim: false, color: null },
      { text: 'red', bold: false, dim: false, color: 'red' },
      { text: 'dim', bold: false, dim: true, color: null }
    ])
  })
})

function sim(overrides: Partial<TerminalSimulationProps> = {}): TerminalSimulationProps {
  return {
    status: 'idle',
    progress: 0,
    eventsProcessed: 0,
    playbackSpeed: 'max',
    stopped: false,
    error: null,
    snapshot: null,
    results: null,
    topology: null,
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    step: vi.fn(),
    setPlaybackSpeed: vi.fn(),
    ...overrides
  }
}

describe('TerminalTab', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  function type(input: HTMLInputElement, value: string, key = 'Enter'): void {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
  }

  it('runs commands, recalls history and auto-enters runtime mode on run start', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(<TerminalTab sim={sim()} onRun={vi.fn()} />))
    const input = container.querySelector<HTMLInputElement>('[data-testid="terminal-input"]')!
    type(input, 'help')
    expect(container.textContent).toContain('show topology')
    type(input, '', 'ArrowUp')
    expect(input.value).toBe('help')
    type(input, 'speed 5')
    expect(container.textContent).toContain('Playback speed 5x')

    act(() => root!.render(<TerminalTab sim={sim({ status: 'running' })} onRun={vi.fn()} />))
    expect(container.textContent).toContain('sim(runtime)#')
    act(() =>
      root!.render(<TerminalTab sim={sim({ status: 'error', error: 'boom' })} onRun={vi.fn()} />)
    )
    expect(container.textContent).toContain('Run failed: boom')
    expect(useTerminalStore.getState().session.ctx.mode).toBe('sim')
  })
})
