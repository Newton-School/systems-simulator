import { useReactFlow, useViewport } from 'reactflow'
import { X } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { buildDebugOverlayCss, useDebugOverlay } from './useDebugOverlay'

const PACKET_PX = 13

/**
 * Canvas overlay for the request lifecycle debugger (#158): dims everything off
 * the debugged request's path, rings the current (blue) and rejecting (red)
 * node, glows the active edge, and moves a packet dot to the current step's
 * node or edge midpoint. Renders nothing - and leaves no styles behind - unless
 * a request is open in the debugger.
 */
export function RequestDebugOverlay() {
  const overlay = useDebugOverlay()
  const { getNode } = useReactFlow()
  const { x: viewportX, y: viewportY, zoom } = useViewport()
  const setRequestDebug = useStore((state) => state.setRequestDebug)
  const { lifecycle, stepIndex } = overlay

  if (!overlay.active || !lifecycle) return null
  const step = lifecycle.steps[stepIndex]

  const center = (nodeId: string): { x: number; y: number } | null => {
    const node = getNode(nodeId)
    if (!node) return null
    const pos = node.positionAbsolute ?? node.position
    return { x: pos.x + (node.width ?? 256) / 2, y: pos.y + (node.height ?? 100) / 2 }
  }

  let packet: { x: number; y: number } | null = null
  if (step?.nodeId) {
    packet = center(step.nodeId)
  } else if (step?.edgeId) {
    const edge = useStore.getState().edges.find((candidate) => candidate.id === step.edgeId)
    const from = edge ? center(edge.source) : null
    const to = edge ? center(edge.target) : null
    packet = from && to ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : (from ?? to)
  }
  const labelOf = (nodeId: string): string => {
    const label = (getNode(nodeId)?.data as { label?: unknown } | undefined)?.label
    return typeof label === 'string' && label.length > 0 ? label : nodeId
  }
  const failed = step?.failed === true
  const size = PACKET_PX / zoom

  return (
    <>
      <style data-nss-request-debug-overlay="">{buildDebugOverlayCss(overlay)}</style>
      {packet && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <div
            style={{
              transform: `translate(${viewportX}px, ${viewportY}px) scale(${zoom})`,
              transformOrigin: '0 0'
            }}
          >
            <div
              data-testid="request-debug-packet"
              className="absolute left-0 top-0 rounded-full"
              style={{
                width: size,
                height: size,
                transform: `translate(${packet.x - size / 2}px, ${packet.y - size / 2}px)`,
                transition: 'transform 320ms ease-in-out',
                backgroundColor: failed ? 'rgb(var(--nss-danger))' : 'rgb(var(--nss-primary))',
                boxShadow: `0 0 0 ${2 / zoom}px var(--nss-panel), 0 0 ${10 / zoom}px ${
                  failed ? 'rgb(var(--nss-danger) / .8)' : 'rgb(var(--nss-primary) / .8)'
                }`
              }}
            />
          </div>
        </div>
      )}
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex max-w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-2 rounded-full border border-nss-border bg-nss-panel/95 px-3 py-1.5 text-[11px] text-nss-text shadow-lg backdrop-blur">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${failed ? 'bg-nss-danger' : 'bg-nss-primary'}`}
        />
        <span className="truncate">
          Debugging <span className="font-mono">{lifecycle.requestId}</span> - step {stepIndex + 1}/
          {lifecycle.steps.length}: {step?.label}
          {step?.nodeId ? ` at ${labelOf(step.nodeId)}` : step?.edgeId ? ` on ${step.edgeId}` : ''}
        </span>
        <button
          type="button"
          onClick={() => setRequestDebug(null)}
          aria-label="Stop debugging"
          className="shrink-0 rounded p-0.5 text-nss-muted hover:text-nss-danger"
        >
          <X size={12} />
        </button>
      </div>
    </>
  )
}
