// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { EditableNumberInput } from './EditableNumberInput'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

function renderCoercingInput(initialValue = 500): HTMLInputElement {
  function Harness() {
    const [value, setValue] = useState(initialValue)
    return (
      <EditableNumberInput
        aria-label="Requests per second"
        value={value}
        onChange={(event) => setValue(Number(event.currentTarget.value))}
      />
    )
  }

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Harness />))
  return container.querySelector('input')!
}

function enter(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function leave(input: HTMLInputElement): void {
  act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}

describe('EditableNumberInput', () => {
  it('stays visually empty while a coercing parent renders zero', () => {
    const input = renderCoercingInput()

    act(() => input.focus())
    enter(input, '')

    expect(input.value).toBe('')
  })

  it('lets the user replace the whole value from the first digit', () => {
    const input = renderCoercingInput()

    act(() => input.focus())
    enter(input, '')
    enter(input, '1')
    enter(input, '10')
    enter(input, '100')

    expect(input.value).toBe('100')

    leave(input)
    expect(input.value).toBe('100')
  })

  it("restores the parent's numeric fallback if the field is left empty", () => {
    const input = renderCoercingInput()

    act(() => input.focus())
    enter(input, '')
    leave(input)

    expect(input.value).toBe('0')
  })
})
