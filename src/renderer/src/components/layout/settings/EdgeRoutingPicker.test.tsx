// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EDGE_ROUTING_OPTIONS } from '@renderer/config/edgeRouting'
import { EdgeRoutingPicker } from './EdgeRoutingPicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

describe('EdgeRoutingPicker', () => {
  it('renders every route as an accessible radio and reports selection changes', () => {
    const onChange = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(<EdgeRoutingPicker value="rounded" onChange={onChange} />)
    })

    const radios = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    expect(radios).toHaveLength(EDGE_ROUTING_OPTIONS.length)
    expect(
      radios.find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent
    ).toContain('Rounded')

    const angular = radios.find((radio) => radio.textContent?.includes('Angular'))
    act(() => angular?.click())
    expect(onChange).toHaveBeenCalledWith('octilinear')
  })
})
