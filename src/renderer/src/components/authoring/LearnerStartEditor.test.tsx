// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TopologyJSON } from '../../../../engine/core/types'
import useStore from '../../store/useStore'
import { LearnerStartEditor } from './LearnerStartEditor'

vi.mock('../canvas/FlowCanvas', () => ({
  FlowCanvas: () => <div data-testid="flow-canvas-mock">Canvas</div>
}))
// Stub the heavy lazy-loaded scaffold panels so their suspense resolves fast and
// inside the test's act() window (see QuestionStudioShell.test for the rationale).
// The 'API server' / 'Traffic source' quick-add buttons live in LearnerStartEditor.
vi.mock('../library/ComponentLibrarySidebarPanel', () => ({
  ComponentLibrarySidebarPanel: () => null
}))
vi.mock('../properties/PropertiesPanel', () => ({
  PropertiesPanel: () => null
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

const SCAFFOLD: TopologyJSON = {
  id: 'question-scaffold',
  name: 'Question scaffold',
  version: '2.1.0',
  global: {
    simulationDuration: 60_000,
    warmupDuration: 5_000,
    seed: 'scaffold-v1',
    defaultTimeout: 5_000,
    timeResolution: 'millisecond'
  },
  nodes: [
    {
      id: 'traffic',
      type: 'api-endpoint',
      category: 'compute',
      role: 'source',
      label: 'Traffic source',
      position: { x: 80, y: 100 }
    }
  ],
  edges: [],
  workload: {
    sourceNodeId: 'traffic',
    pattern: 'constant',
    baseRps: 100,
    requestDistribution: [{ type: 'default', weight: 1, sizeBytes: 1024 }]
  }
}

afterEach(() => {
  act(() => root?.unmount())
  useStore.getState().setGraph([], [], { history: 'skip', resetHistory: true })
  container?.remove()
  root = null
  container = null
})

async function renderEditor(
  topology: TopologyJSON | undefined,
  onTopologyChange = vi.fn()
): Promise<{ view: HTMLDivElement; onTopologyChange: ReturnType<typeof vi.fn> }> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <LearnerStartEditor
        questionId="design-a-queue"
        questionTitle="Design a Queue"
        topology={topology}
        onTopologyChange={onTopologyChange}
      />
    )
    // Flush a macrotask so lazy import() chains settle inside act() at mount.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return { view: container, onTopologyChange }
}

async function clickAndFlush(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // Flush a macrotask so lazy import() chains (FlowCanvas + panels) settle inside act().
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function buttonNamed(view: HTMLElement, name: string): HTMLButtonElement {
  const button = [...view.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(name)
  )
  if (!button) throw new Error(`Could not find button named ${name}`)
  return button
}

describe('LearnerStartEditor', () => {
  it('loads a stored topology into the production canvas store and serializes the next edit', async () => {
    const { view, onTopologyChange } = await renderEditor(SCAFFOLD)

    expect(view.querySelector('[data-testid="flow-canvas-mock"]')).toBeTruthy()
    expect(view.textContent).toContain('1 nodes · 0 edges')
    expect(useStore.getState().nodes.map((node) => node.id)).toEqual(['traffic'])

    await clickAndFlush(buttonNamed(view, 'Open canvas workspace'))

    await clickAndFlush(buttonNamed(view, 'API server'))

    expect(onTopologyChange).toHaveBeenCalled()
    const stored = onTopologyChange.mock.calls.at(-1)?.[0] as TopologyJSON
    expect(stored.id).toBe('question-scaffold')
    expect(stored.nodes.map((node) => node.type)).toEqual(['api-endpoint', 'microservice'])
    expect(stored.workload?.sourceNodeId).toBe('traffic')
  })

  it('keeps the project in blank-canvas mode until the canvas has a valid source', async () => {
    const { view, onTopologyChange } = await renderEditor(undefined)

    await clickAndFlush(buttonNamed(view, 'Create starting topology'))

    await clickAndFlush(buttonNamed(view, 'API server'))
    expect(view.textContent).toContain('Canvas not stored yet')
    expect(onTopologyChange).not.toHaveBeenCalled()

    await clickAndFlush(buttonNamed(view, 'Traffic source'))
    expect(onTopologyChange).toHaveBeenCalled()
    expect((onTopologyChange.mock.calls.at(-1)?.[0] as TopologyJSON).nodes).toHaveLength(2)
  })
})
