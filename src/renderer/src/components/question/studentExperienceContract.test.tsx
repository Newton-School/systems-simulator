// @vitest-environment jsdom
/**
 * Student experience contract.
 *
 * These tests pin product decisions about what a student sees and can do. They
 * fail when a default, flag, or visibility setting changes that experience, so
 * such a change cannot ride along unnoticed in an unrelated commit (as it did in
 * #293 and 9f995ee). If one fails, do not just update the expected value: the
 * change needs Hritvik's sign-off and its own PR.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge } from 'reactflow'
import sample from '../../../../engine/__samples__/basic-cache-stack.json'
import { migrateCanvasNodes } from '../../../../engine/catalog/legacyCanvasMigration'
import {
  canTriggerTestRun,
  resolveEnvironmentProfile,
  shouldShowRubricResults
} from '../../../../engine/analysis/environmentProfile'
import {
  createAttemptState,
  gradeAttempt,
  recordDryRunGrade,
  type QuestionPackage
} from '../../../../engine/analysis/question'
import type { TopologyJSON } from '../../../../engine/core/types'
import { runSimulation } from '../../../../engine/runSimulation'
import useStore from '../../store/useStore'
import { useTopologySerializer } from '../../hooks/useTopologySerializer'
import { convertNestedToFlat, type NestedFileData } from '@renderer/utils/nodeTransformers'
import { QuestionPanel } from './QuestionPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

/** A blank-canvas question with one check the sample passes and one it fails. */
function question(): QuestionPackage {
  return {
    version: '1.0',
    id: 'student-contract',
    title: 'Student contract',
    difficulty: 'beginner',
    type: 'open-build',
    entryFormat: 'blank-canvas',
    prompt: {
      text: 'Build an order service.',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    structuralRules: [
      { id: 'single-source', kind: 'requires_single_source', description: 'One source.' },
      {
        id: 'needs-gateway',
        kind: 'requires_component',
        componentType: 'api-gateway',
        description: 'Use an API gateway.'
      }
    ],
    suite: { name: 'suite', visibleToStudent: false, cases: [{ id: 'private' }] },
    rubric: {
      checks: [
        {
          id: 'throughput',
          kind: 'simulation',
          description: 'Serve traffic.',
          metric: 'summary.throughput',
          op: '>=',
          value: 0,
          points: 1
        }
      ]
    }
  } as QuestionPackage
}

function loadSampleCanvas(): void {
  const canvas = structuredClone(sample) as unknown as NestedFileData
  useStore
    .getState()
    .setGraph(
      migrateCanvasNodes(convertNestedToFlat(canvas.nodes)),
      (canvas.edges ?? []) as Edge[],
      {
        history: 'skip',
        resetHistory: true
      }
    )
}

/** Reads the canvas topology through the same serializer the panel uses. */
function serializeCanvas(): TopologyJSON {
  let topology: TopologyJSON | null = null
  const Probe = (): null => {
    topology = useTopologySerializer().serialize().topology
    return null
  }
  render(<Probe />)
  act(() => root?.unmount())
  container?.remove()
  if (!topology) throw new Error('Canvas did not serialize.')
  return topology
}

/** An Assignment attempt that has already used many test runs, like a reopened attempt. */
function assignmentAfterTestRuns(visibility?: 'HIDDEN' | 'POST_SUBMIT_ONLY'): void {
  const pkg = question()
  const topology = serializeCanvas()
  let attempt = createAttemptState({ questionId: pkg.id, topology, now: '2026-10-15T00:00:00Z' })
  const grade = gradeAttempt(pkg, topology, runSimulation)
  for (let run = 0; run < 18; run++) {
    attempt = recordDryRunGrade(attempt, { topology, grade, now: '2026-10-15T00:00:00Z' })
  }
  useStore.setState({
    activeQuestion: pkg,
    attemptState: attempt,
    resultsRevealed: false,
    environmentProfile: resolveEnvironmentProfile(
      visibility ? { mode: 'ASSIGNMENT', visibility: { rubricChecks: visibility } } : 'ASSIGNMENT'
    )
  })
}

function render(element: React.JSX.Element): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return container
}

function button(view: HTMLElement, label: string): HTMLButtonElement {
  const match = [...view.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === label
  )
  if (!match) throw new Error(`No "${label}" button.`)
  return match as HTMLButtonElement
}

function openTests(view: HTMLElement): void {
  const tab = [...view.querySelectorAll('button')].find((element) =>
    element.textContent?.trim().startsWith('Tests')
  )
  if (!tab) throw new Error('No Tests tab.')
  act(() => tab.click())
}

beforeEach(() => {
  vi.stubGlobal(
    'Worker',
    class {
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage(): void {
        return undefined
      }
      terminate(): void {
        return undefined
      }
    }
  )
  useStore.getState().setGraph([], [], { history: 'skip', resetHistory: true })
  loadSampleCanvas()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
  useStore.setState({ activeQuestion: null, attemptState: null, resultsRevealed: false })
})

