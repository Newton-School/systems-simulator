import { describe, expect, it } from 'vitest'
import type { RequestTrace } from '../../../../engine/tracer'
import { buildRequestLifecycle } from '../debugger/requestLifecycle'
import {
  INACTIVE_CANVAS_DEBUG_STATE,
  buildCanvasDebugState,
  buildDebugOverlayCss
} from './useDebugOverlay'

const rejectedTrace: RequestTrace = {
  requestId: 'req-1',
  totalLatency: 2,
  status: 'rejected',
  spans: [],
  terminalReason: 'capacity_exceeded',
  phaseRecord: {
    bornAtUs: 0n,
    nodes: [
      { nodeId: 'api', nodeArrivalUs: 500n, serviceStartUs: 500n, departureUs: 1_000n },
      { nodeId: 'db', nodeArrivalUs: 1_500n }
    ],
    edges: [
      { edgeId: 'src-api', source: 'src', target: 'api', edgeInUs: 0n, edgeOutUs: 500n },
      { edgeId: 'api-db', source: 'api', target: 'db', edgeInUs: 1_000n, edgeOutUs: 1_500n }
    ],
    terminal: { timeUs: 1_500n, cause: 'queue_full', locus: 'db', locusKind: 'node' }
  }
}

describe('canvas debug overlay state', () => {
  const lifecycle = buildRequestLifecycle(rejectedTrace)!

  it('is inactive without a session', () => {
    expect(buildCanvasDebugState(null, 0)).toBe(INACTIVE_CANVAS_DEBUG_STATE)
    expect(buildDebugOverlayCss(INACTIVE_CANVAS_DEBUG_STATE)).toBe('')
  })

  it('marks the path, the current edge while in flight, and the container of a path node', () => {
    const inFlight = lifecycle.steps.findIndex((step) => step.edgeId === 'api-db')
    const state = buildCanvasDebugState(lifecycle, inFlight, (id) => (id === 'db' ? 'vpc' : null))
    expect([...state.pathNodeIds]).toEqual(['src', 'api', 'db'])
    expect([...state.pathEdgeIds]).toEqual(['src-api', 'api-db'])
    expect([...state.containerNodeIds]).toEqual(['vpc'])
    expect(state).toMatchObject({
      currentNodeId: null,
      currentEdgeId: 'api-db',
      highlightMode: 'active',
      rejectedNodeId: null
    })
  })

  it('switches to the rejected highlight at the failure step', () => {
    const state = buildCanvasDebugState(lifecycle, lifecycle.failureStepIndex!)
    expect(state).toMatchObject({
      currentNodeId: 'db',
      highlightMode: 'rejected',
      rejectedNodeId: 'db'
    })
    const css = buildDebugOverlayCss(state)
    expect(css).toContain('.react-flow__node{transition:opacity 160ms ease;opacity:.38!important}')
    expect(css).toContain('.react-flow__node[data-id="db"]>*')
    expect(css).toContain('--nss-danger')
    expect(css).toContain('.react-flow__edge[data-testid="rf__edge-api-db"]{opacity:1!important}')
  })
})
