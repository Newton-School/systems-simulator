// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_QUESTION_AUTHORING_SETUP,
  type QuestionAuthoringSetupDraft
} from '../../../../engine/analysis/questionAuthoringProject'
import { QuestionSetupEditor } from './QuestionSetupEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(): HTMLDivElement {
  function Harness() {
    const [setup, setSetup] = useState<QuestionAuthoringSetupDraft>(
      DEFAULT_QUESTION_AUTHORING_SETUP
    )
    return (
      <QuestionSetupEditor
        setup={setup}
        hasScaffold={false}
        authoringAbstraction="classroom"
        onRecommendAbstraction={() => undefined}
        onChange={setSetup}
      />
    )
  }

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
  return container
}

function domainChip(view: HTMLElement, name: string): HTMLLabelElement {
  const chip = [...view.querySelectorAll('label')].find((label) => label.textContent === name)
  if (!chip) throw new Error(`No "${name}" domain chip.`)
  return chip
}

describe('teaching domain chips', () => {
  it('keep their visually hidden checkbox inside the chip', () => {
    // A hidden (absolutely positioned) input outside a positioned chip lands far down
    // the page, and focusing it on click scrolled the whole Studio off screen.
    const view = renderEditor()
    for (const name of ['Compute', 'Storage', 'Network', 'Resilience', 'Correctness', 'Cost']) {
      const chip = domainChip(view, name)
      expect(chip.querySelector('input')?.className).toContain('sr-only')
      expect(chip.className.split(/\s+/)).toContain('relative')
    }
  })

  it('toggles the domain when the chip is clicked', () => {
    const view = renderEditor()
    const compute = domainChip(view, 'Compute')
    act(() => compute.click())
    expect(domainChip(view, 'Compute').querySelector('input')?.checked).toBe(true)
    act(() => domainChip(view, 'Compute').click())
    expect(domainChip(view, 'Compute').querySelector('input')?.checked).toBe(false)
  })
})
