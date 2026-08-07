import { useCallback, useEffect, MutableRefObject } from 'react'
import { useStoreApi, internalsSymbol } from 'reactflow'
import type { OnConnectStartParams, Edge } from 'reactflow'
import { getMagneticRadiusInFlowUnits } from '../magneticSnapConfig'

interface HandleCandidate {
  nodeId: string
  /** React Flow data-id: "${nodeId}-${handleId}-${handleType}" */
  domId: string
  x: number
  y: number
}

export interface SnapState {
  candidates: HandleCandidate[]
  winner: HandleCandidate | null
  lerpTarget: { x: number; y: number } | null
  domCache: Map<string, HTMLElement>
}

/** Module-level singleton - safe because there is exactly one ReactFlowProvider. */
export const snapStateRef: MutableRefObject<SnapState> = {
  current: {
    candidates: [],
    winner: null,
    lerpTarget: null,
    domCache: new Map()
  }
}

function computeLerpT(dist: number, radius: number): number {
  const norm = Math.max(0, Math.min(1, dist / radius))
  return (1 - norm) * (1 - norm)
}

interface HandleBound {
  id: string | null
  x: number
  y: number
  width: number
  height: number
}

function buildCandidates(
  storeApi: ReturnType<typeof useStoreApi>,
  excludeNodeId: string,
  wantType: 'source' | 'target'
): HandleCandidate[] {
  const { nodeInternals } = storeApi.getState()
  const candidates: HandleCandidate[] = []

  nodeInternals.forEach((node) => {
    if (node.type === 'vpcNode') return
    if (node.id === excludeNodeId) return

    const internals = node[internalsSymbol as unknown as keyof typeof node] as
      | { handleBounds?: { source?: HandleBound[]; target?: HandleBound[] } }
      | undefined
    const handleBounds = internals?.handleBounds?.[wantType]
    if (!handleBounds) return

    const absX = node.positionAbsolute?.x ?? node.position.x
    const absY = node.positionAbsolute?.y ?? node.position.y

    for (const h of handleBounds) {
      candidates.push({
        nodeId: node.id,
        domId: `${node.id}-${h.id}-${wantType}`,
        x: absX + h.x + h.width / 2,
        y: absY + h.y + h.height / 2
      })
    }
  })

  return candidates
}

function buildDomCache(
  candidates: HandleCandidate[],
  domNode: HTMLElement
): Map<string, HTMLElement> {
  const cache = new Map<string, HTMLElement>()
  for (const c of candidates) {
    const el = domNode.querySelector<HTMLElement>(`[data-id="${c.domId}"]`)
    if (el) cache.set(c.domId, el)
  }
  return cache
}

export function clearGlows(domCache: Map<string, HTMLElement>): void {
  domCache.forEach((el) => {
    el.style.removeProperty('--magnetic-glow-alpha')
    el.style.removeProperty('--magnetic-scale')
    el.classList.remove('magnetic-nearby', 'magnetic-snap-winner')
  })
}

function activateSnap(
  storeApi: ReturnType<typeof useStoreApi>,
  excludeNodeId: string,
  wantType: 'source' | 'target',
  handleMouseMove: (e: MouseEvent) => void
): void {
  const candidates = buildCandidates(storeApi, excludeNodeId, wantType)
  const { domNode } = storeApi.getState()
  const domCache = domNode ? buildDomCache(candidates, domNode) : new Map<string, HTMLElement>()
  snapStateRef.current = { candidates, winner: null, lerpTarget: null, domCache }
  document.addEventListener('mousemove', handleMouseMove, { passive: true })
}

function deactivateSnap(handleMouseMove: (e: MouseEvent) => void): void {
  document.removeEventListener('mousemove', handleMouseMove)
  clearGlows(snapStateRef.current.domCache)
  snapStateRef.current = {
    candidates: [],
    winner: null,
    lerpTarget: null,
    domCache: new Map()
  }
}

