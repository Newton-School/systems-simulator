export const TEXT_LABEL_NODE_TYPE = 'textLabelNode'

export interface CanvasTextLabelData {
  text: string
}

export function isCanvasAnnotationNodeType(type?: string): boolean {
  return type === TEXT_LABEL_NODE_TYPE
}
