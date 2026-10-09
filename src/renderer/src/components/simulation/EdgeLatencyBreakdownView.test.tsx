// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { EdgeLatencyBreakdownView } from './EdgeLatencyBreakdownView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
})

describe('EdgeLatencyBreakdownView', () => {
  it('lists each modeled component with its share and the link utilization', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <EdgeLatencyBreakdownView
          breakdown={{
            samples: 90,
            meanTotalMs: 200,
            maxLinkQueueMs: 250,
            meanMs: {
              propagationMs: 2,
              congestionMs: 0,
              transmissionMs: 100,
              linkQueueMs: 97,
              protocolOverheadMs: 1,
              connectionWaitMs: 0,
              handshakeMs: 0,
              batchWaitMs: 0,
              retransmissionMs: 0
            }
          }}
          linkUtilization={0.99}
        />
      )
    })
    const text = container.textContent ?? ''
    expect(text).toContain('Transmission')
    expect(text).toContain('100.0 ms')
    expect(text).toContain('50%')
    expect(text).toContain('Link queue')
    expect(text).toContain('Link utilization')
    expect(text).toContain('99.0%')
    expect(text).toContain('Longest link wait')
    // No fabricated jitter component.
    expect(text).not.toMatch(/^Jitter/m)
  })
})
