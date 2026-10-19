// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useStore from '../../store/useStore'
import { AddComponentPopover } from './AddComponentPopover'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  useStore.setState({ activeQuestion: null, pendingNodePlacement: null })
  container?.remove()
  root = null
  container = null
})

function render(onClose = () => {}): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<AddComponentPopover onClose={onClose} onOpenBuilder={() => {}} />))
  return container
}

describe('AddComponentPopover', () => {
  it('opens on a short suggested row with the rest collapsed', () => {
    const view = render()
    expect(view.textContent).toContain('Suggested')
    expect(view.textContent).toContain('Browse')
    const expanded = view.querySelectorAll('button[aria-expanded="true"]')
    expect(expanded.length).toBe(0)
    const tiles = view.querySelectorAll('[draggable="true"]')
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles.length).toBeLessThanOrEqual(12)
  })

  it('expands one category at a time', () => {
    const view = render()
    const headers = [...view.querySelectorAll('button[aria-expanded]')] as HTMLButtonElement[]
    expect(headers.length).toBeGreaterThan(1)
    const before = view.querySelectorAll('[draggable="true"]').length
    act(() => headers[0].click())
    expect(headers[0].getAttribute('aria-expanded')).toBe('true')
    expect(view.querySelectorAll('[draggable="true"]').length).toBeGreaterThan(before)
    act(() => headers[1].click())
    expect(headers[0].getAttribute('aria-expanded')).toBe('false')
    expect(headers[1].getAttribute('aria-expanded')).toBe('true')
  })

  it('arms click-to-place and closes when a tile is picked', () => {
    const onClose = vi.fn()
    const view = render(onClose)
    const tile = view.querySelector('[role="button"][draggable="true"]') as HTMLElement
    act(() => tile.click())
    expect(useStore.getState().pendingNodePlacement).not.toBeNull()
    expect(onClose).toHaveBeenCalled()
  })

  it('searches the whole catalog and drops the suggested row', () => {
    const view = render()
    const input = view.querySelector('input') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'cache')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(view.textContent).not.toContain('Suggested')
    expect(view.querySelectorAll('[draggable="true"]').length).toBeGreaterThan(0)
  })
})
