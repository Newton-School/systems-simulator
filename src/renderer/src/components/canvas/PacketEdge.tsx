import { useEffect, useMemo, useRef, useState } from 'react'
import { BaseEdge, getSmoothStepPath, EdgeProps, EdgeLabelRenderer } from 'reactflow'
import useStore, { type EdgeFlowRunConfig, type EdgeFlowState } from '@renderer/store/useStore'
import { getRoutingPreviewSnapshot } from '@renderer/utils/routingStrategyPreview'
import { failureRateLevelFromRatio } from '@renderer/utils/failureRatePresentation'

const EDGE_VISUAL_WINDOW_MS = 3_000
const FAILED_PULSE_MS = 650
const MIN_STREAM_DURATION_MS = 2_200
const MAX_STREAM_DURATION_MS = 5_200
const PATTERN_VISUAL_SPEED = 4
const FLOW_SUCCESS_COLOR = 'rgb(var(--nss-success))'
const FLOW_WARNING_COLOR = 'rgb(var(--nss-warning))'
const FLOW_DANGER_COLOR = 'rgb(var(--nss-danger))'
const FLOW_PRIMARY_COLOR = 'rgb(var(--nss-primary))'
const ROUTING_PREVIEW_DECISION_SAMPLE_LIMIT = 2_000
const EMPTY_EDGE_FLOW_BY_ID: Record<string, EdgeFlowState> = {}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function fmtFailureRate(ratio: number): string {
  return `${(clamp(ratio, 0, 1) * 100).toFixed(1)}% fail`
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

function patternElapsedMs(
  runConfig: EdgeFlowRunConfig | null,
  playback: { wallStartMs: number; simStartMs: number } | null,
  now: number
): number {
  if (!runConfig || !playback) return 0

  const duration = Math.max(1, runConfig.simulationDurationMs)
  const elapsed = playback.simStartMs + (now - playback.wallStartMs) * PATTERN_VISUAL_SPEED
  return ((elapsed % duration) + duration) % duration
}

function patternMultiplier(
  runConfig: EdgeFlowRunConfig | null,
  playback: { wallStartMs: number; simStartMs: number } | null,
  now: number,
  edgeId: string
): number {
  if (!runConfig) return 1

  const workload = runConfig.workload
  const elapsed = patternElapsedMs(runConfig, playback, now)
  const baseRps = Math.max(1, workload.baseRps)

  switch (workload.pattern) {
    case 'constant':
    case 'replay':
      return 1

    case 'poisson': {
      const bucket = Math.floor(elapsed / 900)
      return 0.45 + hash01(`${edgeId}:poisson:${bucket}`) * 1.25
    }

    case 'bursty': {
      const burst = workload.bursty
      if (!burst) return 1
      const burstDuration = Math.max(1, burst.burstDuration)
      const normalDuration = Math.max(1, burst.normalDuration)
      const cycle = burstDuration + normalDuration
      const inBurst = elapsed % cycle < burstDuration
      return inBurst ? clamp(burst.burstRps / baseRps, 1.5, 4) : 1
    }

    case 'spike': {
      const spike = workload.spike
      if (!spike) return 1
      const inSpike = elapsed >= spike.spikeTime && elapsed < spike.spikeTime + spike.spikeDuration
      return inSpike ? clamp(spike.spikeRps / baseRps, 1.75, 5) : 1
    }

    case 'sawtooth': {
      const sawtooth = workload.sawtooth
      if (!sawtooth) return 1
      const rampDuration = Math.max(1, sawtooth.rampDuration)
      const t = (elapsed % rampDuration) / rampDuration
      const currentRps = baseRps + (sawtooth.peakRps - baseRps) * t
      return clamp(currentRps / baseRps, 0.45, 5)
    }

    case 'diurnal': {
      const multipliers = workload.diurnal?.hourlyMultipliers
      if (!multipliers) return 1
      const progress = elapsed / Math.max(1, runConfig.simulationDurationMs)
      const hourPosition = progress * 24
      const hour = Math.floor(hourPosition) % 24
      const nextHour = (hour + 1) % 24
      const localT = hourPosition - Math.floor(hourPosition)
      const current = multipliers[hour] ?? 1
      const next = multipliers[nextHour] ?? current
      return clamp(current + (next - current) * localT, 0.35, 2.5)
    }

    default:
      return 1
  }
}

function patternPhaseLabel(
  runConfig: EdgeFlowRunConfig | null,
  playback: { wallStartMs: number; simStartMs: number } | null,
  now: number
): string | null {
  if (!runConfig) return null

  const workload = runConfig.workload
  const elapsed = patternElapsedMs(runConfig, playback, now)

  switch (workload.pattern) {
    case 'bursty': {
      const burst = workload.bursty
      if (!burst) return null
      const burstDuration = Math.max(1, burst.burstDuration)
      const normalDuration = Math.max(1, burst.normalDuration)
      const cycle = burstDuration + normalDuration
      return elapsed % cycle < burstDuration ? 'burst' : 'base'
    }

    case 'spike': {
      const spike = workload.spike
      if (!spike) return null
      return elapsed >= spike.spikeTime && elapsed < spike.spikeTime + spike.spikeDuration
        ? 'spike'
        : 'base'
    }

    case 'sawtooth': {
      const sawtooth = workload.sawtooth
      if (!sawtooth) return null
      const rampDuration = Math.max(1, sawtooth.rampDuration)
      const progress = (elapsed % rampDuration) / rampDuration
      if (progress > 0.66) return 'ramp high'
      if (progress > 0.33) return 'ramp mid'
      return 'ramp low'
    }

    case 'diurnal': {
      const multiplier = patternMultiplier(runConfig, playback, now, 'diurnal-label')
      if (multiplier > 1.1) return 'peak'
      if (multiplier < 0.8) return 'low'
      return 'normal'
    }

    case 'poisson':
      return 'jitter'

    default:
      return null
  }
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
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
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
  const liveFailedRate = Math.max(flow?.failedPerSecond ?? 0, flow?.avgFailedPerSecond ?? 0)
  const liveFailureRatio = liveIncomingRate > 0 ? liveFailedRate / liveIncomingRate : 0
  const postWarmupAttemptedCount = flow?.totalPostWarmupAttempted ?? 0
  const postRunFailureRatio =
    postWarmupAttemptedCount > 0 ? (flow?.totalPostWarmupFailed ?? 0) / postWarmupAttemptedCount : 0
  const failureRatio = isComplete ? postRunFailureRatio : liveFailureRatio
  const visualMultiplier = patternMultiplier(runConfig, playback, now, id)
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
  const phaseLabel =
    isRoutingPreviewEdge || isInactiveAfterRun ? null : patternPhaseLabel(runConfig, playback, now)
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
  const failureLevel = failureRateLevelFromRatio(failureRatio)
  const failureStroke =
    failureLevel === 'crit'
      ? FLOW_DANGER_COLOR
      : failureLevel === 'warn'
        ? FLOW_WARNING_COLOR
        : undefined
  const flowLabelText = isRoutingPreviewEdge
    ? routingPreview?.isSelected
      ? `${routingPreview.selectedCount}/${routingPreview.totalCount} preview`
      : 'not selected'
    : isInactiveAfterRun
      ? 'inactive'
      : [phaseLabel, fmtFailureRate(failureRatio)].filter(Boolean).join(' / ')
  const flowLabelClassName = [
    'bg-nss-bg px-2 py-0.5 text-[18px] font-bold leading-none tracking-wide',
    isRoutingPreviewEdge
      ? routingPreview?.isSelected
        ? 'text-nss-success'
        : 'text-nss-muted'
      : isInactiveAfterRun
        ? 'text-nss-muted'
        : failureLevel === 'crit'
          ? 'text-nss-danger'
          : failureLevel === 'warn'
            ? 'text-nss-warning'
            : 'text-nss-primary'
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
          stroke: isRoutingPreviewEdge
            ? 'var(--nss-border-high)'
            : selected
              ? FLOW_PRIMARY_COLOR
              : (failureStroke ?? 'var(--nss-border-high)'),
          strokeDasharray: 'none',
          opacity: isRoutingPreviewEdge
            ? routingPreview?.isSelected
              ? 1
              : 0.28
            : isInactiveAfterRun
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

      {(hasLabel || isRoutingPreviewEdge || flowStatus === 'complete' || flow) && (
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
              {(isRoutingPreviewEdge || flowStatus === 'complete' || flow) && (
                <span className={flowLabelClassName}>{flowLabelText}</span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
