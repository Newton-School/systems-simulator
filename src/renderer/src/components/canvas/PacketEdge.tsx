import { useEffect, useRef, useState } from 'react'
import { BaseEdge, getSmoothStepPath, EdgeProps, EdgeLabelRenderer } from 'reactflow'
import useStore, { type EdgeFlowRunConfig } from '@renderer/store/useStore'
import { StatusBadge } from '../ui/StatusBadge'

const EDGE_VISUAL_WINDOW_MS = 3_000
const FAILED_PULSE_MS = 650
const MIN_STREAM_DURATION_MS = 2_200
const MAX_STREAM_DURATION_MS = 5_200
const PATTERN_VISUAL_SPEED = 4
const FLOW_SUCCESS_COLOR = 'rgb(var(--nss-success))'
const FLOW_WARNING_COLOR = 'rgb(var(--nss-warning))'
const FLOW_DANGER_COLOR = 'rgb(var(--nss-danger))'
const FLOW_PRIMARY_COLOR = 'rgb(var(--nss-primary))'

type PacketEdgeData = {
  packetLossRate?: number
  errorRate?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function fmtRps(value: number): string {
  if (value >= 100) return `${Math.round(value)} rps`
  if (value >= 10) return `${value.toFixed(1)} rps`
  return `${value.toFixed(2)} rps`
}

function compressedPacketCount(rps: number): number {
  if (rps <= 0) return 0
  return clamp(Math.ceil(Math.log2(rps + 1) * 0.8), 2, 7)
}

function streamDurationForRps(rps: number): number {
  if (rps <= 0) return MAX_STREAM_DURATION_MS
  return clamp(
    MAX_STREAM_DURATION_MS - Math.log2(rps + 1) * 420,
    MIN_STREAM_DURATION_MS,
    MAX_STREAM_DURATION_MS
  )
}

function patternPacketCount(baseCount: number, multiplier: number): number {
  if (baseCount <= 0) return 0
  return clamp(Math.round(baseCount * clamp(multiplier, 0.35, 4)), 1, 14)
}

function percentToRatio(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return clamp(value / 100, 0, 1)
}

function edgeConfiguredSuccessRatio(data: unknown): number {
  const edgeData = data as PacketEdgeData | undefined
  const configuredLossRatio = percentToRatio(edgeData?.packetLossRate)
  const configuredErrorRatio = percentToRatio(edgeData?.errorRate)
  return (1 - (configuredLossRatio ?? 0)) * (1 - (configuredErrorRatio ?? 0))
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
      const cycle = Math.max(1, burst.burstDuration) + Math.max(1, burst.normalDuration)
      return elapsed % cycle < Math.max(1, burst.burstDuration) ? 'burst' : 'base'
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
      const t = (elapsed % Math.max(1, sawtooth.rampDuration)) / Math.max(1, sawtooth.rampDuration)
      if (t > 0.66) return 'ramp high'
      if (t > 0.33) return 'ramp mid'
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
  const runConfig = useStore((state) => state.edgeFlowRunConfig)
  const playback = useStore((state) => state.edgeFlowPlayback)
  const [now, setNow] = useState(() => Date.now())
  const pathRef = useRef<SVGPathElement | null>(null)
  const [pathLength, setPathLength] = useState(0)

  useEffect(() => {
    if (!flow && flowStatus !== 'complete') return
    const intervalId = window.setInterval(() => setNow(Date.now()), 33)
    return () => window.clearInterval(intervalId)
  }, [flow, flowStatus])

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

  const displaySuccessRps =
    flowStatus === 'complete'
      ? (flow?.avgSuccessPerSecond ?? 0)
      : Math.max(flow?.successPerSecond ?? 0, flow?.avgSuccessPerSecond ?? 0)
  const displayAttemptedRps =
    flowStatus === 'complete'
      ? (flow?.avgAttemptedPerSecond ?? 0)
      : Math.max(flow?.attemptedPerSecond ?? 0, flow?.avgAttemptedPerSecond ?? 0)
  const displayFailedRps =
    flowStatus === 'complete'
      ? (flow?.avgFailedPerSecond ?? 0)
      : Math.max(flow?.failedPerSecond ?? 0, flow?.avgFailedPerSecond ?? 0)
  const failureRatio = displayAttemptedRps > 0 ? displayFailedRps / displayAttemptedRps : 0
  const configuredSuccessRatio = edgeConfiguredSuccessRatio(data)
  const observedSuccessRatio =
    displayAttemptedRps > 0
      ? clamp(displaySuccessRps / displayAttemptedRps, 0, 1)
      : configuredSuccessRatio
  const renderedSuccessRps = displayAttemptedRps * observedSuccessRatio
  const visualMultiplier = patternMultiplier(runConfig, playback, now, id)
  const visualSuccessRps = renderedSuccessRps * visualMultiplier
  const basePacketCount = compressedPacketCount(renderedSuccessRps)
  const streamPacketCount = patternPacketCount(basePacketCount, visualMultiplier)
  const phaseLabel = patternPhaseLabel(runConfig, playback, now)
  const isInactiveAfterRun = flowStatus === 'complete' && !flow
  const hasFlow = displayAttemptedRps > 0
  const trafficStrokeWidth = hasFlow
    ? clamp(3 + Math.log2(visualSuccessRps + 1) * 0.55, selected ? 3.5 : 3, 5)
    : selected
      ? 3
      : 2
  const failureStroke =
    failureRatio > 0.5 ? FLOW_DANGER_COLOR : failureRatio > 0.05 ? FLOW_WARNING_COLOR : undefined

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
          stroke: selected ? FLOW_PRIMARY_COLOR : (failureStroke ?? 'var(--nss-border-high)'),
          opacity: isInactiveAfterRun ? 0.28 : 1
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
        const duration = streamDurationForRps(visualSuccessRps) / speedJitter
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
            r={visualSuccessRps > 150 ? 3.5 : 4.75}
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

      {(hasLabel || flowStatus === 'complete' || flow) && (
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
              {hasLabel && <StatusBadge status={label.toString()} />}
              {(flowStatus === 'complete' || flow) && (
                <span
                  className={[
                    'rounded border px-1.5 py-0.5 text-[9px] font-semibold shadow-sm',
                    isInactiveAfterRun
                      ? 'border-nss-border bg-nss-surface text-nss-muted'
                      : failureRatio > 0.05
                        ? 'border-nss-warning/30 bg-nss-warning/10 text-nss-warning'
                        : 'border-nss-success/25 bg-nss-success/10 text-nss-success'
                  ].join(' ')}
                >
                  {isInactiveAfterRun
                    ? 'inactive'
                    : `${fmtRps(displaySuccessRps)}${phaseLabel ? ` - ${phaseLabel}` : ''}${failureRatio > 0 ? ` / ${(failureRatio * 100).toFixed(1)}% fail` : ''}`}
                </span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
