// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import useStore from '@renderer/store/useStore'
import { stopFailoverReplay } from '../canvas/failoverReplay'
import { useReplicationView } from '../canvas/replicationViewStore'
import { ReplicationReplayControl } from './ReplicationReplayControl'
import { ReplicationViewSection } from './ReplicationViewSection'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(element))
  return container
}

afterEach(() => {
  stopFailoverReplay()
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  useStore.setState({ lastRunOutput: null, runtimeResultsStale: false })
  useReplicationView.setState({
    routing: false,
    replication: true,
    lag: true,
    animation: true,
    clusterCollapsed: false
  })
})

const replicationData = { sim: { replicationEnabled: true, replicationRole: 'leader' } } as never

describe('ReplicationViewSection', () => {
  it('toggles the canvas view options and renders nothing for non-replicated nodes', () => {
    const view = mount(<ReplicationViewSection data={replicationData} />)
    const boxes = view.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
    expect(boxes).toHaveLength(5)
    expect(boxes[0].checked).toBe(false)
    act(() => boxes[0].click())
    expect(useReplicationView.getState().routing).toBe(true)
    act(() => boxes[3].click())
    expect(useReplicationView.getState().animation).toBe(false)
    act(() => boxes[4].click())
    expect(useReplicationView.getState().clusterCollapsed).toBe(true)

    act(() => root!.render(<ReplicationViewSection data={{ sim: {} } as never} />))
    expect(view.querySelector('section')).toBeNull()
  })
})

describe('ReplicationReplayControl', () => {
  it('is hidden without a failover timeline', () => {
    const view = mount(<ReplicationReplayControl />)
    expect(view.querySelector('button')).toBeNull()
  })

  it('starts and stops the replay from the inspector', () => {
    useStore.setState({
      lastRunOutput: {
        simulationDuration: 4000,
        replicationTimeline: [{ atMs: 1000, type: 'leader-down', nodeId: 'p' }]
      } as never
    })
    const view = mount(<ReplicationReplayControl />)
    const button = view.querySelector('button')!
    expect(button.textContent).toContain('Replay')
    act(() => button.click())
    expect(useReplicationView.getState().replayMs).toBe(0)
    expect(view.querySelector('button')!.textContent).toContain('Stop')
    act(() => view.querySelector('button')!.click())
    expect(useReplicationView.getState().replayMs).toBeNull()
  })
})
