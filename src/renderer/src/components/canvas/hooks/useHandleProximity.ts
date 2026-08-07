import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi, internalsSymbol } from 'reactflow'
import { getMagneticRadiusInFlowUnits } from '../magneticSnapConfig'
import { snapStateRef } from './useMagneticSnap'

/** Max scale applied to a source handle at zero distance. */
const MAX_SCALE = 1.8

interface HandleBound {
  id: string | null
  x: number
  y: number
  width: number
  height: number
}

export function useHandleProximity() {
  const storeApi = useStoreApi()
  const glowedRef = useRef<Map<string, HTMLElement>>(new Map())
  const rafRef = useRef<number | undefined>(undefined)

  const cancelPendingFrame = useCallback(() => {
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = undefined
    }
  }, [])

  const clearAll = useCallback(() => {
    glowedRef.current.forEach((el) => {
      el.style.removeProperty('--prox-scale')
      el.style.removeProperty('--prox-intensity')
      el.classList.remove('proximity-source')
    })
    glowedRef.current.clear()
  }, [])

  const mouseMoveHandler = useCallback(
    (e: MouseEvent) => {
      // Defer to the drag system while a connection drag is in progress
      if (snapStateRef.current.candidates.length > 0) {
        cancelPendingFrame()
        clearAll()
        return
      }

      cancelPendingFrame()
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = undefined
        const { transform, domNode, nodeInternals } = storeApi.getState()
        if (!domNode) return

        const proximityRadius = getMagneticRadiusInFlowUnits(transform[2])
        const bounds = domNode.getBoundingClientRect()

        // Cursor outside canvas - clear and bail
        if (
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        ) {
          clearAll()
          return
        }

        const flowX = (e.clientX - bounds.left - transform[0]) / transform[2]
        const flowY = (e.clientY - bounds.top - transform[1]) / transform[2]

        // Find the single closest source handle within the shared interaction radius.
        let minDist = Infinity
        let winner: { domId: string; dist: number } | null = null

        nodeInternals.forEach((node) => {
          if (node.type === 'vpcNode') return

          const internals = node[internalsSymbol as unknown as keyof typeof node] as
            | { handleBounds?: { source?: HandleBound[]; target?: HandleBound[] } }
            | undefined
          const sourceHandles = internals?.handleBounds?.source
          if (!sourceHandles) return

          const absX = node.positionAbsolute?.x ?? node.position.x
          const absY = node.positionAbsolute?.y ?? node.position.y

          for (const h of sourceHandles) {
            const hx = absX + h.x + h.width / 2
            const hy = absY + h.y + h.height / 2
            const dist = Math.sqrt((hx - flowX) ** 2 + (hy - flowY) ** 2)
            if (dist < proximityRadius && dist < minDist) {
              minDist = dist
              winner = { domId: `${node.id}-${h.id}-source`, dist }
            }
          }
        })

        const nextGlowed = new Map<string, HTMLElement>()

        if (winner) {
          const { domId, dist } = winner as { domId: string; dist: number }
          const el = domNode.querySelector<HTMLElement>(`[data-id="${domId}"]`)
          if (el) {
            const norm = dist / proximityRadius
            el.style.setProperty('--prox-scale', String(1 + (1 - norm) * (MAX_SCALE - 1)))
            el.style.setProperty('--prox-intensity', String(0.5 + (1 - norm) * 0.5))
            el.classList.add('proximity-source')
            nextGlowed.set(domId, el)
          }
        }

        // Clear any previously highlighted handle that is no longer the winner
        glowedRef.current.forEach((el, id) => {
          if (!nextGlowed.has(id)) {
            el.style.removeProperty('--prox-scale')
            el.style.removeProperty('--prox-intensity')
            el.classList.remove('proximity-source')
          }
        })

        glowedRef.current = nextGlowed
      })
    },
    [storeApi, cancelPendingFrame, clearAll]
  )

  useEffect(() => {
    document.addEventListener('mousemove', mouseMoveHandler, { passive: true })
    return () => {
      document.removeEventListener('mousemove', mouseMoveHandler)
      cancelPendingFrame()
      clearAll()
    }
  }, [mouseMoveHandler, cancelPendingFrame, clearAll])
}
