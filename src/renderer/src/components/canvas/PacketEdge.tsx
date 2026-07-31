import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseEdge, getSmoothStepPath, EdgeProps, EdgeLabelRenderer } from 'reactflow'
import type { AnyNodeData, EdgeSimulationData } from '@renderer/types/ui'
import { getEdgeModePresentation, inferCanvasEdgeMode } from '@renderer/config/edgeSemantics'
import useStore, { type EdgeFlowRunConfig, type EdgeFlowState } from '@renderer/store/useStore'
import { getRoutingPreviewSnapshot } from '@renderer/utils/routingStrategyPreview'
import { inferEdgeDefaults } from '../../../../engine/defaults/edgeDefaults'
import { patternMultiplier } from './edgeFlowPatterns'
import { resolveEdgeLensProjection } from './edgeLensPresentation'

const EDGE_VISUAL_WINDOW_MS = 3_000
const FAILED_PULSE_MS = 650
const MIN_STREAM_DURATION_MS = 2_200
const MAX_STREAM_DURATION_MS = 5_200
const FLOW_SUCCESS_COLOR = 'rgb(var(--nss-success))'
const FLOW_WARNING_COLOR = 'rgb(var(--nss-warning))'
const FLOW_DANGER_COLOR = 'rgb(var(--nss-danger))'
const FLOW_PRIMARY_COLOR = 'rgb(var(--nss-primary))'
const ROUTING_PREVIEW_DECISION_SAMPLE_LIMIT = 2_000
const EMPTY_EDGE_FLOW_BY_ID: Record<string, EdgeFlowState> = {}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function compressedPacketCount(arrivalRate: number): number {
  if (arrivalRate <= 0) return 0
  return clamp(Math.ceil(Math.log2(arrivalRate + 1) * 0.8), 2, 7)
}

function streamDurationForRate(arrivalRate: number): number {
  if (arrivalRate <= 0) return MAX_STREAM_DURATION_MS
  return clamp(
    MAX_STREAM_DURATION_MS - Math.log2(arrivalRate + 1) * 420,
    MIN_STREAM_DURATION_MS,
    MAX_STREAM_DURATION_MS
  )
}

function patternPacketCount(baseCount: number, multiplier: number): number {
  if (baseCount <= 0) return 0
  return clamp(Math.round(baseCount * clamp(multiplier, 0.35, 4)), 1, 14)
}

