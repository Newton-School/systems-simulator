// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  functionalRequirementReducer,
  type AuthoringFunctionalRequirement
} from '../../../../engine/analysis/questionAuthoringRequirements'
import { FunctionalRequirementsEditor } from './FunctionalRequirementsEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(initial: AuthoringFunctionalRequirement[] = []): HTMLDivElement {
  function Harness() {
    const [requirements, dispatch] = useReducer(functionalRequirementReducer, initial)
    return <FunctionalRequirementsEditor requirements={requirements} onAction={dispatch} />
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

function enter(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      textarea,
      value
    )
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('FunctionalRequirementsEditor', () => {
  it('adds, edits, and removes a requirement card', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add requirement'))
    const textarea = view.querySelector('textarea') as HTMLTextAreaElement
    enter(textarea, 'Redirect a short URL')

    expect(view.textContent).toContain('Requirement 1')
    expect(textarea.value).toBe('Redirect a short URL')

    click(buttonNamed(view, 'Remove requirement 1'))
    expect(view.querySelectorAll('textarea')).toHaveLength(0)
    expect(view.textContent).toContain('No functional requirements yet')
  })

  it('supports keyboard reordering while preserving focus and card identity', () => {
    const view = renderEditor([
      { id: 'fr-a', text: 'First capability' },
      { id: 'fr-b', text: 'Second capability' }
    ])
    const second = view.querySelectorAll('textarea')[1] as HTMLTextAreaElement

    act(() => {
      second.focus()
      second.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true })
      )
    })

    const reordered = [...view.querySelectorAll('textarea')]
    expect(reordered.map((textarea) => textarea.value)).toEqual([
      'Second capability',
      'First capability'
    ])
    expect(document.activeElement).toBe(second)
    expect(second.closest('li')?.getAttribute('data-requirement-id')).toBe('fr-b')
  })
})
