import type { EdgeRoutingStyle } from '@renderer/types/ui'

export interface EdgeRoutingOption {
  value: EdgeRoutingStyle
  label: string
  shortLabel: string
  description: string
  /** Small preview path in a 72 × 32 view box. */
  previewPath: string
}

export const EDGE_ROUTING_OPTIONS: readonly EdgeRoutingOption[] = [
  {
    value: 'straight',
    label: 'Direct',
    shortLabel: 'Direct',
    description: 'One straight segment between the selected ports.',
    previewPath: 'M 7 25 L 65 7'
  },
  {
    value: 'orthogonal',
    label: 'Orthogonal',
    shortLabel: 'Square',
    description: 'Horizontal and vertical segments with sharp corners.',
    previewPath: 'M 7 25 H 36 V 7 H 65'
  },
  {
    value: 'rounded',
    label: 'Rounded orthogonal',
    shortLabel: 'Rounded',
    description: 'Horizontal and vertical segments with softened corners.',
    previewPath: 'M 7 25 H 30 Q 36 25 36 19 V 13 Q 36 7 42 7 H 65'
  },
  {
    value: 'bezier',
    label: 'Bézier',
    shortLabel: 'Bézier',
    description: 'A continuous curve between the selected ports.',
    previewPath: 'M 7 25 C 25 25 47 7 65 7'
  },
  {
    value: 'octilinear',
    label: 'Octilinear',
    shortLabel: 'Angular',
    description: 'Horizontal, vertical, and deliberate 45° segments.',
    previewPath: 'M 7 25 H 23 L 41 7 H 65'
  }
]

const ROUTING_STYLE_VALUES = new Set<EdgeRoutingStyle>(
  EDGE_ROUTING_OPTIONS.map((option) => option.value)
)

export function isEdgeRoutingStyle(value: unknown): value is EdgeRoutingStyle {
  return typeof value === 'string' && ROUTING_STYLE_VALUES.has(value as EdgeRoutingStyle)
}

/** `curved` was the original name for what was actually a rounded orthogonal route. */
export function normalizeEdgeRoutingStyle(
  value: unknown,
  fallback: EdgeRoutingStyle
): EdgeRoutingStyle {
  if (value === 'curved') return 'rounded'
  return isEdgeRoutingStyle(value) ? value : fallback
}

/** Resolve an optional per-edge override without allowing malformed runtime data through. */
export function resolveEdgeRoutingStyle(
  override: unknown,
  canvasDefault: EdgeRoutingStyle
): EdgeRoutingStyle {
  return isEdgeRoutingStyle(override) ? override : canvasDefault
}
