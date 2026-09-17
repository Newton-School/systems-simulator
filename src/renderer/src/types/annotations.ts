export interface AnnotationPoint {
  x: number
  y: number
  pressure?: number
}

interface CanvasAnnotationBase {
  id: string
  color: string
}

export interface InkAnnotation extends CanvasAnnotationBase {
  kind: 'pen' | 'highlighter'
  points: AnnotationPoint[]
  width: number
}

export interface ArrowAnnotation extends CanvasAnnotationBase {
  kind: 'arrow'
  start: AnnotationPoint
  end: AnnotationPoint
  width: number
}

export interface NoteAnnotation extends CanvasAnnotationBase {
  kind: 'note'
  position: AnnotationPoint
  text: string
}

export type CanvasAnnotation = InkAnnotation | ArrowAnnotation | NoteAnnotation

export type AnnotationTool = CanvasAnnotation['kind'] | 'laser' | 'eraser'
