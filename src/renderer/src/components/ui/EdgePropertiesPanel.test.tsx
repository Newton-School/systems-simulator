// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EdgePropertiesPanel, type EdgePropertiesPanelValue } from './EdgePropertiesPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

function renderPanel(
  props: Partial<Parameters<typeof EdgePropertiesPanel>[0]>,
  children?: ReactNode
): string {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const value: EdgePropertiesPanelValue = { label: '' }
  act(() => {
    root!.render(
      <EdgePropertiesPanel
        value={value}
        onChange={vi.fn()}
        onClose={vi.fn()}
        connectorOnly={false}
        readOnly={false}
        {...props}
      >
        {children}
      </EdgePropertiesPanel>
    )
  })
  return container.textContent ?? ''
}

describe('EdgePropertiesPanel', () => {
  it('renders the config form for an editable network edge with no real children', () => {
    // Reproduces the caller passing `{false}{undefined}` — a truthy array with no
    // renderable content. The config fields must still show (the reported bug).
    const text = renderPanel({}, [false, undefined])
    expect(text).toContain('Protocol')
  })

  it('renders provided children (e.g. metrics) instead of the config form', () => {
    const text = renderPanel({}, <div>EDGE METRICS HERE</div>)
    expect(text).toContain('EDGE METRICS HERE')
    expect(text).not.toContain('Protocol')
  })

  it('offers presentation-only protocol and interaction fields in connector mode', () => {
    const text = renderPanel({ connectorOnly: true }, [false, undefined])
    expect(text).toContain('only change its canvas presentation')
    expect(text).toContain('Protocol')
    expect(text).toContain('Interaction')
    expect(text).not.toContain('Bandwidth')
    expect(text).not.toContain('Packet Loss')
  })

  it('stores connector semantics as display metadata instead of simulation fields', () => {
    const onChange = vi.fn()
    renderPanel({ connectorOnly: true, onChange }, [false, undefined])
    const protocol = container?.querySelector<HTMLSelectElement>('#connector-edge-protocol')
    const mode = container?.querySelector<HTMLSelectElement>('#connector-edge-mode')

    act(() => {
      if (!protocol) return
      protocol.value = 'kafka'
      protocol.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ displayProtocol: 'kafka' })

    act(() => {
      if (!mode) return
      mode.value = 'asynchronous'
      mode.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ displayMode: 'asynchronous' })
  })

  it('disables all connector presentation fields when the edge is read-only', () => {
    renderPanel({ connectorOnly: true, readOnly: true }, [false, undefined])
    expect(container?.querySelector('fieldset')?.disabled).toBe(true)
    expect(container?.querySelector('input')?.matches(':disabled')).toBe(true)
    expect(container?.querySelector('#connector-edge-protocol')?.matches(':disabled')).toBe(true)
    expect(container?.querySelector('#connector-edge-mode')?.matches(':disabled')).toBe(true)
    expect(container?.querySelector('#edge-routing-style')?.matches(':disabled')).toBe(true)
  })

  it('offers a per-edge appearance override and can return to the canvas default', () => {
    const onChange = vi.fn()
    renderPanel({ value: { label: '', routingStyle: 'rounded' }, onChange })
    const select = container?.querySelector<HTMLSelectElement>('#edge-routing-style')

    expect(select?.value).toBe('rounded')
    act(() => {
      if (!select) return
      select.value = 'bezier'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ routingStyle: 'bezier' })

    act(() => {
      if (!select) return
      select.value = 'inherit'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ routingStyle: undefined })
  })
})