describe('student experience contract: Assignment mode', () => {
  it('keeps test runs unlimited, even when a host sends a cap', () => {
    expect(canTriggerTestRun(resolveEnvironmentProfile('ASSIGNMENT'), { testRunCount: 999 })).toBe(
      true
    )
    expect(
      canTriggerTestRun(
        resolveEnvironmentProfile({ mode: 'ASSIGNMENT', capabilities: { maxTestRuns: 1 } }),
        { testRunCount: 999 }
      )
    ).toBe(true)
  })

  it('shows check results after a test run, before submitting', () => {
    expect(
      shouldShowRubricResults(resolveEnvironmentProfile('ASSIGNMENT'), { hasSubmittedGrade: false })
    ).toBe(true)
  })

  it('shows pass and fail results after many test runs, with Run & Evaluate still enabled', () => {
    assignmentAfterTestRuns()
    const view = render(<QuestionPanel />)
    openTests(view)

    expect(view.textContent).toContain('Test runs: 18')
    expect(view.textContent).toMatch(/1 passed · 1 failed/)
    expect(view.textContent).not.toContain('Until you run it')
    expect(button(view, 'Run & Evaluate').disabled).toBe(false)
  })

  it('says results are hidden, never "pending until you run it", when a host hides them', () => {
    assignmentAfterTestRuns('HIDDEN')
    const view = render(<QuestionPanel />)
    openTests(view)

    expect(view.textContent).toContain('Check results are hidden for this assignment.')
    expect(view.textContent).not.toContain('Until you run it')
  })
})

describe('student experience contract: question layout', () => {
  it('opens the brief on the question itself, with no entry-format workflow card', () => {
    assignmentAfterTestRuns()
    const view = render(<QuestionPanel />)

    expect(view.textContent).toContain('Build an order service.')
    expect(view.textContent).not.toMatch(/Blank-Canvas Workflow|Current Focus/i)
  })

  it('has no workflow strip above the canvas', () => {
    // The strip (format badges, steps, "Current Focus", "Authored checks") was
    // removed in #294 after being rejected; guidance lives only in the side panel.
    const sources = import.meta.glob<string>(['../../**/*.tsx', '!../../**/*.test.tsx'], {
      query: '?raw',
      import: 'default',
      eager: true
    })
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    const offenders = Object.entries(sources)
      .filter(([, source]) =>
        /QuestionExperienceStrip|SHOW_ENTRY_FORMAT_WORKFLOW|Current Focus/.test(source)
      )
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it.each(['Run & Evaluate', 'Submit'])('opens Tests after clicking %s', (action) => {
    assignmentAfterTestRuns()
    const view = render(<QuestionPanel />)

    expect(view.textContent).toContain('Build an order service.')
    act(() => button(view, action).click())

    expect(view.textContent).not.toContain('Build an order service.')
    expect(
      [...view.querySelectorAll('h3')].some((heading) => heading.textContent?.trim() === 'Tests')
    ).toBe(true)
  })
})

describe('student experience contract: Classroom mode', () => {
  it('opens the standalone and deployed simulator in Classroom mode', () => {
    // Approved 2026-10-15 (Classroom mode Phase 0). Classroom only takes effect for a
    // question that states its numbers; otherwise the full simulator shows.
    expect(resolveEnvironmentProfile().abstraction).toBe('classroom')
  })

  it('keeps graded Newton assignments in Architect mode unless the host asks for Classroom', () => {
    // The backend grader must grade at the abstraction the student saw.
    expect(resolveEnvironmentProfile('ASSIGNMENT').abstraction).toBe('architect')
  })

  it('hides design checks in Classroom mode unless the question turns them on', () => {
    const sources = import.meta.glob<string>('../../hooks/useClassroom.ts', {
      query: '?raw',
      import: 'default',
      eager: true
    })
    const source = Object.values(sources)[0] ?? ''
    expect(source).toContain('classroom?.designChecks === true')
  })
})

describe('student experience contract: simple layout', () => {
  it('opens in the simple layout by default', async () => {
    const { DEFAULT_DISPLAY_SETTINGS } = await import('@renderer/types/ui')
    expect(DEFAULT_DISPLAY_SETTINGS.simpleShell).toBe(true)
  })

  it('moves people who never chose onto it, and keeps the choice of those who did', async () => {
    const { loadDisplaySettings } = await import('@renderer/utils/displaySettingsPersistence')
    const stored = (value: object) =>
      localStorage.setItem('nssimulator.display-settings', JSON.stringify(value))

    localStorage.clear()
    expect(loadDisplaySettings().simpleShell).toBe(true)

    // Saved before the layout became the default: the false was only the old default.
    stored({ theme: 'dark', simpleShell: false })
    expect(loadDisplaySettings().simpleShell).toBe(true)

    stored({ theme: 'dark', simpleShell: false, simpleShellChosen: true })
    expect(loadDisplaySettings().simpleShell).toBe(false)
    localStorage.clear()
  })
})
