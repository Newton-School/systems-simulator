// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'
import type { PaletteCommand } from './commandPaletteModel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function render(commands: PaletteCommand[], onClose = () => {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<CommandPalette commands={commands} onClose={onClose} />))
  return container
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function key(target: Element, k: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

describe('CommandPalette', () => {
  it('is a modal dialog so global shortcuts stand down', () => {
    const view = render([])
    expect(view.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull()
  })

  it('filters as you type and runs the highlighted command on Enter, then closes', () => {
    const run = vi.fn()
    const other = vi.fn()
    const onClose = vi.fn()
    const view = render(
      [
        { id: 'a', title: 'Save design', group: 'File', run: other },
        { id: 'b', title: 'Run simulation', group: 'Run', run }
      ],
      onClose
    )
    const input = view.querySelector('input') as HTMLInputElement
    type(input, 'run')
    expect(view.querySelectorAll('[role="option"]').length).toBe(1)
    key(view.querySelector('[role="dialog"]') as Element, 'Enter')
    expect(run).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('moves the highlight with the arrow keys and closes on Escape', () => {
    const second = vi.fn()
    const onClose = vi.fn()
    const view = render(
      [
        { id: 'a', title: 'One', group: 'G', run: () => {} },
        { id: 'b', title: 'Two', group: 'G', run: second }
      ],
      onClose
    )
    const dialog = view.querySelector('[role="dialog"]') as Element
    key(dialog, 'ArrowDown')
    key(dialog, 'Enter')
    expect(second).toHaveBeenCalledTimes(1)
    key(dialog, 'Escape')
    expect(onClose).toHaveBeenCalled()
  })

  it('says so when nothing matches', () => {
    const view = render([{ id: 'a', title: 'One', group: 'G', run: () => {} }])
    type(view.querySelector('input') as HTMLInputElement, 'zzz')
    expect(view.textContent).toContain('No command matches')
  })
})
