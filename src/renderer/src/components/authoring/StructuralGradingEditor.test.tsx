// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringStructuralRuleReducer,
  type AuthoringStructuralRuleDraft
} from '../../../../engine/analysis/questionAuthoringStructuralRules'
import { StructuralGradingEditor } from './StructuralGradingEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(initial: AuthoringStructuralRuleDraft[] = []): HTMLDivElement {
  function Harness() {
    const [rules, dispatch] = useReducer(authoringStructuralRuleReducer, initial)
    return <StructuralGradingEditor rules={rules} onAction={dispatch} />
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

describe('StructuralGradingEditor', () => {
  it('adds a valid zero-config rule and explains its exact topology meaning', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add structural test'))

    expect(view.textContent).toContain('Use exactly one traffic source.')
    expect(view.textContent).toContain('Compiled structural meaning')
  })

  it('switches kind and flags an incomplete rule until its component is chosen', () => {
    const view = renderEditor()
    click(buttonNamed(view, 'Add structural test'))

    const kind = view.querySelector(
      'select[aria-label="Structural rule kind"]'
    ) as HTMLSelectElement
    select(kind, 'requires_component')

    // requires_component needs a componentType, so it is incomplete on switch.
    expect(view.textContent).toContain('Rule incomplete')

    select(
      view.querySelector('select[aria-label="Component"]') as HTMLSelectElement,
      'in-memory-cache'
    )
    expect(view.textContent).toContain('Compiled structural meaning')

    click(buttonNamed(view, 'Remove structural test'))
    expect(view.textContent).toContain('No structural tests yet')
  })

  it('lets an author override the learner-facing test description', () => {
    const view = renderEditor()
    click(buttonNamed(view, 'Add structural test'))

    enter(
      view.querySelector(
        'input[aria-label="Learner-facing description for structural-rule-1"]'
      ) as HTMLInputElement,
      'Include exactly one Users traffic source.'
    )

    expect(view.textContent).toContain('Include exactly one Users traffic source.')
  })
})
