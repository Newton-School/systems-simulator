import { describe, expect, it } from 'vitest'
import { internalsSymbol, Position, type Edge, type Node } from 'reactflow'
import { getCanvasEdgePath, getOctilinearPoints, resolveStoredEdgePath } from './edgePathGeometry'

const baseInput = {
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top
}

describe('edgePathGeometry', () => {
  it('creates a single direct segment in straight mode', () => {
    expect(getCanvasEdgePath(baseInput, 'straight')).toMatchObject({
      path: 'M 0,0L 100,100',
      labelX: 50,
      labelY: 50
    })
  })

  it('preserves the existing rounded orthogonal route in rounded mode', () => {
    const geometry = getCanvasEdgePath(baseInput, 'rounded')

    expect(geometry.path).toContain('Q')
    expect(geometry).toMatchObject({ labelX: 50, labelY: 50 })
  })

  it('creates sharp orthogonal and true bezier alternatives', () => {
    const sharp = getCanvasEdgePath(baseInput, 'orthogonal').path
    const rounded = getCanvasEdgePath(baseInput, 'rounded').path

    // React Flow represents a zero-radius corner with a degenerate Q command;
    // the control point and endpoint are identical, so it renders as a sharp turn.
    expect(sharp).toContain('Q 0,50 0,50')
    expect(sharp).not.toBe(rounded)
    expect(getCanvasEdgePath(baseInput, 'bezier').path).toContain('C')
  })

  it('keeps every octilinear segment horizontal, vertical, or 45 degrees', () => {
    const points = getOctilinearPoints(baseInput)

    expect(points.length).toBeGreaterThan(2)
    for (let index = 1; index < points.length; index++) {
      const dx = Math.abs(points[index].x - points[index - 1].x)
      const dy = Math.abs(points[index].y - points[index - 1].y)
      expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 0.001).toBe(true)
    }
    expect(getCanvasEdgePath(baseInput, 'octilinear').path).toContain('L')
  })

  it('reconstructs the exact base-edge path for the request tracer in every route style', () => {
    const sourceNode: Node = {
      id: 'source',
      position: { x: 10, y: 20 },
      positionAbsolute: { x: 10, y: 20 },
      width: 100,
      height: 60,
      data: {},
      [internalsSymbol]: {
        handleBounds: {
          source: [
            { id: 'right-source', x: 96, y: 26, width: 8, height: 8, position: Position.Right }
          ],
          target: []
        }
      }
    }
    const targetNode: Node = {
      id: 'target',
      position: { x: 220, y: 120 },
      positionAbsolute: { x: 220, y: 120 },
      width: 100,
      height: 60,
      data: {},
      [internalsSymbol]: {
        handleBounds: {
          source: [],
          target: [
            { id: 'left-target', x: -4, y: 26, width: 8, height: 8, position: Position.Left }
          ]
        }
      }
    }
    const edge: Edge = {
      id: 'source-target',
      source: sourceNode.id,
      target: targetNode.id,
      sourceHandle: 'right-source',
      targetHandle: 'left-target'
    }

    const routeStyles = ['straight', 'orthogonal', 'rounded', 'bezier', 'octilinear'] as const

    for (const routeStyle of routeStyles) {
      const tracedGeometry = resolveStoredEdgePath(edge, sourceNode, targetNode, routeStyle)
      const baseGeometry = getCanvasEdgePath(
        {
          sourceX: 114,
          sourceY: 50,
          targetX: 216,
          targetY: 150,
          sourcePosition: Position.Right,
          targetPosition: Position.Left
        },
        routeStyle
      )

      expect(tracedGeometry).not.toBeNull()
      expect(tracedGeometry).toMatchObject({
        sourceX: 114,
        sourceY: 50,
        targetX: 216,
        targetY: 150,
        path: baseGeometry.path
      })
    }
  })
})
