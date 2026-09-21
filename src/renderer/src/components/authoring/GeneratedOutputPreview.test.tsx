// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileQuestionAuthoringPreview } from '../../../../engine/analysis/questionAuthoringCompiler'
import { createQuestionAuthoringProject } from '../../../../engine/analysis/questionAuthoringProject'
import { GeneratedOutputPreview } from './GeneratedOutputPreview'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderPreview(
  preview: ReturnType<typeof compileQuestionAuthoringPreview>,
  onNavigate = vi.fn(),
  onDownload = vi.fn(async () => undefined),
  copyText = vi.fn(async () => undefined),
  onDownloadQuestion = vi.fn(async () => undefined)
): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <GeneratedOutputPreview
        preview={preview}
        onNavigate={onNavigate}
        onDownload={onDownload}
        onDownloadQuestion={onDownloadQuestion}
        copyText={copyText}
      />
    )
  )
  return container
}

function completePreview() {
  return compileQuestionAuthoringPreview(
    createQuestionAuthoringProject({
      projectId: 'preview-project',
      updatedAt: '2026-09-19T12:00:00.000Z',
      title: 'Design a Durable Queue',
      problemStatement: 'Keep accepted messages durable during worker restarts.',
      scenarios: [
        {
          id: 'baseline',
          description: 'Sustain steady traffic.',
          seed: 'baseline-v1',
          pattern: 'constant',
          durationSeconds: 60,
          warmupSeconds: 5,
          baseRps: 1000,
          readPercent: 80,
          requestSizeBytes: 512
        }
      ],
      structuralRules: [{ id: 'single-source', kind: 'requires_single_source' }],
      metricRules: [
        {
          id: 'metric-target',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ]
    })
  )
}

function buttonNamed(view: HTMLElement, name: string): HTMLButtonElement {
  const button = [...view.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(name)
  )
  if (!button) throw new Error(`Could not find button named ${name}`)
  return button
}

describe('GeneratedOutputPreview', () => {
  it('shows actionable diagnostics and no partial JSON for an incomplete draft', () => {
    const onNavigate = vi.fn()
    const view = renderPreview(
      compileQuestionAuthoringPreview(createQuestionAuthoringProject()),
      onNavigate
    )

    expect(view.textContent).toContain('Generated output is not available yet')
    expect(view.textContent).toContain('Add a question title.')
    expect(view.textContent).toContain('Add at least one valid scenario.')
    expect(view.querySelector('pre')).toBeNull()

    act(() =>
      buttonNamed(view, 'Open Frame').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    expect(onNavigate).toHaveBeenCalledWith('frame')
  })

  it('switches between deterministic package and Newton row payloads', () => {
    const view = renderPreview(completePreview())
    const output = view.querySelector('[data-testid="generated-output-json"]') as HTMLElement

    expect(view.textContent).toContain('Generated output is current')
    expect(view.textContent).toContain('3 Newton rows')
    expect(output.textContent).toContain('"id": "design-a-durable-queue"')
    expect(view.querySelector('textarea')).toBeNull()

    act(() =>
      buttonNamed(view, 'Newton rows (3)').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )

    expect(output.textContent).toContain('"type": "SIMULATOR_CONFIG"')
    expect(output.textContent).toContain('"type": "STRUCTURAL_RULE"')
    expect(output.textContent).toContain('"type": "RUBRIC_CHECK"')
  })

  it('copies the visible artifact and individual Django rows, then downloads the bundle', async () => {
    const copyText = vi.fn(async () => undefined)
    const onDownload = vi.fn(async () => undefined)
    const view = renderPreview(completePreview(), vi.fn(), onDownload, copyText)

    await act(async () => {
      buttonNamed(view, 'Copy visible JSON').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })
    expect(copyText).toHaveBeenLastCalledWith(
      expect.stringContaining('"id": "design-a-durable-queue"')
    )
    expect(view.textContent).toContain('Question package JSON copied.')

    act(() =>
      buttonNamed(view, 'Newton rows (3)').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    )
    await act(async () => {
      buttonNamed(view, 'Copy row 2').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(copyText).toHaveBeenLastCalledWith(expect.stringContaining('"STRUCTURAL_RULE"'))
    expect(view.textContent).toContain('Row 2 copied.')

    await act(async () => {
      buttonNamed(view, 'Download Django bundle').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('downloads the simulator-loadable question package', async () => {
    const onDownloadQuestion = vi.fn(async () => undefined)
    const view = renderPreview(completePreview(), vi.fn(), vi.fn(), vi.fn(), onDownloadQuestion)

    await act(async () => {
      buttonNamed(view, 'Download question (.json)').dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onDownloadQuestion).toHaveBeenCalledTimes(1)
  })
})
