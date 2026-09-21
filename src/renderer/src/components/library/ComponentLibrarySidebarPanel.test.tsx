// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { QuestionPackage } from '../../../../engine/analysis/question'
import useStore from '../../store/useStore'
import { ComponentLibrarySidebarPanel } from './ComponentLibrarySidebarPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  useStore.setState({ activeQuestion: null })
  container?.remove()
  root = null
  container = null
})

function render(): HTMLDivElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ComponentLibrarySidebarPanel
        query=""
        filter="all"
        onQueryChange={() => {}}
        onFilterChange={() => {}}
      />
    )
  )
  return container
}

describe('ComponentLibrarySidebarPanel with a question allow-list', () => {
  it('shows only the canonical item per allowed type and hides the Common/All tabs', () => {
    useStore.setState({
      activeQuestion: {
        constraints: {
          allowedNodeTypes: ['api-endpoint', 'microservice', 'load-balancer-l7']
        },
        scaffold: {}
      } as unknown as QuestionPackage
    })

    const view = render()
    const text = view.textContent ?? ''

    // The author's three picks, one canonical item each.
    expect(text).toContain('Client App')
    expect(text).toContain('API Server')
    expect(text).toContain('Load Balancer L7')

    // Same-type templates / placeholders / builders must NOT leak through.
    expect(text).not.toContain('ID Generator')
    expect(text).not.toContain('My Service')
    expect(text).not.toContain('Traffic Source')
    expect(text).not.toContain('Custom Node')

    // No Common/All scoping tabs when a curated allow-list is active.
    const tabLabels = [...view.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(tabLabels).not.toContain('Common')
    expect(tabLabels).not.toContain('All')
  })

  it('keeps the full palette and the Common/All tabs when there is no allow-list', () => {
    useStore.setState({ activeQuestion: null })

    const view = render()
    const tabLabels = [...view.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(tabLabels).toContain('Common')
    expect(tabLabels).toContain('All')
  })
})
