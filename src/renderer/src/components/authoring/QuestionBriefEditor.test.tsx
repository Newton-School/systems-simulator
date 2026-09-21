// @vitest-environment jsdom
import { act, useReducer, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { nonFunctionalRequirementReducer } from '../../../../engine/analysis/questionAuthoringNfr'
import { functionalRequirementReducer } from '../../../../engine/analysis/questionAuthoringRequirements'
import { QuestionBriefEditor } from './QuestionBriefEditor'
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
    const [problemStatement, setProblemStatement] = useState('')
    const [requirements, dispatch] = useReducer(functionalRequirementReducer, [])
    const [nonFunctionalRequirements, dispatchNfr] = useReducer(nonFunctionalRequirementReducer, [])
    return (
      <QuestionBriefEditor
        questionTitle="Design a Queue"
        problemStatement={problemStatement}
        functionalRequirements={requirements}
        nonFunctionalRequirements={nonFunctionalRequirements}
        onProblemStatementChange={setProblemStatement}
        onFunctionalRequirementAction={dispatch}
        onNonFunctionalRequirementAction={dispatchNfr}
      />
    )
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

describe('QuestionBriefEditor', () => {
  it('shows an empty learner-preview state before authoring starts', () => {
    const view = renderEditor()

    expect(view.textContent).toContain('Design a Queue')
    expect(view.textContent).toContain('The learner-facing problem statement will appear here.')
    expect(view.textContent).toContain('Add a problem statement to complete the learner brief.')
  })

  it('renders paragraphs live while keeping authored HTML inert', () => {
    const view = renderEditor()
    const textarea = view.querySelector('textarea') as HTMLTextAreaElement

    enter(
      textarea,
      'Build a durable queue.\nKeep order.\n\n<script>alert("unsafe")</script> Handle A & B.'
    )

    const preview = view.querySelector('[data-testid="learner-brief-content"]') as HTMLDivElement
    expect(textarea.value).toContain('Build a durable queue.')
    expect(preview.querySelectorAll('p')).toHaveLength(2)
    expect(preview.querySelector('br')).not.toBeNull()
    expect(preview.querySelector('script')).toBeNull()
    expect(preview.textContent).toContain('<script>alert("unsafe")</script> Handle A & B.')
    expect(view.textContent).toContain('HTML is escaped automatically.')
  })

  it('renders functional requirement cards in learner order', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add requirement'))
    click(buttonNamed(view, 'Add requirement'))
    const requirementInputs = [...view.querySelectorAll('ol textarea')]
    enter(requirementInputs[0] as HTMLTextAreaElement, 'Accept new messages')
    enter(requirementInputs[1] as HTMLTextAreaElement, 'Replay failed deliveries')

    let previewItems = [...view.querySelectorAll('[data-testid="learner-brief-content"] li')]
    expect(previewItems.map((item) => item.textContent)).toEqual([
      'Accept new messages',
      'Replay failed deliveries'
    ])

    click(buttonNamed(view, 'Move requirement 2 up'))
    previewItems = [...view.querySelectorAll('[data-testid="learner-brief-content"] li')]
    expect(previewItems.map((item) => item.textContent)).toEqual([
      'Replay failed deliveries',
      'Accept new messages'
    ])
  })

  it('renders a valid typed NFR card with the same generated learner sentence', () => {
    const view = renderEditor()

    click(buttonNamed(view, 'Add target'))

    const targetSentence = view.querySelector('[data-testid="nfr-description-1"]')?.textContent
    const previewItems = [...view.querySelectorAll('[data-testid="learner-brief-content"] li')]

    expect(targetSentence).toBe('P99 latency must be below 100 ms.')
    expect(previewItems.map((item) => item.textContent)).toContain(targetSentence)
  })
})
