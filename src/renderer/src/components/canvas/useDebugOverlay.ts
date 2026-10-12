import { useMemo } from 'react'
import useStore from '@renderer/store/useStore'
import { useRequestDebugSession } from '../debugger/useRequestDebugSession'
import type { RequestLifecycle } from '../debugger/requestLifecycle'

/**
 * Canvas state for the request debugger overlay (#158). Separate from the live
 * utilization styling: this only exists while one request is being debugged.
 */
export interface CanvasDebugState {
  active: boolean
  pathNodeIds: Set<string>
  pathEdgeIds: Set<string>
  /** Container nodes (regions / VPCs) holding a path node; kept undimmed. */
  containerNodeIds: Set<string>
  currentNodeId: string | null
  currentEdgeId: string | null
  highlightMode: 'active' | 'rejected'
  /** Nodes / edges where the request ended in failure (red ring once reached). */
  rejectedNodeId: string | null
  rejectedEdgeId: string | null
}

export const INACTIVE_CANVAS_DEBUG_STATE: CanvasDebugState = {
  active: false,
  pathNodeIds: new Set(),
  pathEdgeIds: new Set(),
  containerNodeIds: new Set(),
  currentNodeId: null,
  currentEdgeId: null,
  highlightMode: 'active',
  rejectedNodeId: null,
  rejectedEdgeId: null
}

export function buildCanvasDebugState(
  lifecycle: RequestLifecycle | null,
  stepIndex: number,
  parentOf: (nodeId: string) => string | null = () => null
): CanvasDebugState {
  const step = lifecycle?.steps[stepIndex]
  if (!lifecycle || !step) return INACTIVE_CANVAS_DEBUG_STATE
  const pathNodeIds = new Set(lifecycle.actualPath)
  const containerNodeIds = new Set<string>()
  for (const nodeId of pathNodeIds) {
    let parent = parentOf(nodeId)
    let guard = 0
    while (parent && !containerNodeIds.has(parent) && guard++ < 16) {
      containerNodeIds.add(parent)
      parent = parentOf(parent)
    }
  }
  const failureReached =
    lifecycle.failureStepIndex !== null && stepIndex >= lifecycle.failureStepIndex
  const failureStep =
    lifecycle.failureStepIndex !== null ? lifecycle.steps[lifecycle.failureStepIndex] : null
  return {
    active: true,
    pathNodeIds,
    pathEdgeIds: new Set(lifecycle.actualEdgeIds),
    containerNodeIds,
    currentNodeId: step.nodeId,
    currentEdgeId: step.edgeId,
    highlightMode: step.failed ? 'rejected' : 'active',
    rejectedNodeId: failureReached ? (failureStep?.nodeId ?? null) : null,
    rejectedEdgeId: failureReached ? (failureStep?.edgeId ?? null) : null
  }
}

export function useDebugOverlay(): CanvasDebugState & {
  lifecycle: RequestLifecycle | null
  stepIndex: number
} {
  const { lifecycle, stepIndex } = useRequestDebugSession()
  const nodes = useStore((state) => state.nodes)
  const parentById = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of nodes) {
      const parent = (node as { parentNode?: string; parentId?: string }).parentNode
      if (parent) map.set(node.id, parent)
    }
    return map
  }, [nodes])
  const state = useMemo(
    () => buildCanvasDebugState(lifecycle, stepIndex, (id) => parentById.get(id) ?? null),
    [lifecycle, parentById, stepIndex]
  )
  return { ...state, lifecycle, stepIndex }
}

function escapeAttr(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/["\\]/g, '\\$&')
}

const nodeSel = (id: string) => `.react-flow__node[data-id="${escapeAttr(id)}"]`
const edgeSel = (id: string) => `.react-flow__edge[data-testid="rf__edge-${escapeAttr(id)}"]`

/**
 * The overlay's CSS. Highlights are attribute selectors on React Flow's own
 * node / edge wrappers, so node and edge components are untouched and React
 * Flow selection keeps working; removing the style element removes every trace.
 */
export function buildDebugOverlayCss(state: CanvasDebugState): string {
  if (!state.active) return ''
  const rules: string[] = []
  const keep = [...state.pathNodeIds, ...state.containerNodeIds]
  rules.push(
    `.react-flow__node{transition:opacity 160ms ease;opacity:.38!important}`,
    keep.length > 0 ? `${keep.map(nodeSel).join(',')}{opacity:1!important}` : '',
    `.react-flow__edge{transition:opacity 160ms ease;opacity:.28!important}`,
    state.pathEdgeIds.size > 0
      ? `${[...state.pathEdgeIds].map(edgeSel).join(',')}{opacity:1!important}`
      : ''
  )
  const ring = (color: string) =>
    `{box-shadow:0 0 0 2px rgb(var(${color})),0 0 0 6px rgb(var(${color}) / .28)!important;border-color:rgb(var(${color}))!important}`
  if (state.rejectedNodeId) {
    rules.push(`${nodeSel(state.rejectedNodeId)}>*${ring('--nss-danger')}`)
  }
  if (state.currentNodeId) {
    const color = state.highlightMode === 'rejected' ? '--nss-danger' : '--nss-primary'
    rules.push(
      `${nodeSel(state.currentNodeId)}>*${ring(color)}`,
      `${nodeSel(state.currentNodeId)}{translate:0 -2px;z-index:1001!important}`
    )
  }
  const edgeGlow = (id: string, color: string) =>
    `${edgeSel(id)} .react-flow__edge-path{stroke:rgb(var(${color}))!important;stroke-width:5px!important;filter:drop-shadow(0 0 4px rgb(var(${color}) / .7))}`
  if (state.rejectedEdgeId) rules.push(edgeGlow(state.rejectedEdgeId, '--nss-danger'))
  if (state.currentEdgeId) {
    rules.push(
      edgeGlow(
        state.currentEdgeId,
        state.highlightMode === 'rejected' ? '--nss-danger' : '--nss-primary'
      )
    )
  }
  return rules.filter(Boolean).join('\n')
}
