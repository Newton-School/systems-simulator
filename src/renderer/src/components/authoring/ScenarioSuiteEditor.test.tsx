// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringScenarioReducer,
  type AuthoringScenarioDraft
} from '../../../../engine/analysis/questionAuthoringScenario'
import { ScenarioSuiteEditor } from './ScenarioSuiteEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(initial: AuthoringScenarioDraft[] = []): HTMLDivElement {
  function Harness() {
    const [scenarios, dispatch] = useReducer(authoringScenarioReducer, initial)
    return <ScenarioSuiteEditor scenarios={scenarios} onAction={dispatch} />
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

function enter(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ScenarioSuiteEditor', () => {
  it('adds one deterministic baseline and shows its normalized runtime meaning', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add baseline'))

    expect((view.querySelector('#scenario-baseline-description') as HTMLInputElement).value).toBe(
      'Sustain steady traffic under normal conditions.'
    )
    expect(view.textContent).toContain(
      '1,000 req/s constant traffic · 80% read / 20% write · 60s run · 5s warmup · seed baseline-v1'
    )
    // Multiple scenarios are now supported, so adding one keeps an add action available.
    expect(buttonNamed(view, 'Add scenario')).toBeTruthy()
  })

  it('updates workload controls and blocks compilation when deterministic fields are incomplete', () => {
    const view = renderEditor()
    click(buttonNamed(view, 'Add baseline'))
    const rps = view.querySelector('#scenario-baseline-baseRps') as HTMLInputElement
    const readPercent = view.querySelector('#scenario-baseline-readPercent') as HTMLInputElement
    const seed = view.querySelector('#scenario-baseline-seed') as HTMLInputElement

    enter(rps, '2500')
    enter(readPercent, '90')
    enter(seed, 'peak-fixed-v2')

    expect(view.textContent).toContain(
      '2,500 req/s constant traffic · 90% read / 10% write · 60s run · 5s warmup · seed peak-fixed-v2'
    )

    enter(seed, '')
    expect(view.textContent).toContain('Add a fixed seed for reproducible runs.')
    expect(view.textContent).toContain('Scenario incomplete')

    click(buttonNamed(view, 'Remove baseline scenario'))
    expect(view.textContent).toContain('No grading scenario yet')
  })
})
