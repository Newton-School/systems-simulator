// @vitest-environment jsdom
import { act, useReducer } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  authoringScenarioReducer,
  compileAuthoringScenario,
  createAuthoringFault,
  createAuthoringScenario,
  type AuthoringScenarioDraft
} from '../../../../engine/analysis/questionAuthoringScenario'
import type { TopologyJSON } from '../../../../engine/core/types'
import { buildFaultTargetOptionsFromTopology } from '@renderer/utils/faultTargets'
import { ScenarioSuiteEditor } from './ScenarioSuiteEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: readonly AuthoringScenarioDraft[] = []

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function component(id: string, type: string, zone?: string) {
  return {
    id,
    type,
    category: 'compute',
    role: 'processor',
    label: id.toUpperCase(),
    position: { x: 0, y: 0 },
    queue: { workers: 8, capacity: 64, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 1000 },
    ...(zone ? { placement: { regionId: 'region', availabilityZoneId: zone } } : {})
  }
}

const REFERENCE = {
  id: 'ref',
  name: 'ref',
  version: '1.0.0',
  global: {
    simulationDuration: 10_000,
    seed: 's',
    warmupDuration: 0,
    timeResolution: 'microsecond',
    defaultTimeout: 1000
  },
  nodes: [
    { ...component('client', 'api-endpoint'), role: 'source' },
    { ...component('lb', 'load-balancer'), role: 'router', placement: { regionId: 'region' } },
    component('api-a', 'microservice', 'az-a'),
    component('api-b', 'microservice', 'az-b'),
    component('cache', 'in-memory-cache', 'az-a')
  ],
  edges: [],
  locations: [
    { id: 'region', kind: 'region', label: 'us-east-1' },
    { id: 'az-a', kind: 'availability-zone', label: 'AZ A', parentId: 'region' },
    { id: 'az-b', kind: 'availability-zone', label: 'AZ B', parentId: 'region' }
  ],
  workload: {
    sourceNodeId: 'client',
    pattern: 'constant',
    baseRps: 100,
    requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 512 }]
  }
} as unknown as TopologyJSON

function renderEditor(initial: AuthoringScenarioDraft[], reference?: TopologyJSON) {
  function Harness() {
    const [scenarios, dispatch] = useReducer(authoringScenarioReducer, initial)
    latest = scenarios
    return (
      <ScenarioSuiteEditor
        scenarios={scenarios}
        onAction={dispatch}
        referenceTopology={reference}
      />
    )
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
  return container
}

function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function byLabel<T extends HTMLElement>(view: HTMLElement, label: string): T {
  const element = view.querySelector<T>(`[aria-label="${label}"]`)
  if (!element) throw new Error(`No element labelled ${label}`)
  return element
}

describe('fault targets from a topology', () => {
  it('groups components and fault domains with member counts, flagging caches', () => {
    expect(buildFaultTargetOptionsFromTopology(REFERENCE)).toEqual([
      { id: 'lb', label: 'LB (lb)', group: 'component' },
      { id: 'api-a', label: 'API-A (api-a)', group: 'component' },
      { id: 'api-b', label: 'API-B (api-b)', group: 'component' },
      { id: 'cache', label: 'CACHE (cache)', group: 'component', isCache: true },
      { id: 'region', label: 'Region: us-east-1 - 4 components', group: 'location' },
      { id: 'az-a', label: 'Availability zone: AZ A - 2 components', group: 'location' },
      { id: 'az-b', label: 'Availability zone: AZ B - 1 component', group: 'location' }
    ])
  })
})

describe('ScenarioSuiteEditor fault editor', () => {
  it('picks a fault domain from the reference design and offers cache flush only for caches', () => {
    const scenario = { ...createAuthoringScenario(), faults: [createAuthoringFault('fault-1')] }
    const view = renderEditor([scenario], REFERENCE)
    const target = byLabel<HTMLSelectElement>(view, 'Fault target')
    expect([...target.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Components',
      'Fault domains (fails every component inside)'
    ])

    choose(target, 'az-a')
    const faultType = byLabel<HTMLSelectElement>(view, 'Fault type')
    expect([...faultType.options].map((option) => option.value)).toEqual(['failure'])
    expect(view.textContent).toContain('Every component inside this domain fails together.')

    choose(target, 'cache')
    expect([...faultType.options].map((option) => option.value)).toEqual(['failure', 'cache-flush'])
    choose(faultType, 'cache-flush')
    expect(latest[0].faults![0]).toMatchObject({ targetId: 'cache', faultType: 'cache-flush' })

    // Picking a non-cache drops the flush back to a failure.
    choose(target, 'api-a')
    expect(latest[0].faults![0].faultType).toBe('crash')
  })

  it('keeps free text as a fallback and warns (not errors) for ids missing from the reference', () => {
    const scenario = {
      ...createAuthoringScenario(),
      faults: [{ ...createAuthoringFault('fault-1'), targetId: 'learner-only' }]
    }
    const view = renderEditor([scenario], REFERENCE)
    expect(byLabel<HTMLInputElement>(view, 'Fault target id').value).toBe('learner-only')
    expect(view.querySelector('[role="status"]')?.textContent).toMatch(
      /not in the reference design/
    )
    expect(compileAuthoringScenario(latest[0])).not.toBeNull()
  })

  it('exposes failure modes and in-flight policies in plain language', () => {
    const scenario = { ...createAuthoringScenario(), faults: [createAuthoringFault('fault-1')] }
    const view = renderEditor([scenario], REFERENCE)
    choose(byLabel<HTMLSelectElement>(view, 'Failure mode'), 'blackhole')
    choose(byLabel<HTMLSelectElement>(view, 'In-flight requests'), 'hang')
    choose(byLabel<HTMLSelectElement>(view, 'Recovery policy'), 'resume')
    choose(byLabel<HTMLSelectElement>(view, 'Fault recovery'), 'permanent')
    expect(latest[0].faults![0]).toMatchObject({
      mode: 'blackhole',
      inFlightPolicy: 'hang',
      recoveryPolicy: 'resume',
      duration: 'permanent'
    })
    expect(view.textContent).toContain('Stays down until the end of the run.')
  })

  it('switches a scenario to a chaos experiment and previews it on the reference design', () => {
    const view = renderEditor([createAuthoringScenario()], REFERENCE)
    const radio = [...view.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent === 'Chaos experiment'
    )!
    act(() => radio.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(latest[0].experiment).toEqual({ presets: [{ presetId: 'az-outage' }] })
    expect(view.querySelector('[data-testid="chaos-experiment-case"]')).not.toBeNull()
    expect(view.textContent).toContain('Steady state')
    expect(view.textContent).toContain('Fail AZ A')

    choose(byLabel<HTMLSelectElement>(view, 'Chaos experiment preset'), 'cache-stampede')
    expect(view.querySelector('[role="alert"]')?.textContent).toMatch(
      /reference design cannot run this experiment/
    )
    expect(compileAuthoringScenario(latest[0])?.experiment).toEqual({
      presets: [{ presetId: 'cache-stampede' }]
    })
  })
})
