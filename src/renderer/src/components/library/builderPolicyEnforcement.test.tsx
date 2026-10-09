// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import sample from '../../../../engine/__samples__/basic-cache-stack.json'
import { migrateCanvasNodes } from '../../../../engine/catalog/legacyCanvasMigration'
import { AUTHOR_ENVIRONMENT_PROFILE } from '../../../../engine/analysis/environmentProfile'
import type { QuestionPackage } from '../../../../engine/analysis/question'
import type { BuilderPolicy } from '../../../../engine/analysis/builderPolicy'
import { DEFINITIONS_LOCKED_REASON } from '../../../../engine/analysis/builderPolicy'
import {
  createDefaultTraits,
  defaultServiceOperations,
  type CustomNodeDefinition
} from '../../../../engine/catalog/customDefinitions'
import type { SimulationAccess } from '../../../../shared/commands/types'
import useStore from '../../store/useStore'
import { convertNestedToFlat, type NestedFileData } from '@renderer/utils/nodeTransformers'
import { builderPolicyAdmissionBlock } from '@renderer/utils/builderPolicyContext'
import { createAppTerminalDeps } from '../terminal/appTerminalDeps'
import { ContextualAddPicker } from '../canvas/ContextualAddPicker'
import { ComponentLibrarySidebarPanel } from './ComponentLibrarySidebarPanel'
import { CustomDefinitionCreator } from './CustomDefinitionCreator'
import { ImportTopologyDialog } from '../topology/ImportTopologyDialog'
import { BuilderPolicyEditor } from '../authoring/BuilderPolicyEditor'
import {
  DEFAULT_QUESTION_AUTHORING_SETUP,
  type QuestionAuthoringSetupDraft
} from '../../../../engine/analysis/questionAuthoringProject'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

function question(builderPolicy?: BuilderPolicy): QuestionPackage {
  return {
    id: 'q-policy',
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    scaffold: { type: 'empty' },
    ...(builderPolicy ? { builderPolicy } : {})
  } as unknown as QuestionPackage
}

function service(): CustomNodeDefinition {
  return {
    kind: 'service',
    runtimeTemplate: 'long-running-service',
    name: 'Orders',
    traits: createDefaultTraits('long-running-service'),
    operations: defaultServiceOperations()
  }
}

function definitionNode(id: string, definition: CustomNodeDefinition = service()): Node {
  return {
    id,
    type: 'serviceNode',
    position: { x: 0, y: 0 },
    data: { label: id, componentType: 'microservice', customDefinition: definition, sim: {} }
  }
}

function render(element: React.JSX.Element): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return container
}

function setPolicy(builderPolicy?: BuilderPolicy, runCount = 0): void {
  useStore.setState({
    activeQuestion: builderPolicy === undefined ? null : question(builderPolicy),
    attemptState: null,
    scaffoldNodeIds: [],
    questionRunCount: runCount,
    builderPolicyNotice: null
  })
}

