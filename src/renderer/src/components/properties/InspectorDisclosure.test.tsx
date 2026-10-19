// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { InspectorDisclosure } from './InspectorDisclosure'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function render(defaultOpen: boolean) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <InspectorDisclosure title="Capacity" defaultOpen={defaultOpen}>
        <p>fields</p>
      </InspectorDisclosure>
    )
  )
  return container
}

describe('InspectorDisclosure', () => {
  it('starts folded and opens on click', () => {
    const view = render(false)
    expect(view.textContent).not.toContain('fields')
    act(() => (view.querySelector('button') as HTMLButtonElement).click())
    expect(view.textContent).toContain('fields')
    expect(view.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('starts open when asked and folds on click', () => {
    const view = render(true)
    expect(view.textContent).toContain('fields')
    act(() => (view.querySelector('button') as HTMLButtonElement).click())
    expect(view.textContent).not.toContain('fields')
  })
})
