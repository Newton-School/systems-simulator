// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IFileService } from '../../services/FileService.types'
import { QuestionStudioShell } from './QuestionStudioShell'

vi.mock('../canvas/FlowCanvas', () => ({
  FlowCanvas: () => <div data-testid="flow-canvas-mock">Canvas</div>
}))
// Stub the heavy lazy-loaded scaffold panels: their real modules resolve slowly
// enough in CI that the suspense settles after the test's act() window, logging a
// console warning during worker teardown ("Closing rpc while onUserConsoleLog was
// pending"). The quick-add buttons the tests use live in LearnerStartEditor itself.
vi.mock('../library/ComponentLibrarySidebarPanel', () => ({
  ComponentLibrarySidebarPanel: () => null
}))
vi.mock('../properties/PropertiesPanel', () => ({
  PropertiesPanel: () => null
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderShell(fileService?: IFileService): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<QuestionStudioShell simulatorHref="/" fileService={fileService} />))
  return container
}

function enter(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function enterProblemStatement(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      textarea,
      value
    )
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
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

function buttonNamed(view: HTMLElement, name: string): HTMLButtonElement {
  const button = [...view.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(name)
  )
  if (!button) throw new Error(`Could not find button named ${name}`)
  return button
}

async function clickAndFlush(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // Flush a macrotask so lazy import() chains (FlowCanvas + panels) settle inside act().
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('QuestionStudioShell', () => {
  it('renders the seven-stage shell and foundation readiness', () => {
    const view = renderShell()
    const stageNavigation = view.querySelector('nav[aria-label="Question authoring stages"]')

    expect(view.textContent).toContain('Question Studio')
    expect(view.textContent).toContain('Frame the lesson')
    expect(stageNavigation?.querySelectorAll('button')).toHaveLength(7)
    expect(view.textContent).toContain('14 / 14 package round-trips')
  })

  it('opens the structural grading editor without claiming proof readiness', () => {
    const view = renderShell()
    const gradingButton = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('5. Grading')
    )
    expect(gradingButton).toBeTruthy()

    act(() => gradingButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(view.textContent).toContain('Stage 5 of 7')
    expect(view.textContent).toContain('Structural grading')
    expect(view.textContent).toContain('No structural tests yet')
    expect(view.textContent).toContain('Runtime metric grading')
    expect(view.textContent).toContain('No metric tests yet')
    expect(view.textContent).toContain('Grading contract')
    expect(view.textContent).toContain('0 / 4')
  })

  it('builds and stores one valid scaffold snapshot from the visual starting-state editor', async () => {
    const view = renderShell()

    await clickAndFlush(buttonNamed(view, '3. Start'))
    expect(view.textContent).toContain('Scaffold canvas')
    expect(view.textContent).toContain('Blank-canvas entry remains active')

    await clickAndFlush(buttonNamed(view, 'Create starting topology'))
    expect(view.querySelector('[data-testid="flow-canvas-mock"]')).toBeTruthy()

    await clickAndFlush(buttonNamed(view, 'Traffic source'))
    await clickAndFlush(buttonNamed(view, 'Done editing'))

    expect(view.textContent).toContain('1 nodes · 0 edges')
    expect(view.textContent).toContain('Snapshot stored in draft')
    expect(view.textContent).toContain('Full component catalogue')
  })

  it('reflects the title and generated identity in shell readiness', () => {
    const view = renderShell()
    const titleInput = view.querySelector('#question-title') as HTMLInputElement

    expect(view.textContent).toContain('Untitled question · New draft')
    expect(view.textContent).toContain('0 / 4')

    enter(titleInput, 'Design a Durable Queue')

    expect(view.textContent).toContain('Design a Durable Queue · Unsaved draft')
    expect(view.querySelector('output')?.textContent).toContain('design-a-durable-queue')
    expect(view.textContent).toContain('1 / 4')
  })

  it('blocks generated output for an incomplete draft without showing partial JSON', () => {
    const view = renderShell()

    act(() =>
      buttonNamed(view, '7. Export').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )

    expect(view.textContent).toContain('Stage 7 of 7')
    expect(view.textContent).toContain('Generated output is not available yet')
    expect(view.textContent).toContain('Add a question title.')
    expect(view.textContent).toContain('Add at least one valid scenario.')
    expect(view.querySelector('[data-testid="generated-output-json"]')).toBeNull()
    expect(buttonNamed(view, 'Django bundle').disabled).toBe(true)
  })

  it('saves and reopens the visual draft through the file service', async () => {
    let savedFile: { content: string; name: string } | null = null
    const fileService: IFileService = {
      save: vi.fn(async (content, suggestedName) => {
        savedFile = { content, name: suggestedName ?? 'project.json' }
        return { name: savedFile.name }
      }),
      load: vi.fn(async () => savedFile)
    }
    const view = renderShell(fileService)
    const titleInput = view.querySelector('#question-title') as HTMLInputElement

    enter(titleInput, 'Design a Durable Queue')
    act(() =>
      buttonNamed(view, '2. Brief').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    const problemStatement = view.querySelector('#problem-statement') as HTMLTextAreaElement
    enterProblemStatement(problemStatement, 'Keep messages durable during worker restarts.')
    act(() =>
      buttonNamed(view, 'Add requirement').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    const requirement = view.querySelector('ol textarea') as HTMLTextAreaElement
    enterProblemStatement(requirement, 'Replay failed deliveries')
    act(() =>
      buttonNamed(view, 'Add target').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(view.textContent).toContain('Stage 2 of 7')
    expect(view.textContent).toContain('2 / 4')
    expect(view.textContent).toContain('P99 latency must be below 100 ms.')
    act(() =>
      buttonNamed(view, '4. Scenarios').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    act(() =>
      buttonNamed(view, 'Add baseline').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(view.textContent).toContain('Stage 4 of 7')
    expect(view.textContent).toContain('3 / 4')
    expect(view.textContent).toContain('1,000 req/s constant traffic')
    expect(view.textContent).toContain('Continue to Grading')
    act(() =>
      buttonNamed(view, '5. Grading').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    act(() =>
      buttonNamed(view, 'Add structural test').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
    )
    act(() =>
      buttonNamed(view, 'Add metric test').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )

    expect(view.textContent).toContain('Stage 5 of 7')
    expect(view.textContent).toContain('Use exactly one traffic source.')
    expect(view.textContent).toContain('P99 latency must be below 100 ms.')
    expect(view.textContent).toContain('summary.latency.p99 < 100')
    expect(view.textContent).toContain('Contract authored · empirical proof still pending')
    expect(view.textContent).toContain('4 / 4')
    expect(view.textContent).toContain('Continue to Preview')
    act(() =>
      buttonNamed(view, '7. Export').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )

    expect(view.textContent).toContain('Stage 7 of 7')
    expect(view.textContent).toContain('Generated output is current')
    expect(view.textContent).toContain('3 Newton rows')
    expect(view.textContent).toContain('design-a-durable-queue')
    expect(buttonNamed(view, 'Download Django bundle').disabled).toBe(false)
    act(() =>
      buttonNamed(view, 'Newton rows (3)').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    const generatedRows = view.querySelector('[data-testid="generated-output-json"]') as HTMLElement
    expect(generatedRows.textContent).toContain('"type": "SIMULATOR_CONFIG"')
    expect(generatedRows.textContent).toContain('"type": "STRUCTURAL_RULE"')
    expect(generatedRows.textContent).toContain('"type": "RUBRIC_CHECK"')
    await clickAndFlush(buttonNamed(view, 'Save draft'))

    expect(view.textContent).toContain('Design a Durable Queue · Saved')
    expect(view.textContent).toContain('Saved design-a-durable-queue.simulator-question-project.json')

    act(() =>
      buttonNamed(view, '5. Grading').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    const structuralKind = view.querySelector(
      'select[aria-label="Structural rule kind"]'
    ) as HTMLSelectElement
    select(structuralKind, 'requires_connected_graph')
    select(
      view.querySelector('#metric-rule-metric-target-metric') as HTMLSelectElement,
      'error_rate'
    )
    act(() =>
      buttonNamed(view, '4. Scenarios').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    enter(view.querySelector('#scenario-baseline-seed') as HTMLInputElement, 'replacement-seed')
    enter(view.querySelector('#scenario-baseline-baseRps') as HTMLInputElement, '2500')
    act(() =>
      buttonNamed(view, '2. Brief').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    const replacementProblemStatement = view.querySelector(
      '#problem-statement'
    ) as HTMLTextAreaElement
    const replacementRequirement = view.querySelector('ol textarea') as HTMLTextAreaElement
    const replacementNfrMetric = view.querySelector(
      '#non-functional-requirement-1-metric'
    ) as HTMLSelectElement
    enterProblemStatement(replacementProblemStatement, 'Replacement draft statement.')
    enterProblemStatement(replacementRequirement, 'Replacement requirement.')
    select(replacementNfrMetric, 'throughput')
    act(() => buttonNamed(view, 'Open').dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(view.querySelector('[role="dialog"]')?.textContent).toContain(
      'Discard unsaved question changes?'
    )
    expect(fileService.load).not.toHaveBeenCalled()

    await clickAndFlush(buttonNamed(view, 'Discard and Open'))

    expect(fileService.load).toHaveBeenCalledTimes(1)
    expect(view.textContent).toContain('Stage 7 of 7')
    expect(view.textContent).toContain('Generated output is current')
    expect(view.textContent).toContain('3 Newton rows')
    expect(view.textContent).toContain('Opened design-a-durable-queue.simulator-question-project.json')
    expect(view.textContent).toContain('Design a Durable Queue · Saved')

    act(() =>
      buttonNamed(view, '5. Grading').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(
      (view.querySelector('select[aria-label="Structural rule kind"]') as HTMLSelectElement).value
    ).toBe('requires_single_source')
    expect(view.textContent).toContain('Use exactly one traffic source.')
    expect(
      (view.querySelector('#metric-rule-metric-target-metric') as HTMLSelectElement).value
    ).toBe('latency_p99')
    expect((view.querySelector('#metric-rule-metric-target-value') as HTMLInputElement).value).toBe(
      '100'
    )
    expect(view.textContent).toContain('summary.latency.p99 < 100')
    expect(view.textContent).toContain('Contract authored · empirical proof still pending')
    expect(view.textContent).toContain('4 / 4')

    act(() =>
      buttonNamed(view, '4. Scenarios').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect((view.querySelector('#scenario-baseline-seed') as HTMLInputElement).value).toBe(
      'baseline-v1'
    )
    expect((view.querySelector('#scenario-baseline-baseRps') as HTMLInputElement).value).toBe(
      '1000'
    )
    act(() =>
      buttonNamed(view, '2. Brief').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect((view.querySelector('#problem-statement') as HTMLTextAreaElement).value).toBe(
      'Keep messages durable during worker restarts.'
    )
    expect((view.querySelector('ol textarea') as HTMLTextAreaElement).value).toBe(
      'Replay failed deliveries'
    )
    expect(
      (view.querySelector('#non-functional-requirement-1-metric') as HTMLSelectElement).value
    ).toBe('latency_p99')
    expect(
      (view.querySelector('#non-functional-requirement-1-value') as HTMLInputElement).value
    ).toBe('100')
  })
})