beforeEach(() => {
  useStore.getState().setGraph([], [], { history: 'skip', resetHistory: true })
  setPolicy(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  setPolicy(undefined)
})

describe('palette builder tiles', () => {
  const renderPanel = () =>
    render(
      <ComponentLibrarySidebarPanel
        query=""
        filter="all"
        onQueryChange={() => {}}
        onFilterChange={() => {}}
      />
    )

  it('without a policy every builder tile is enabled and no policy note shows', () => {
    const view = renderPanel()
    expect(view.querySelector('[aria-label="Builder policy"]')).toBeNull()
    expect(view.querySelectorAll('[aria-disabled="true"]')).toHaveLength(0)
  })

  it('disables a forbidden builder and shows why', () => {
    setPolicy({ allowServiceBuilder: false })
    const view = renderPanel()
    const note = view.querySelector('[aria-label="Builder policy"]')
    expect(note?.textContent).toContain(
      'Service builder: This question does not allow the Service builder.'
    )
    expect(note?.textContent).toContain('My Services')
    expect(note?.textContent).not.toContain('Custom Node builder:')
    expect(view.querySelectorAll('[aria-disabled="true"]').length).toBeGreaterThanOrEqual(2)
  })

  it('disables builders once the definition cap is reached', () => {
    setPolicy({ maxDefinitions: 1 })
    useStore.getState().setGraph([definitionNode('svc')], [], { history: 'skip' })
    const view = renderPanel()
    expect(view.querySelector('[aria-label="Builder policy"]')?.textContent).toContain('at most 1')
  })
})

describe('builder modal restrictions', () => {
  it('offers only allowed runtimes and marks disallowed traits', () => {
    setPolicy({
      allowedRuntimeTemplates: ['background-worker'],
      allowedTraitPacks: ['capacity', 'workload-profile']
    })
    const view = render(<CustomDefinitionCreator mode="service" onClose={() => {}} />)
    const text = view.ownerDocument.body.textContent ?? ''
    expect(text).toContain('Background worker')
    expect(text).not.toContain('Long-running service')
    expect(text).not.toContain('Serverless function')
    expect(text).toContain('Not allowed by this question')
  })
})

describe('contextual add picker', () => {
  it('never offers builder tiles, so it cannot create definitions', () => {
    Element.prototype.scrollIntoView ??= () => {}
    setPolicy({})
    useStore.getState().setGraph([definitionNode('svc')], [], { history: 'skip' })
    const view = render(
      <ContextualAddPicker
        request={{ mode: 'connected', anchorNodeId: 'svc' } as never}
        anchor={useStore.getState().nodes[0]}
        position={{ left: 0, top: 0 }}
        onPick={() => {}}
        onClose={() => {}}
      />
    )
    const text = view.textContent ?? ''
    expect(view.querySelectorAll('[data-index]').length).toBeGreaterThan(0)
    expect(text).not.toContain('Custom Node')
    expect(text).not.toContain('My Service')
  })
})

describe('store and paste enforcement', () => {
  it('addNode refuses a definition the policy forbids and says why', () => {
    setPolicy({ allowServiceBuilder: false })
    useStore.getState().addNode(definitionNode('svc'))
    expect(useStore.getState().nodes).toHaveLength(0)
    expect(useStore.getState().builderPolicyNotice).toContain('Service builder')
  })

  it('addNode is unchanged without a policy', () => {
    useStore.getState().addNode(definitionNode('svc'))
    expect(useStore.getState().nodes).toHaveLength(1)
  })

  it('paste counts pasted definitions against the cap', () => {
    setPolicy({ maxDefinitions: 1 })
    useStore.getState().setGraph([definitionNode('svc')], [], { history: 'skip' })
    expect(builderPolicyAdmissionBlock(useStore.getState(), [definitionNode('copy')])).toContain(
      'at most 1'
    )
    expect(builderPolicyAdmissionBlock(useStore.getState(), [])).toBeNull()
  })

  it('lockDefinitionsAfterFirstRun makes the definition read-only after a run', () => {
    setPolicy({ lockDefinitionsAfterFirstRun: true })
    useStore.getState().setGraph([definitionNode('svc')], [], { history: 'skip' })
    useStore
      .getState()
      .updateNodeData('svc', { customDefinition: { ...service(), description: 'a' } })
    expect(
      (useStore.getState().nodes[0].data as { customDefinition: CustomNodeDefinition })
        .customDefinition.description
    ).toBe('a')

    useStore.getState().recordQuestionRun()
    useStore
      .getState()
      .updateNodeData('svc', { customDefinition: { ...service(), description: 'b' } })
    expect(
      (useStore.getState().nodes[0].data as { customDefinition: CustomNodeDefinition })
        .customDefinition.description
    ).toBe('a')
    expect(useStore.getState().builderPolicyNotice).toBe(DEFINITIONS_LOCKED_REASON)
    // Choosing another question resets the per-session run count.
    useStore.getState().setActiveQuestion({ ...question({}), id: 'other' })
    expect(useStore.getState().questionRunCount).toBe(0)
  })
})

describe('terminal config commands', () => {
  const idleSim = {
    state: () => ({ status: 'idle' }),
    run: () => null
  } as unknown as SimulationAccess

  function loadSampleWithDefinitionOnApi(): void {
    const canvas = structuredClone(sample) as unknown as NestedFileData
    const nodes = migrateCanvasNodes(convertNestedToFlat(canvas.nodes)).map((node) =>
      node.id === 'api' ? { ...node, data: { ...node.data, customDefinition: service() } } : node
    )
    useStore.getState().setGraph(nodes, (canvas.edges ?? []) as Edge[], {
      history: 'skip',
      resetHistory: true
    })
  }

  it('refuses trait-backed settings on a locked created node, and allows them otherwise', () => {
    useStore.setState({ environmentProfile: AUTHOR_ENVIRONMENT_PROFILE })
    loadSampleWithDefinitionOnApi()
    setPolicy({ lockDefinitionsAfterFirstRun: true }, 1)
    const deps = createAppTerminalDeps(idleSim, { color: false })
    const locked = deps.config!.set('api', 'timeout', '4321')
    expect(locked).toMatchObject({ ok: false })
    expect((locked as { reason: string }).reason).toContain(DEFINITIONS_LOCKED_REASON)

    setPolicy(undefined)
    expect(deps.config!.set('api', 'timeout', '4321')).toMatchObject({ ok: true })
  })
})

describe('import path', () => {
  it('keeps a violating imported design and lists the findings with a fix', async () => {
    setPolicy({ allowServiceBuilder: false })
    const file = { nodes: [definitionNode('imported-svc')], edges: [] }
    const view = render(
      <ImportTopologyDialog
        onClose={() => {}}
        onImport={async (canvas) => {
          useStore.getState().setGraph((canvas as { nodes: Node[] }).nodes, [], {
            history: 'skip',
            resetHistory: true
          })
          return true
        }}
      />
    )
    const textarea = view.querySelector('textarea')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(textarea, JSON.stringify(file))
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const importButton = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'Import'
    )!
    await act(async () => {
      importButton.click()
    })
    expect(useStore.getState().nodes.map((node) => node.id)).toEqual(['imported-svc'])
    const text = view.textContent ?? ''
    expect(text).toContain("Breaks this question's builder policy")
    expect(text).toContain('Fix: Delete')
  })
})

