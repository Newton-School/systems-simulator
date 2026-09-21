// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  nonFunctionalRequirementReducer,
  type AuthoringNonFunctionalRequirement
} from '../../../../engine/analysis/questionAuthoringNfr'
import { NonFunctionalRequirementsEditor } from './NonFunctionalRequirementsEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(initial: AuthoringNonFunctionalRequirement[] = []): HTMLDivElement {
  function Harness() {
    const [requirements, dispatch] = useReducer(nonFunctionalRequirementReducer, initial)
    return <NonFunctionalRequirementsEditor requirements={requirements} onAction={dispatch} />
  }

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
  return container
}

function buttonNamed(view: HTMLElement, name: string): HTMLButtonElement {
  const button = [...view.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.includes(name) || candidate.getAttribute('aria-label') === name
  )
  if (!button) throw new Error(`Could not find button named ${name}`)
  return button
}

function click(button: HTMLButtonElement): void {
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function select(selectElement: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
      selectElement,
      value
    )
    selectElement.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function enter(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('NonFunctionalRequirementsEditor', () => {
  it('adds a typed target and keeps dependent choices valid when its metric changes', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add target'))
    const selects = view.querySelectorAll('select')
    const metric = selects[0] as HTMLSelectElement
    const operator = selects[1] as HTMLSelectElement
    const value = view.querySelector('input[type="number"]') as HTMLInputElement
    const unit = selects[2] as HTMLSelectElement

    expect(metric.value).toBe('latency_p99')
    expect(operator.value).toBe('<')
    expect(value.value).toBe('100')
    expect(unit.value).toBe('ms')
    expect(view.textContent).toContain('P99 latency must be below 100 ms.')

    select(metric, 'throughput')

    expect(operator.value).toBe('>=')
    expect(value.value).toBe('1000')
    expect(unit.value).toBe('req_per_sec')
    expect(view.textContent).toContain('Throughput must be at least 1,000 req/s.')

    enter(value, '2500')
    expect(view.textContent).toContain('Throughput must be at least 2,500 req/s.')

    click(buttonNamed(view, 'Remove target 1'))
    expect(view.querySelectorAll('input[type="number"]')).toHaveLength(0)
    expect(view.textContent).toContain('No measurable targets yet')
  })

  it('converts an availability target when the author switches display units', () => {
    const view = renderEditor([
      {
        id: 'nfr-availability',
        metric: 'availability',
        operator: '>=',
        value: 99.9,
        unit: 'percent'
      }
    ])
    const value = view.querySelector('input[type="number"]') as HTMLInputElement
    const unit = view.querySelectorAll('select')[2] as HTMLSelectElement

    select(unit, 'nines')

    expect(value.value).toBe('3')
    expect(view.textContent).toContain('Availability must be at least 3 nines.')
  })
})