function hash01(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function packetOffset(
  pattern: EdgeFlowRunConfig['workload']['pattern'] | undefined,
  edgeId: string,
  index: number,
  count: number
): number {
  if (count <= 0) return 0
  const evenOffset = index / count
  if (pattern !== 'poisson') return evenOffset
  const jitter = (hash01(`${edgeId}:offset:${index}`) - 0.5) * 0.55
  return (((evenOffset + jitter) % 1) + 1) % 1
}

function packetSpeedJitter(
  pattern: EdgeFlowRunConfig['workload']['pattern'] | undefined,
  edgeId: string,
  index: number
): number {
  if (pattern !== 'poisson') return 1
  return 0.7 + hash01(`${edgeId}:speed:${index}`) * 0.75
}

export const PacketEdge = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
  selected
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16
  })

  const hasLabel = typeof label === 'string' && label.trim().length > 0
  const flow = useStore((state) => state.edgeFlowById[id])
  const flowStatus = useStore((state) => state.edgeFlowStatus)
  const metricLens = useStore((state) => state.metricLens)
  const runConfig = useStore((state) => state.edgeFlowRunConfig)
  const playback = useStore((state) => state.edgeFlowPlayback)
  const routingVisualization = useStore((state) => state.routingStrategyVisualization)
  const previewEdgeFlowById = useStore((state) =>
    state.routingStrategyVisualization?.sourceNodeId === source
      ? state.edgeFlowById
      : EMPTY_EDGE_FLOW_BY_ID
  )
  const nodes = useStore((state) => state.nodes)
  const edges = useStore((state) => state.edges)
  const metricsByNode = useStore((state) => state.simulationMetricsByNode)
  const sourceNodeData = nodes.find((node) => node.id === source)?.data as AnyNodeData | undefined
  const targetNodeData = nodes.find((node) => node.id === target)?.data as AnyNodeData | undefined
  const edgeData = (data ?? {}) as EdgeSimulationData
  const edgeMode = inferCanvasEdgeMode(edgeData, targetNodeData)
  const edgeModePresentation = getEdgeModePresentation(edgeMode)
  const routingPreview = useMemo(() => {
    if (!routingVisualization || routingVisualization.sourceNodeId !== source) return null

    const snapshot = getRoutingPreviewSnapshot({
      routingVisualization,
      edges,
      nodes,
      metricsByNode,
      edgeFlowById: previewEdgeFlowById,
      decisionSampleLimit: ROUTING_PREVIEW_DECISION_SAMPLE_LIMIT
    })
    if (!snapshot.targetEdgeIds.has(id)) return null

    const selectedCount = snapshot.countsByEdgeId[id] ?? 0
    return {
      selectedCount,
      totalCount: snapshot.totalCount,
      maxCount: snapshot.maxCount,
      requestCount: snapshot.requestCount,
      isSelected: selectedCount > 0
    }
  }, [edges, id, metricsByNode, nodes, previewEdgeFlowById, routingVisualization, source])
  const isRoutingPreviewEdge = routingPreview !== null
  const [now, setNow] = useState(() => Date.now())
  const pathRef = useRef<SVGPathElement | null>(null)
  const [pathLength, setPathLength] = useState(0)

  useEffect(() => {
    if (!isRoutingPreviewEdge && !flow && flowStatus !== 'running' && flowStatus !== 'complete') {
      return
    }
    const intervalId = window.setInterval(() => setNow(Date.now()), 33)
    return () => window.clearInterval(intervalId)
  }, [flow, flowStatus, isRoutingPreviewEdge])

  useEffect(() => {
    setPathLength(pathRef.current?.getTotalLength() ?? 0)
  }, [edgePath])

  const visibleEvents =
    flow?.recent.filter(
      (event) => now >= event.displayAtMs && now - event.displayAtMs <= EDGE_VISUAL_WINDOW_MS
    ) ?? []
  const failedPackets = visibleEvents
    .filter((event) => event.status !== 'success' && now - event.displayAtMs <= FAILED_PULSE_MS)
    .slice(-12)

  const isComplete = flowStatus === 'complete'
  const liveIncomingRate = Math.max(flow?.attemptedPerSecond ?? 0, flow?.avgAttemptedPerSecond ?? 0)
  const liveSuccessRate = Math.max(flow?.successPerSecond ?? 0, flow?.avgSuccessPerSecond ?? 0)
  const postRunPacketRate = flow?.avgPostWarmupSuccessPerSecond ?? 0
  const arrivedRequestCount = flow?.totalPostWarmupSuccess ?? 0
  const edgeDefaults = useMemo(
    () => inferEdgeDefaults(sourceNodeData, targetNodeData),
    [sourceNodeData, targetNodeData]
  )
  const lensProjection = useMemo(
    () =>
      resolveEdgeLensProjection({
        lens: metricLens,
        flow,
        config: (data ?? {}) as EdgeSimulationData,
        defaults: edgeDefaults
      }),
    [metricLens, flow, data, edgeDefaults]
  )
  const visualMultiplier = patternMultiplier(runConfig, playback, now, id, hash01)
  const steadyRequestRate = isComplete ? postRunPacketRate : liveSuccessRate
  const previewShare =
    routingPreview && routingPreview.totalCount > 0
      ? routingPreview.selectedCount / routingPreview.maxCount
      : 0
  const visualRequestRate = isRoutingPreviewEdge
    ? routingPreview?.isSelected
      ? 40 + previewShare * 140
      : 0
    : steadyRequestRate * visualMultiplier
  const basePacketCount = compressedPacketCount(steadyRequestRate)
  const streamPacketCount = isRoutingPreviewEdge
    ? routingPreview?.isSelected
      ? clamp(Math.round(2 + previewShare * 6), 2, 8)
      : 0
    : patternPacketCount(basePacketCount, visualMultiplier)
  const isInactiveAfterRun = flowStatus === 'complete' && !flow
  const hasFlow = isRoutingPreviewEdge
    ? Boolean(routingPreview?.isSelected)
    : isComplete
      ? arrivedRequestCount > 0
      : liveIncomingRate > 0
  const trafficStrokeWidth = isRoutingPreviewEdge
    ? hasFlow
      ? clamp(2.5 + previewShare * 1.2, 2.5, 3.7)
      : 2
    : hasFlow
      ? clamp(3 + Math.log2(visualRequestRate + 1) * 0.55, selected ? 3.5 : 3, 5)
      : selected
        ? 3
        : 2
  // Health severity drives the stroke colour and is computed independently of
  // the active lens, so a failing link stays red even under a non-error lens.
  const failureStroke =
    lensProjection.severity === 'crit'
      ? FLOW_DANGER_COLOR
      : lensProjection.severity === 'warn'
        ? FLOW_WARNING_COLOR
        : undefined
  // Node-first lenses (timeout, queue capacity) recede: the edge dims to its
  // identity and lets the nodes carry the lens.
  const lensRecedes = !isRoutingPreviewEdge && lensProjection.recedes
  const flowLabelText = isRoutingPreviewEdge
    ? routingPreview?.isSelected
      ? `${routingPreview.selectedCount}/${routingPreview.totalCount} preview`
      : 'not selected'
    : isInactiveAfterRun
      ? 'inactive'
      : lensProjection.headline
  const flowLabelSub = isRoutingPreviewEdge ? undefined : lensProjection.sub
  const flowLabelTitle = isRoutingPreviewEdge ? flowLabelText : lensProjection.why
  const showFlowLabel = isRoutingPreviewEdge || flowLabelText.length > 0
  const flowLabelClassName = [
    'rounded-full border px-2 py-0.5 text-[12px] font-semibold leading-none tracking-wide shadow-md',
    isRoutingPreviewEdge
      ? routingPreview?.isSelected
        ? 'border-nss-success/40 bg-nss-panel text-nss-success'
        : 'border-nss-border bg-nss-panel text-nss-muted'
      : isInactiveAfterRun
        ? 'border-nss-border bg-nss-panel text-nss-muted'
        : lensProjection.severity === 'crit'
          ? 'border-nss-danger/50 bg-nss-panel text-nss-danger'
          : lensProjection.severity === 'warn'
            ? 'border-nss-warning/50 bg-nss-panel text-nss-warning'
            : 'border-nss-primary/40 bg-nss-panel text-nss-primary'
  ].join(' ')

  const pointForProgress = (progress: number) => {
    if (!pathRef.current || pathLength <= 0) {
      return {
        x: sourceX + (targetX - sourceX) * progress,
        y: sourceY + (targetY - sourceY) * progress
      }
    }
    return pathRef.current.getPointAtLength(pathLength * progress)
  }

  return (
    <>
      {/* Glow halo — only visible when selected */}
      {selected && (
        <path
          d={edgePath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={8}
          strokeOpacity={0.25}
          strokeLinecap="round"
        />
      )}

      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: trafficStrokeWidth,
          strokeDasharray: edgeModePresentation.strokeDasharray,
          stroke: isRoutingPreviewEdge
            ? 'var(--nss-border-high)'
            : selected
              ? FLOW_PRIMARY_COLOR
              : (failureStroke ?? 'var(--nss-border-high)'),
          opacity: isRoutingPreviewEdge
            ? routingPreview?.isSelected
              ? 1
              : 0.28
            : isInactiveAfterRun || lensRecedes
              ? 0.28
              : 1
        }}
        interactionWidth={30}
      />

      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={0}
        pointerEvents="none"
        opacity={0}
      />

      {Array.from({ length: streamPacketCount }, (_, index) => {
        const speedJitter = packetSpeedJitter(runConfig?.workload.pattern, id, index)
        const duration = streamDurationForRate(visualRequestRate) / speedJitter
        const offset = packetOffset(runConfig?.workload.pattern, id, index, streamPacketCount)
        const progress = (((now / duration + offset) % 1) + 1) % 1
        const point = pointForProgress(progress)
        const opacity =
          progress < 0.08 ? progress / 0.08 : progress > 0.92 ? (1 - progress) / 0.08 : 1

        return (
          <circle
            key={`${id}-packet-${index}`}
            cx={point.x}
            cy={point.y}
            r={visualRequestRate > 150 ? 5.25 : 6.75}
            fill={FLOW_SUCCESS_COLOR}
            stroke="var(--nss-panel)"
            strokeWidth={1.25}
            opacity={clamp(opacity, 0, 0.95)}
            pointerEvents="none"
          />
        )
      })}

      {failedPackets.map((event) => {
        const progress = clamp((now - event.displayAtMs) / FAILED_PULSE_MS, 0, 1)
        const radius = 2 + Math.sin(progress * Math.PI) * 7

        return (
          <circle
            key={`${event.edgeId}-${event.sequence}-failed`}
            cx={sourceX}
            cy={sourceY}
            r={radius}
            fill={
              event.status === 'packet-loss' || event.status === 'timeout'
                ? FLOW_WARNING_COLOR
                : FLOW_DANGER_COLOR
            }
            stroke="var(--nss-panel)"
            strokeWidth={1}
            opacity={Math.max(0, 0.75 * (1 - progress))}
            pointerEvents="none"
          />
        )
      })}

      {/* Endpoint grab handles — visible on hover/selected, draggable for reconnection */}
      <circle
        cx={sourceX}
        cy={sourceY}
        r={5}
        className="edge-endpoint nodrag nopan"
        style={{ pointerEvents: 'all', ...(selected ? { opacity: 1 } : {}) }}
      />
      <circle
        cx={targetX}
        cy={targetY}
        r={5}
        className="edge-endpoint nodrag nopan"
        style={{ pointerEvents: 'all', ...(selected ? { opacity: 1 } : {}) }}
      />

      {(hasLabel || showFlowLabel) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all'
            }}
            className="nodrag nopan"
          >
            <div className="flex flex-col items-center gap-1">
              {hasLabel && (
                <span className="bg-nss-bg px-2 py-0.5 text-[11px] font-bold uppercase leading-none tracking-wide text-nss-text">
                  {label.toString()}
                </span>
              )}
              {showFlowLabel && (
                <span className={flowLabelClassName} title={flowLabelTitle}>
                  {flowLabelText}
                </span>
              )}
              {!isRoutingPreviewEdge && selected && flowLabelSub && (
                <span className="bg-nss-bg px-2 py-0.5 text-[11px] font-semibold leading-none tracking-wide text-nss-muted">
                  {flowLabelSub}
                </span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
