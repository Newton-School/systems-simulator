import { useCallback, useEffect, useRef, useState } from 'react'
import type { Viewport } from 'reactflow'
import useStore from '@renderer/store/useStore'
import type {
  AnnotationPoint,
  AnnotationTool,
  ArrowAnnotation,
  CanvasAnnotation,
  InkAnnotation
} from '@renderer/types/annotations'

interface CanvasAnnotationLayerProps {
  activeTool: AnnotationTool | null
  viewport: Viewport
}

const PEN_COLOR = '#2563eb'
const LASER_COLOR = '#ef4444'
const HIGHLIGHTER_COLOR = '#facc15'
const NOTE_COLOR = '#fef3c7'
const LASER_LIFETIME_MS = 1800

interface LaserStroke {
  id: string
  kind: 'laser'
  color: string
  points: AnnotationPoint[]
  width: number
}

type AnnotationDraft = InkAnnotation | ArrowAnnotation | LaserStroke

function annotationId(kind: CanvasAnnotation['kind'] | 'laser'): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function pathFromPoints(points: AnnotationPoint[]): string {
  if (points.length === 0) return ''
  return points.reduce(
    (path, point, index) =>
      `${path}${index === 0 ? 'M' : ' L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`,
    ''
  )
}

export function CanvasAnnotationLayer({
  activeTool,
  viewport
}: CanvasAnnotationLayerProps): React.JSX.Element | null {
  const annotations = useStore((state) => state.annotations)
  const addAnnotation = useStore((state) => state.addAnnotation)
  const updateNoteAnnotation = useStore((state) => state.updateNoteAnnotation)
  const removeAnnotation = useStore((state) => state.removeAnnotation)
  const [draft, setDraftState] = useState<AnnotationDraft | null>(null)
  const [laserStrokes, setLaserStrokes] = useState<LaserStroke[]>([])
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const draftRef = useRef<AnnotationDraft | null>(null)
  const laserTimersRef = useRef<Set<number>>(new Set())
  const drawing =
    activeTool === 'pen' ||
    activeTool === 'laser' ||
    activeTool === 'highlighter' ||
    activeTool === 'arrow'
  const interactive = drawing || activeTool === 'note' || activeTool === 'eraser'

  const setDraft = useCallback((next: AnnotationDraft | null) => {
    draftRef.current = next
    setDraftState(next)
  }, [])

  useEffect(
    () => () => {
      for (const timer of laserTimersRef.current) {
        window.clearTimeout(timer)
      }
    },
    []
  )

  const toFlowPoint = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): AnnotationPoint => {
      const bounds = event.currentTarget.getBoundingClientRect()
      return {
        x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
        y: (event.clientY - bounds.top - viewport.y) / viewport.zoom,
        ...(event.pressure > 0 ? { pressure: event.pressure } : {})
      }
    },
    [viewport]
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!activeTool || activeTool === 'eraser') return
      if (event.pointerType === 'mouse' && event.button !== 0) return

      event.preventDefault()
      const point = toFlowPoint(event)

      if (activeTool === 'note') {
        const id = annotationId('note')
        addAnnotation({
          id,
          kind: 'note',
          color: NOTE_COLOR,
          position: point,
          text: ''
        })
        setEditingNoteId(id)
        return
      }

      event.currentTarget.setPointerCapture(event.pointerId)

      if (activeTool === 'arrow') {
        setDraft({
          id: annotationId('arrow'),
          kind: 'arrow',
          color: PEN_COLOR,
          start: point,
          end: point,
          width: 2.5
        })
        return
      }

      if (activeTool === 'laser') {
        setDraft({
          id: annotationId('laser'),
          kind: 'laser',
          color: LASER_COLOR,
          points: [point],
          width: 4
        })
        return
      }

      setDraft({
        id: annotationId(activeTool),
        kind: activeTool,
        color: activeTool === 'highlighter' ? HIGHLIGHTER_COLOR : PEN_COLOR,
        points: [point],
        width: activeTool === 'highlighter' ? 14 : 2.5
      })
    },
    [activeTool, addAnnotation, setDraft, toFlowPoint]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const current = draftRef.current
      if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
      event.preventDefault()
      const point = toFlowPoint(event)

      if (current.kind === 'arrow') {
        setDraft({ ...current, end: point })
      } else {
        setDraft({ ...current, points: [...current.points, point] })
      }
    },
    [setDraft, toFlowPoint]
  )

  const finishDrawing = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const current = draftRef.current
      if (!current) return
      event.preventDefault()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      const shouldKeep =
        current.kind === 'arrow'
          ? Math.hypot(current.end.x - current.start.x, current.end.y - current.start.y) > 4
          : current.points.length > 1

      if (current.kind === 'laser') {
        if (shouldKeep) {
          setLaserStrokes((strokes) => [...strokes, current])
          const timer = window.setTimeout(() => {
            setLaserStrokes((strokes) => strokes.filter((stroke) => stroke.id !== current.id))
            laserTimersRef.current.delete(timer)
          }, LASER_LIFETIME_MS)
          laserTimersRef.current.add(timer)
        }
        setDraft(null)
        return
      }

      if (shouldKeep) addAnnotation(current)
      setDraft(null)
    },
    [addAnnotation, setDraft]
  )

  if (!interactive && annotations.length === 0 && laserStrokes.length === 0) return null

  const rendered = draft && draft.kind !== 'laser' ? [...annotations, draft] : annotations
  const renderedLaserStrokes = draft?.kind === 'laser' ? [...laserStrokes, draft] : laserStrokes
  const erase = (event: React.PointerEvent, id: string) => {
    if (activeTool !== 'eraser') return
    event.preventDefault()
    event.stopPropagation()
    removeAnnotation(id)
  }

  return (
    <svg
      aria-label="Canvas annotations"
      className={`absolute inset-0 z-20 h-full w-full ${interactive ? 'pointer-events-auto' : 'pointer-events-none'} ${activeTool === 'eraser' ? 'cursor-crosshair' : drawing ? 'cursor-crosshair' : ''}`}
      style={{
        touchAction: interactive ? 'none' : 'auto',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none'
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrawing}
      onPointerCancel={finishDrawing}
    >
      <defs>
        <marker
          id="nss-annotation-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill={PEN_COLOR} />
        </marker>
      </defs>
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {renderedLaserStrokes.map((stroke) => (
          <path
            key={stroke.id}
            d={pathFromPoints(stroke.points)}
            className={draft?.id === stroke.id ? undefined : 'nss-laser-stroke'}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="none"
          />
        ))}
        {rendered.map((annotation) => {
          if (annotation.kind === 'pen' || annotation.kind === 'highlighter') {
            return (
              <path
                key={annotation.id}
                d={pathFromPoints(annotation.points)}
                fill="none"
                stroke={annotation.color}
                strokeWidth={annotation.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={annotation.kind === 'highlighter' ? 0.35 : 0.95}
                pointerEvents={activeTool === 'eraser' ? 'stroke' : 'none'}
                onPointerDown={(event) => erase(event, annotation.id)}
              />
            )
          }

          if (annotation.kind === 'arrow') {
            return (
              <line
                key={annotation.id}
                x1={annotation.start.x}
                y1={annotation.start.y}
                x2={annotation.end.x}
                y2={annotation.end.y}
                stroke={annotation.color}
                strokeWidth={annotation.width}
                strokeLinecap="round"
                markerEnd="url(#nss-annotation-arrow)"
                pointerEvents={activeTool === 'eraser' ? 'stroke' : 'none'}
                onPointerDown={(event) => erase(event, annotation.id)}
              />
            )
          }

          if (annotation.kind === 'note')
            return (
              <foreignObject
                key={annotation.id}
                x={annotation.position.x}
                y={annotation.position.y}
                width="196"
                height="116"
                pointerEvents={
                  activeTool === null || activeTool === 'note' || activeTool === 'eraser'
                    ? 'all'
                    : 'none'
                }
                style={{ overflow: 'visible' }}
                onPointerDown={(event) => {
                  if (activeTool === 'eraser') {
                    erase(event, annotation.id)
                    return
                  }
                  event.stopPropagation()
                  setEditingNoteId(annotation.id)
                }}
              >
                <div
                  className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-amber-500/70 shadow-md"
                  style={{ backgroundColor: annotation.color }}
                >
                  <div className="flex h-7 shrink-0 items-center justify-between border-b border-amber-500/30 px-3 text-[9px] font-semibold uppercase tracking-widest text-amber-800/70">
                    Note
                    <span aria-hidden="true" className="text-amber-700/40">
                      •••
                    </span>
                  </div>
                  <textarea
                    aria-label="Sticky note text"
                    autoFocus={editingNoteId === annotation.id}
                    value={annotation.text}
                    placeholder="Type a note…"
                    spellCheck
                    onChange={(event) => updateNoteAnnotation(annotation.id, event.target.value)}
                    onFocus={() => setEditingNoteId(annotation.id)}
                    onBlur={() => setEditingNoteId(null)}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-[13px] leading-relaxed text-amber-950 outline-none placeholder:text-amber-800/45"
                  />
                </div>
              </foreignObject>
            )

          return null
        })}
      </g>
    </svg>
  )
}
