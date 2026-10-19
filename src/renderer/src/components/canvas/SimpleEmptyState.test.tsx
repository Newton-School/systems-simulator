// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimpleEmptyState } from './SimpleEmptyState'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function render(onAdd: () => void, onLoadStarter?: () => void) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<SimpleEmptyState onAddComponent={onAdd} onLoadStarter={onLoadStarter} />))
  return container
}

const button = (view: HTMLElement, label: RegExp) =>
  [...view.querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''))

describe('SimpleEmptyState', () => {
  it('opens the Add popover and loads the starter from its two buttons', () => {
    const onAdd = vi.fn()
    const onLoadStarter = vi.fn()
    const view = render(onAdd, onLoadStarter)
    act(() => button(view, /Add component/)?.click())
    act(() => button(view, /Load starter diagram/)?.click())
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onLoadStarter).toHaveBeenCalledTimes(1)
  })

  it('leaves out the starter button when none is offered', () => {
    const view = render(() => {})
    expect(button(view, /Load starter diagram/)).toBeUndefined()
  })
})
