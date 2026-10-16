// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConceptCard } from '../../../../engine/classroom/conceptCards'
import type { ClassroomSettings } from '../../../../engine/classroom/types'
import { ClassroomInspector } from './ClassroomInspector'

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderInspector(settings: ClassroomSettings): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ClassroomInspector
        card={getConceptCard('server')}
        componentType="microservice"
        settings={settings}
        peakRps={1_000}
        copies={2}
        onCopiesChange={vi.fn()}
        choices={{}}
        onChoiceChange={vi.fn()}
        canOpenArchitect={false}
        onOpenArchitect={null}
        guidedKnobs={[]}
        onGuidedKnobChange={null}
      />
    )
  )
  return container
}

describe('ClassroomInspector objective-driven controls', () => {
  it('locks copy count when scaling is not a lesson objective', () => {
    const view = renderInspector({
      givens: { microservice: { capacityRps: 100 } },
      objectives: [{ id: 'placement', statement: 'Place the service', concept: 'AS-03' }],
      controls: [
        {
          id: 'place-service',
          kind: 'place-component',
          label: 'Place the service',
          component: 'microservice',
          objectiveId: 'placement'
        }
      ]
    })
    expect(view.querySelector<HTMLInputElement>('input[aria-label="Copies"]')?.disabled).toBe(true)
    expect(view.textContent).toContain('not part of this lesson')
  })

  it('unlocks copy count only when an objective-backed copies control exists', () => {
    const view = renderInspector({
      givens: { microservice: { capacityRps: 100 } },
      objectives: [{ id: 'scaling', statement: 'Right-size the service', concept: 'SC-05' }],
      controls: [
        {
          id: 'scale-service',
          kind: 'copies',
          label: 'Choose copies',
          component: 'microservice',
          objectiveId: 'scaling'
        }
      ]
    })
    expect(view.querySelector<HTMLInputElement>('input[aria-label="Copies"]')?.disabled).toBe(false)
  })
})