export function useMagneticSnap() {
  const storeApi = useStoreApi()

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const { transform, domNode } = storeApi.getState()
      if (!domNode) return

      const snapRadius = getMagneticRadiusInFlowUnits(transform[2])
      const bounds = domNode.getBoundingClientRect()
      const flowX = (e.clientX - bounds.left - transform[0]) / transform[2]
      const flowY = (e.clientY - bounds.top - transform[1]) / transform[2]

      const { candidates, domCache } = snapStateRef.current

      // Compute distances to all candidates in one pass
      let minDist = Infinity
      let winner: HandleCandidate | null = null
      const distMap = new Map<string, number>()

      for (const c of candidates) {
        const dx = c.x - flowX
        const dy = c.y - flowY
        const dist = Math.sqrt(dx * dx + dy * dy)
        distMap.set(c.domId, dist)
        if (dist < minDist) {
          minDist = dist
          winner = c
        }
      }

      const inRange = minDist <= snapRadius
      const newWinner = inRange ? winner : null
      snapStateRef.current.winner = newWinner

      if (newWinner) {
        const t = computeLerpT(minDist, snapRadius)
        snapStateRef.current.lerpTarget = {
          x: flowX + (newWinner.x - flowX) * t,
          y: flowY + (newWinner.y - flowY) * t
        }
      } else {
        snapStateRef.current.lerpTarget = null
      }

      // Apply graduated glow to ALL candidates based on their distance
      for (const c of candidates) {
        const el = domCache.get(c.domId)
        if (!el) continue

        const dist = distMap.get(c.domId) ?? Infinity
        const isWinner = c.domId === newWinner?.domId

        if (dist < snapRadius) {
          const norm = dist / snapRadius
          // Winner gets stronger glow; nearby non-winners get lighter graduated glow
          const alpha = isWinner ? 0.6 + (1 - norm) * 0.4 : 0.35 + (1 - norm) * 0.2
          const scale = isWinner ? 1 + (1 - norm) * 0.8 : 1 + (1 - norm) * 0.3

          el.style.setProperty('--magnetic-glow-alpha', String(alpha))
          el.style.setProperty('--magnetic-scale', String(scale))
          el.classList.add('magnetic-nearby')
          el.classList.toggle('magnetic-snap-winner', isWinner)
        } else {
          el.style.removeProperty('--magnetic-glow-alpha')
          el.style.removeProperty('--magnetic-scale')
          el.classList.remove('magnetic-nearby', 'magnetic-snap-winner')
        }
      }
    },
    [storeApi]
  )

  // --- New connection drag (from handle) ---
  const onConnectStart = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, params: OnConnectStartParams) => {
      const handleType = (params.handleType as 'source' | 'target') ?? 'source'
      const wantType: 'source' | 'target' = handleType === 'source' ? 'target' : 'source'
      activateSnap(storeApi, params.nodeId ?? '', wantType, handleMouseMove)
    },
    [storeApi, handleMouseMove]
  )

  const onConnectEnd = useCallback(() => {
    deactivateSnap(handleMouseMove)
  }, [handleMouseMove])

  // --- Existing edge endpoint drag (reconnect) ---
  const onEdgeUpdateStart = useCallback(
    (_event: React.MouseEvent, edge: Edge, handleType: 'source' | 'target') => {
      const wantType = handleType
      const excludeNodeId = handleType === 'source' ? edge.source : edge.target
      activateSnap(storeApi, excludeNodeId, wantType, handleMouseMove)
    },
    [storeApi, handleMouseMove]
  )

  const onEdgeUpdateEnd = useCallback(() => {
    deactivateSnap(handleMouseMove)
  }, [handleMouseMove])

  useEffect(() => {
    return () => {
      deactivateSnap(handleMouseMove)
    }
  }, [handleMouseMove])

  return { onConnectStart, onConnectEnd, onEdgeUpdateStart, onEdgeUpdateEnd }
}
