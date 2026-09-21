// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringMetricRuleReducer,
  type AuthoringMetricRuleDraft
} from '../../../../engine/analysis/questionAuthoringMetricRules'
import { MetricGradingEditor } from './MetricGradingEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(initial: AuthoringMetricRuleDraft[] = []): HTMLDivElement {
  function Harness() {
    const [rules, dispatch] = useReducer(authoringMetricRuleReducer, initial)
    return <MetricGradingEditor rules={rules} onAction={dispatch} />
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

describe('MetricGradingEditor', () => {
  it('builds a registry-backed metric sentence and switches among MVP selectors', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add metric test'))
    const metric = view.querySelector('#metric-rule-metric-target-metric') as HTMLSelectElement
    const value = view.querySelector('#metric-rule-metric-target-value') as HTMLInputElement

    expect(view.textContent).toContain('P99 latency must be below 100 ms.')
    expect(view.textContent).toContain('summary.latency.p99 < 100')
    expect(view.textContent).toContain('Contract authored · empirical proof still pending')
    expect(buttonNamed(view, 'Metric test added').disabled).toBe(true)

    select(metric, 'error_rate')
    expect(value.value).toBe('1')
    expect(view.textContent).toContain('Error rate must be below 1%.')
    expect(view.textContent).toContain('summary.errorRate < 0.01')

    select(metric, 'throughput')
    enter(value, '2500')
    expect(view.textContent).toContain('Throughput must be at least 2,500 req/s.')
    expect(view.textContent).toContain('summary.throughput >= 2500')
  })

  it('shows incomplete feedback for an empty value, then removes the rule', () => {
    const view = renderEditor()
    click(buttonNamed(view, 'Add metric test'))
    const value = view.querySelector('#metric-rule-metric-target-value') as HTMLInputElement

    enter(value, '')

    expect(view.textContent).toContain('Enter a numeric target.')
    expect(view.textContent).toContain('Rule incomplete')

    click(buttonNamed(view, 'Remove metric test'))
    expect(view.textContent).toContain('No metric tests yet')
  })
})
