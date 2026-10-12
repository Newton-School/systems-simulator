import { describe, expect, it } from 'vitest'
import {
  directionCueScale,
  legibleStrokeWidth,
  MAX_DIRECTION_CUE_SCALE,
  midEdgeChevronPositions,
  MIN_SCREEN_STROKE_PX
} from './edgeDirectionCues'

describe('directionCueScale', () => {
  it('leaves cues alone at 100% zoom and above', () => {
    expect(directionCueScale(1)).toBe(1)
    expect(directionCueScale(1.8)).toBe(1)
  })

  it('compensates for zoom-out in quarter steps, up to a cap', () => {
    expect(directionCueScale(0.5)).toBe(2)
    expect(directionCueScale(0.4)).toBe(2.5)
    expect(directionCueScale(0.41)).toBe(2.5)
    expect(directionCueScale(0.1)).toBe(MAX_DIRECTION_CUE_SCALE)
  })

  it('falls back to 1 for a bad zoom', () => {
    expect(directionCueScale(0)).toBe(1)
    expect(directionCueScale(Number.NaN)).toBe(1)
  })
})

describe('legibleStrokeWidth', () => {
  it('keeps at least the minimum on-screen width when zoomed out', () => {
    const zoom = 0.4
    const width = legibleStrokeWidth(2, directionCueScale(zoom))
    expect(width * zoom).toBeGreaterThanOrEqual(MIN_SCREEN_STROKE_PX)
  })

  it('never thins a stroke', () => {
    expect(legibleStrokeWidth(4, 1)).toBe(4)
  })
})

describe('midEdgeChevronPositions', () => {
  it('adds no body chevrons to short edges', () => {
    expect(midEdgeChevronPositions(120, 1)).toEqual([])
  })

  it('spaces chevrons by on-screen length, capped at three', () => {
    expect(midEdgeChevronPositions(340, 1)).toEqual([0.5])
    expect(midEdgeChevronPositions(500, 1)).toEqual([1 / 3, 2 / 3])
    expect(midEdgeChevronPositions(5000, 1)).toHaveLength(3)
    // The same edge zoomed out to 40% is short on screen.
    expect(midEdgeChevronPositions(340, directionCueScale(0.4))).toEqual([])
  })

  it('keeps clear of a label in the middle of the edge', () => {
    const positions = midEdgeChevronPositions(340, 1, { avoidCenter: true })
    expect(positions).toHaveLength(1)
    expect(Math.abs(positions[0] - 0.5)).toBeGreaterThan(0.14)
  })
})
