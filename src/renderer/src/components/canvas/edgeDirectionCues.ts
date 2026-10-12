/**
 * Direction cues for canvas edges: the arrowhead at the target end, extra
 * chevrons along long edges, and a minimum on-screen stroke width.
 *
 * Edges are drawn in flow units, so at fit-to-view on a large diagram (zoom
 * 0.3 to 0.5) a 2-unit stroke and a 5-unit arrowhead shrink to under a pixel or
 * two and the direction of flow disappears. These helpers keep the cues at a
 * legible screen size when zoomed out, and leave them alone at 100% and above.
 */

/** Largest zoom-out compensation (applies at zoom 1/3 and below). */
export const MAX_DIRECTION_CUE_SCALE = 3
/** Smallest on-screen stroke width for an idle edge, in pixels. */
export const MIN_SCREEN_STROKE_PX = 1.5
/** Target on-screen spacing between direction chevrons along an edge, in pixels. */
export const CHEVRON_SPACING_SCREEN_PX = 160
const MAX_MID_CHEVRONS = 3
/** Keep chevrons clear of the label that sits at the middle of the edge. */
const LABEL_CLEARANCE = 0.14

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * How much to enlarge cues (in flow units) so they keep their on-screen size
 * when zoomed out. Quantized to quarter steps so edges only re-render when the
 * zoom crosses a step, not on every wheel tick.
 */
export function directionCueScale(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return 1
  const raw = clamp(1 / zoom, 1, MAX_DIRECTION_CUE_SCALE)
  return Math.round(raw * 4) / 4
}

/** Stroke width in flow units that renders at least MIN_SCREEN_STROKE_PX. */
export function legibleStrokeWidth(strokeWidth: number, cueScale: number): number {
  return Math.max(strokeWidth, MIN_SCREEN_STROKE_PX * cueScale)
}

/**
 * Positions (0..1 along the path) for direction chevrons in the body of an edge.
 * Short edges get none (the arrowhead is enough); long edges get one per
 * CHEVRON_SPACING_SCREEN_PX of on-screen length, up to three, skipping the
 * middle when a label sits there.
 */
export function midEdgeChevronPositions(
  pathLength: number,
  cueScale: number,
  { avoidCenter = false }: { avoidCenter?: boolean } = {}
): number[] {
  if (!Number.isFinite(pathLength) || pathLength <= 0) return []
  const spacing = CHEVRON_SPACING_SCREEN_PX * Math.max(1, cueScale)
  const count = Math.min(MAX_MID_CHEVRONS, Math.floor(pathLength / spacing) - 1)
  if (count <= 0) return []

  const positions = Array.from({ length: count }, (_, index) => (index + 1) / (count + 1))
  if (!avoidCenter) return positions

  const shifted = positions.map((position) =>
    Math.abs(position - 0.5) < LABEL_CLEARANCE ? 0.5 - LABEL_CLEARANCE * 1.5 : position
  )
  return Array.from(new Set(shifted.map((position) => Math.round(position * 1000) / 1000)))
}
