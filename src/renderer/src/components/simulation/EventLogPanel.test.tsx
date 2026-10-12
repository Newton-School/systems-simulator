// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SimulationOutput } from '../../../../engine/analysis/output'
import {
  createEmptyEventCounts,
  type CanonicalEventRecord
} from '../../../../engine/core/event-stream'
import { fixtureRun } from '../../../../shared/commands/__tests__/fixtures'
import { EventLogPanel } from './EventLogPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

function render(output: SimulationOutput, onDebugRequest = vi.fn()) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<EventLogPanel output={output} onDebugRequest={onDebugRequest} />))
  return { container, onDebugRequest }
}

function typeFilter(text: string) {
  const input = container!.querySelector<HTMLInputElement>('input[aria-label="Filter events"]')!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function clickButton(label: string) {
  const button = [...container!.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label
  )
  if (!button) throw new Error(`No button '${label}'`)
  act(() => button.click())
}

function rows(listLabel: string) {
  return container!.querySelectorAll(`[aria-label="${listLabel}"] [role="listitem"]`)
}

/** A synthetic 30k-event run whose stream was capped at 25k, like a real large run. */
function largeOutput(): SimulationOutput {
  const base = fixtureRun()
  const stream: CanonicalEventRecord[] = []
  for (let sequence = 0; sequence < 25_000; sequence++) {
    const rejected = sequence % 50 === 49
    stream.push({
      sequence,
      timestampUs: String(sequence * 50),
      type: rejected ? 'request-rejected' : 'request-arrived',
      priority: 0,
      requestId: `req-${Math.floor(sequence / 5)}`,
      nodeId: sequence % 2 === 0 ? 'api' : 'db',
      reasonCode: rejected ? 'queue_full' : undefined,
      payload: {}
    })
  }
  const counts = createEmptyEventCounts()
  counts['request-arrived'] = 29_500
  counts['request-rejected'] = 500
  return { ...base, eventStream: stream, eventCountsByType: counts, requestOutcomes: [] }
}

describe('EventLogPanel', () => {
  it('defaults to the table, filters with the query syntax and shows status badges', () => {
    const output = fixtureRun()
    render(output)
    expect(container!.textContent).toContain(
      `All ${output.eventStream.length.toLocaleString()} events the run produced`
    )
    expect(rows('Events').length).toBeGreaterThan(0)

    const rejected = output.eventStream.filter((event) => event.type === 'request-rejected').length
    expect(rejected).toBeGreaterThan(0)
    typeFilter('status:rejected OR status:timeout')
    expect(container!.textContent).toContain(`${rejected.toLocaleString()} rejected`)
    expect(container!.textContent).toMatch(/of [\d,]+ events match/)

    typeFilter('status:nope')
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain(
      "Unknown status 'nope'"
    )
  })

  it('switches between all five display variants', () => {
    render(fixtureRun())
    clickButton('Requests')
    expect(rows('Requests').length).toBeGreaterThan(0)
    clickButton('Nodes')
    expect(container!.querySelectorAll('[role="meter"]').length).toBeGreaterThan(0)
    clickButton('Incidents')
    expect(rows('Incidents').length).toBeGreaterThan(0)
    clickButton('Waterfall')
    expect(container!.textContent).toMatch(/\d+ lanes over/)
    clickButton('Table')
    expect(rows('Events').length).toBeGreaterThan(0)
  })

  it('offers Debug request for a traced request and hands it to the caller', () => {
    const output = fixtureRun()
    const traced = output.traces[0]
    expect(traced).toBeDefined()
    const { onDebugRequest } = render(output)
    typeFilter(`request:${traced.requestId}`)
    const first = rows('Events')[0] as HTMLElement
    act(() => first.click())
    clickButton('Debug request')
    expect(onDebugRequest).toHaveBeenCalledWith(traced.requestId)
  })

  it('windows a 25k-event stream and says plainly that it is partial', () => {
    const started = performance.now()
    render(largeOutput())
    const elapsed = performance.now() - started
    expect(container!.textContent).toContain('Partial log: the first 25,000 of 30,000 events')
    // Only the rows in the viewport (plus overscan) are mounted.
    expect(rows('Events').length).toBeLessThan(40)
    typeFilter('node:db AND status:rejected OR node:api AND status:rejected')
    expect(container!.textContent).toContain('500 of 25,000 events match')
    expect(rows('Events').length).toBeLessThan(40)
    expect(elapsed).toBeLessThan(5_000)
  })
})
