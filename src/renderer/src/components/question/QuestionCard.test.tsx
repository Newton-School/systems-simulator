// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QuestionPackage } from '../../../../engine/analysis/question'
import { QuestionCard } from './QuestionCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const question = {
  title: 'URL shortener',
  prompt: {
    text: 'Handle 5k req/s.',
    functionalRequirements: [],
    nonFunctionalRequirements: [{ description: '99.9% availability' }],
    scale: {}
  }
} as unknown as QuestionPackage

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function render(expanded: boolean, onToggle = () => {}, onShowFullBrief = () => {}) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <QuestionCard
        question={question}
        expanded={expanded}
        onToggle={onToggle}
        onShowFullBrief={onShowFullBrief}
      />
    )
  )
  return container
}

describe('QuestionCard', () => {
  it('expanded: shows the task, targets and a full-brief link', () => {
    const onShowFullBrief = vi.fn()
    const view = render(true, () => {}, onShowFullBrief)
    expect(view.textContent).toContain('Handle 5k req/s.')
    expect(view.textContent).toContain('99.9% availability')
    const link = [...view.querySelectorAll('button')].find((b) =>
      /Show full brief/.test(b.textContent ?? '')
    )
    act(() => link?.click())
    expect(onShowFullBrief).toHaveBeenCalled()
  })

  it('collapsed: a one-line chip with only the title that expands on click', () => {
    const onToggle = vi.fn()
    const view = render(false, onToggle)
    expect(view.textContent).toBe('URL shortener')
    act(() => (view.querySelector('button') as HTMLButtonElement).click())
    expect(onToggle).toHaveBeenCalled()
  })
})
