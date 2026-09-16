import { memo, useId } from 'react'
import { Position } from 'reactflow'
import type { ConnectionLineComponentProps } from 'reactflow'
import useStore from '@renderer/store/useStore'
import { snapStateRef } from './hooks/useMagneticSnap'
import { getCanvasEdgePath } from './edgePathGeometry'

function inferToPosition(fromX: number, fromY: number, toX: number, toY: number): Position {
  const dx = toX - fromX
  const dy = toY - fromY
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? Position.Left : Position.Right
  }
  return dy > 0 ? Position.Top : Position.Bottom
}

const MagneticConnectionLine = memo(
  ({
    fromX,
    fromY,
    toX,
    toY,
    fromPosition,
    toPosition,
    connectionStatus
  }: ConnectionLineComponentProps) => {
    const directionMarkerId = useId().replace(/:/g, '')
    const edgeRoutingStyle = useStore((state) => state.displaySettings.edgeRoutingStyle)
    const { lerpTarget, winner } = snapStateRef.current

    const effectiveToX = lerpTarget?.x ?? toX
    const effectiveToY = lerpTarget?.y ?? toY
    const effectiveToPosition = winner
      ? inferToPosition(fromX, fromY, effectiveToX, effectiveToY)
      : toPosition

    const { path: dPath } = getCanvasEdgePath(
      {
        sourceX: fromX,
        sourceY: fromY,
        sourcePosition: fromPosition ?? Position.Right,
        targetX: effectiveToX,
        targetY: effectiveToY,
        targetPosition: effectiveToPosition
      },
      edgeRoutingStyle
    )

    const isSnapping = winner !== null
    // connectionStatus === 'valid' means React Flow will commit the connection on release.
    // Magnetic snap uses the same radius, but this fallback keeps the affordance consistent
    // if React Flow reports a valid drop before a snap winner is available.
    const canDrop = connectionStatus === 'valid'

    const stroke = canDrop || isSnapping ? '#3b82f6' : '#f59e0b'
    const guideStroke =
      canDrop || isSnapping ? 'rgba(59, 130, 246, 0.22)' : 'rgba(245, 158, 11, 0.2)'
    const strokeWidth = canDrop ? 3 : isSnapping ? 2.75 : 2.5

    // Use the winner's exact handle position when available; otherwise render the affordance
    // at the current connection target so valid drops always get feedback.
    const snapX = winner?.x ?? effectiveToX
    const snapY = winner?.y ?? effectiveToY

    return (
      <g>
        <defs>
          <marker
            id={directionMarkerId}
            viewBox="0 0 12 12"
            refX="9"
            refY="6"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path
              d="M 2 2.25 L 8.5 6 L 2 9.75"
              fill="none"
              stroke={stroke}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <path
          d={dPath}
          fill="none"
          stroke={guideStroke}
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={dPath}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={canDrop || isSnapping ? undefined : '6 3'}
          markerEnd={`url(#${directionMarkerId})`}
          vectorEffect="non-scaling-stroke"
          style={{ transition: 'stroke 100ms, stroke-width 100ms' }}
        />

        {/* Magnetic approach - small dot shows where the line will land */}
        {isSnapping && !canDrop && (
          <circle cx={effectiveToX} cy={effectiveToY} r={4} fill={stroke} opacity={0.8} />
        )}

        {/* Drop zone reached - pulsing ring + solid dot at exact handle center */}
        {canDrop && (
          <>
            {/* Outer pulsing ring */}
            <circle
              className="connection-snap-ring"
              cx={snapX}
              cy={snapY}
              r={10}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={1.5}
            />
            {/* Inner solid dot */}
            <circle cx={snapX} cy={snapY} r={5} fill="#3b82f6" opacity={0.95} />
          </>
        )}
      </g>
    )
  }
)

MagneticConnectionLine.displayName = 'MagneticConnectionLine'

export default MagneticConnectionLine