describe('Question Studio builder policy editor', () => {
  it('edits the policy on the setup draft and clears it back to no policy', () => {
    let setup: QuestionAuthoringSetupDraft = structuredClone(DEFAULT_QUESTION_AUTHORING_SETUP)
    const rerender = () =>
      act(() =>
        root?.render(<BuilderPolicyEditor setup={setup} onChange={(next) => (setup = next)} />)
      )
    render(<BuilderPolicyEditor setup={setup} onChange={(next) => (setup = next)} />)
    const checkbox = (label: string) =>
      [...container!.querySelectorAll('label')]
        .find((candidate) => candidate.textContent?.trim().startsWith(label))!
        .querySelector('input')!

    act(() => checkbox('Allow Custom Node builder').click())
    expect(setup.builderPolicy).toEqual({ allowCustomNodeBuilder: false })
    rerender()
    act(() => checkbox('Restrict runtimes').click())
    expect(setup.builderPolicy?.allowedRuntimeTemplates).toHaveLength(10)
    rerender()
    act(() =>
      (
        container!.querySelector('[aria-label="Allow Serverless function"]') as HTMLInputElement
      ).click()
    )
    expect(setup.builderPolicy?.allowedRuntimeTemplates).not.toContain('serverless-function')
    rerender()
    act(() => checkbox('Restrict runtimes').click())
    rerender()
    act(() => checkbox('Allow Custom Node builder').click())
    expect(setup.builderPolicy).toBeUndefined()
  })
})
