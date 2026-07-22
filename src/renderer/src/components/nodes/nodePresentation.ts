import type {
  AnyNodeData,
  MetricLens,
  NodeSimulationMetrics,
  PreRunMetricLens
} from '@renderer/types/ui'
import {
  failureRateLevelFromRatio,
  formatFailurePercentLabel
} from '@renderer/utils/failureRatePresentation'
import {
  ERROR_CAUSE_LABELS,
  dominantTimeToErrorCause
} from '@renderer/utils/errorCausePresentation'
import {
  deriveCapacityStatus,
  deriveCombinedRuntimeTone,
  deriveReliabilityStatus
} from '@renderer/utils/nodeHealthThresholds'
import type { WorkloadWithoutRuntimeFields } from '@renderer/utils/workloadDefaults'
import { ACK_AND_RELEASE_COMPONENT_TYPES } from '../../../../engine/traits/ackAndRelease'
import { HEALTH_AWARE_COMPONENT_TYPES } from '../../../../engine/traits/healthAwareRouting'

const ACK_AND_RELEASE_COMPONENT_TYPE_SET = new Set<string>(ACK_AND_RELEASE_COMPONENT_TYPES)
const HEALTH_AWARE_COMPONENT_TYPE_SET = new Set<string>(HEALTH_AWARE_COMPONENT_TYPES)

export type NodeHealthStatus = 'healthy' | 'degraded' | 'critical'

export interface NodeHealthStyle {
  border: string
  ring: string
  hoverBorder: string
  shadow: string
  dot: string
}

export const NODE_HEALTH_STYLES = {
  healthy: {
    border: 'border-nss-success',
    ring: 'ring-nss-success',
    hoverBorder: 'hover:border-nss-success',
    shadow: 'shadow-[0_0_14px_rgba(16,185,129,0.22)]',
    dot: 'bg-nss-success shadow-[0_0_8px_rgba(16,185,129,0.4)]'
  },
  degraded: {
    border: 'border-nss-warning',
    ring: 'ring-nss-warning',
    hoverBorder: 'hover:border-nss-warning',
    shadow: 'shadow-[0_0_18px_rgba(245,158,11,0.28)]',
    dot: 'bg-nss-warning shadow-[0_0_8px_rgba(245,158,11,0.4)]'
  },
  critical: {
    border: 'border-nss-danger',
    ring: 'ring-nss-danger',
    hoverBorder: 'hover:border-nss-danger',
    shadow: 'shadow-[0_0_18px_rgba(239,68,68,0.35)]',
    dot: 'bg-nss-danger shadow-[0_0_8px_rgba(239,68,68,0.4)]'
  }
} satisfies Record<NodeHealthStatus, NodeHealthStyle>

export type NodeCapacityVisualBand = 'headroom' | 'steady' | 'tight' | 'saturated'

export interface NodeCapacityStyle {
  border: string
  ring: string
  hoverBorder: string
  shadow: string
  iconAccent: string
}

export const NODE_CAPACITY_STYLES = {
  headroom: {
    border: 'border-nss-success/70',
    ring: 'ring-nss-success',
    hoverBorder: 'hover:border-nss-success',
    shadow: 'shadow-[0_0_14px_rgba(16,185,129,0.18)]',
    iconAccent: 'bg-nss-success/10 border border-nss-success/30 text-nss-success'
  },
  steady: {
    border: 'border-nss-primary/60',
    ring: 'ring-nss-primary',
    hoverBorder: 'hover:border-nss-primary/80',
    shadow: 'shadow-[0_0_14px_rgba(59,130,246,0.22)]',
    iconAccent: 'bg-nss-primary/10 border border-nss-primary/30 text-nss-primary'
  },
  tight: {
    border: 'border-nss-warning',
    ring: 'ring-nss-warning',
    hoverBorder: 'hover:border-nss-warning',
    shadow: 'shadow-[0_0_18px_rgba(245,158,11,0.28)]',
    iconAccent: 'bg-nss-warning/10 border border-nss-warning/30 text-nss-warning'
  },
  saturated: {
    border: 'border-orange-400',
    ring: 'ring-orange-400',
    hoverBorder: 'hover:border-orange-300',
    shadow: 'shadow-[0_0_20px_rgba(251,146,60,0.34)]',
    iconAccent: 'bg-orange-400/10 border border-orange-300/40 text-orange-300'
  }
} satisfies Record<NodeCapacityVisualBand, NodeCapacityStyle>

export interface SummaryMetric {
  label: string
  value?: string | number
  unit?: string
  textColor?: string
}

type CountNoun = {
  singular: string
  plural: string
}

type PreRunMetricVocabulary = {
  concurrencyLabel: string
  concurrencyUnit: CountNoun | string
  queueLabel: string
  queueUnit: CountNoun | string
}

export function getNodeStatus(data: AnyNodeData): NodeHealthStatus {
  return data.ui?.overloadPreview ? 'critical' : 'healthy'
}

export function getRuntimeNodeStatus(
  fallbackStatus: NodeHealthStatus,
  metrics: Pick<NodeSimulationMetrics, 'utilization' | 'errorRate' | 'queueDepth'>,
  hasRuntime: boolean
): NodeHealthStatus {
  if (!hasRuntime) return fallbackStatus

  const tone = deriveCombinedRuntimeTone({
    utilization: metrics.utilization ?? 0,
    queueDepth: metrics.queueDepth ?? 0,
    errorRatePercent: metrics.errorRate ?? 0
  })

  if (tone === 'crit') {
    return 'critical'
  }

  if (tone === 'warn') {
    return 'degraded'
  }

  return 'healthy'
}

export function getEffectiveNodeStatus(
  data: AnyNodeData,
  metrics: Pick<NodeSimulationMetrics, 'utilization' | 'errorRate' | 'queueDepth'>,
  hasRuntime: boolean
): NodeHealthStatus {
  return getRuntimeNodeStatus(getNodeStatus(data), metrics, hasRuntime)
}

export function getRuntimeReliabilityStatus(
  fallbackStatus: NodeHealthStatus,
  metrics: Pick<
    NodeSimulationMetrics,
    | 'postWarmupArrived'
    | 'successLatencySamples'
    | 'timeToErrorSamples'
    | 'latencyWindowErrorRate'
    | 'timeToErrorByCause'
    | 'errorRate'
  >,
  hasRuntime: boolean
): NodeHealthStatus {
  if (!hasRuntime) return fallbackStatus

  const reliability = deriveReliabilityStatus({
    postWarmupArrived: metrics.postWarmupArrived ?? 0,
    successLatencySamples: metrics.successLatencySamples ?? 0,
    timeToErrorSamples: metrics.timeToErrorSamples ?? 0,
    latencyWindowErrorRate: metrics.latencyWindowErrorRate ?? (metrics.errorRate ?? 0) / 100,
    timeToErrorByCause: metrics.timeToErrorByCause
  })

  if (reliability.tone === 'crit') return 'critical'
  if (reliability.tone === 'warn') return 'degraded'
  return 'healthy'
}

export function getRuntimeCapacityVisualBand(
  metrics: Pick<NodeSimulationMetrics, 'utilization' | 'queueDepth'>,
  hasRuntime: boolean
): NodeCapacityVisualBand {
  if (!hasRuntime) return 'headroom'

  const utilization = metrics.utilization ?? 0
  const queueDepth = metrics.queueDepth ?? 0
  const capacity = deriveCapacityStatus({
    utilization,
    queueDepth,
    utilizationUnit: 'percent'
  })

  if (capacity.level === 'saturated') return 'saturated'
  if (capacity.level === 'tight') return 'tight'
  if (utilization >= 40) return 'steady'
  return 'headroom'
}

export function getRuntimeCapacityStyle(
  metrics: Pick<NodeSimulationMetrics, 'utilization' | 'queueDepth'>,
  hasRuntime: boolean
): NodeCapacityStyle {
  return NODE_CAPACITY_STYLES[getRuntimeCapacityVisualBand(metrics, hasRuntime)]
}

export function isRuntimeNodeInactive(hasRuntime: boolean, active?: boolean): boolean {
  return hasRuntime && active === false
}

export interface IdentityChip {
  label: string
  value: string
}

/**
 * The one config fact worth showing pre-run when a node's behavior actually
 * depends on it — everything else lives in the properties panel (with
 * provenance), never echoed as a bare number on the card.
 */
export function getIdentityChip(
  data: AnyNodeData,
  sourceWorkload?: WorkloadWithoutRuntimeFields
): IdentityChip | null {
  if (data.profile === 'source') {
    const workload = sourceWorkload ?? data.source?.defaultWorkload
    const pattern = workload?.pattern
    const baseRps = workload?.baseRps
    if (!pattern || baseRps === undefined) {
      return null
    }
    return { label: 'Workload', value: `${pattern} · ${baseRps.toFixed(1)} rps` }
  }
  if (typeof data.sim?.cacheHitRate === 'number') {
    return { label: 'Cache', value: `hit ${Math.round(data.sim.cacheHitRate * 100)}%` }
  }
  // replicationRole is only resolved onto data.sim at serialize/run time
  // (componentSpecs.ts derives it from templateId) — check templateId too so
  // the identity chip is honest before the first run, not just after.
  if (data.sim?.replicationRole === 'replica' || data.templateId === 'read-replica') {
    return { label: 'Role', value: 'read-only replica' }
  }
  // AckAndReleaseTrait has no config knob - it's unconditionally active on
  // every Message Queue - so it needs an explicit declaration or it never
  // shows up as anything at all, despite being real, defining behavior.
  if (
    typeof data.componentType === 'string' &&
    ACK_AND_RELEASE_COMPONENT_TYPE_SET.has(data.componentType)
  ) {
    return { label: 'Async', value: 'acks at enqueue' }
  }
  if (typeof data.sim?.refillRatePerSecond === 'number') {
    return { label: 'Rate limit', value: `${data.sim.refillRatePerSecond} rps` }
  }
  // Shown even at the true default: health-aware routing not visibly stating
  // itself is exactly the "LB routes to dead servers" trust gap this trait
  // exists to close, so its state is worth declaring either way.
  if (
    typeof data.componentType === 'string' &&
    HEALTH_AWARE_COMPONENT_TYPE_SET.has(data.componentType)
  ) {
    return {
      label: 'Health checks',
      value: data.sim?.healthCheckEnabled === false ? 'off' : 'on'
    }
  }
  if (
    typeof data.sim?.securityPolicy?.blockRate === 'number' &&
    data.sim.securityPolicy.blockRate > 0
  ) {
    return { label: 'Block rate', value: `${Math.round(data.sim.securityPolicy.blockRate * 100)}%` }
  }
  return null
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString()
}

function formatCount(value: number, unit: CountNoun | string): string {
  const amount = formatInteger(value)
  if (typeof unit === 'string') {
    return `${amount} ${unit}`
  }

  return `${amount} ${value === 1 ? unit.singular : unit.plural}`
}

function getPreRunMetricVocabulary(data: AnyNodeData): PreRunMetricVocabulary {
  const componentKey = data.componentType ?? data.templateId

  switch (componentKey) {
    case 'load-balancer':
    case 'load-balancer-l4':
    case 'load-balancer-l7':
      return {
        concurrencyLabel: 'Connections',
        concurrencyUnit: { singular: 'connection', plural: 'connections' },
        queueLabel: 'Connection Queue',
        queueUnit: { singular: 'connection', plural: 'connections' }
      }
    case 'api-gateway':
    case 'ingress-controller':
    case 'reverse-proxy':
      return {
        concurrencyLabel: 'Request Slots',
        concurrencyUnit: 'req',
        queueLabel: 'Request Queue',
        queueUnit: 'req'
      }
    case 'relational-db':
    case 'primary-db':
    case 'read-replica':
      return {
        concurrencyLabel: 'Connections',
        concurrencyUnit: { singular: 'connection', plural: 'connections' },
        queueLabel: 'Query Queue',
        queueUnit: { singular: 'query', plural: 'queries' }
      }
    case 'in-memory-cache':
    case 'redis-cache':
      return {
        concurrencyLabel: 'Operations',
        concurrencyUnit: 'ops',
        queueLabel: 'Operation Queue',
        queueUnit: 'ops'
      }
    case 'queue':
    case 'message-queue':
      return {
        concurrencyLabel: 'Consumers',
        concurrencyUnit: { singular: 'consumer', plural: 'consumers' },
        queueLabel: 'Backlog',
        queueUnit: 'msg'
      }
    case 'service-registry':
    case 'dns-server':
      return {
        concurrencyLabel: 'Lookups',
        concurrencyUnit: { singular: 'lookup', plural: 'lookups' },
        queueLabel: 'Lookup Queue',
        queueUnit: { singular: 'lookup', plural: 'lookups' }
      }
    default:
      return {
        concurrencyLabel: 'Workers',
        concurrencyUnit: { singular: 'worker', plural: 'workers' },
        queueLabel: 'Queue',
        queueUnit: 'req'
      }
  }
}

export function isPreRunMetricLens(lens: MetricLens): lens is PreRunMetricLens {
  return lens === 'concurrency' || lens === 'queueCapacity' || lens === 'timeout'
}

export function getPreRunMetric(lens: PreRunMetricLens, data: AnyNodeData): SummaryMetric | null {
  if (data.profile === 'source') {
    return null
  }

  const vocabulary = getPreRunMetricVocabulary(data)

  switch (lens) {
    case 'concurrency': {
      const workers = data.sim?.queue?.workers
      if (workers === undefined) {
        return null
      }
      return {
        label: vocabulary.concurrencyLabel,
        value: formatCount(workers, vocabulary.concurrencyUnit)
      }
    }
    case 'queueCapacity': {
      const capacity = data.sim?.queue?.capacity
      if (capacity === undefined) {
        return null
      }
      return {
        label: vocabulary.queueLabel,
        value: formatCount(capacity, vocabulary.queueUnit)
      }
    }
    case 'timeout': {
      const timeout = data.sim?.processing?.timeout
      if (timeout === undefined) {
        return null
      }
      return {
        label: 'Timeout',
        value: `${formatInteger(timeout)} ms`
      }
    }
  }
}

export interface LensCardData {
  value: string
  limit: string
  glyph: '✓' | '⚠' | '✕'
  why: string
  tone: NodeHealthStatus
}

const GLYPH_BY_TONE: Record<NodeHealthStatus, LensCardData['glyph']> = {
  healthy: '✓',
  degraded: '⚠',
  critical: '✕'
}

const TONE_RANK: Record<NodeHealthStatus, number> = { healthy: 0, degraded: 1, critical: 2 }

/** The more severe of two tones — so a healthy-looking metric can't outvote a real problem. */
function worseTone(a: NodeHealthStatus, b: NodeHealthStatus): NodeHealthStatus {
  return TONE_RANK[a] >= TONE_RANK[b] ? a : b
}

function formatLatencyMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? 'N/A' : `${value.toFixed(2)}ms`
}

function formatWorkerUsage(activeWorkers: number, workers: number): string {
  if (workers <= 1) {
    return activeWorkers.toFixed(2)
  }

  return activeWorkers.toFixed(1)
}

function formatWorkerLimit(workers: number): string {
  return `/ ${workers} worker${workers === 1 ? '' : 's'} avg`
}

function toneFromFailureRatio(value: number): NodeHealthStatus {
  const level = failureRateLevelFromRatio(value)
  if (level === 'crit') return 'critical'
  if (level === 'warn') return 'degraded'
  return 'healthy'
}

type LatencyLensMetrics = Pick<
  NodeSimulationMetrics,
  | 'latencyP50'
  | 'latencyP95'
  | 'latencyP99'
  | 'latencyNodeLocal'
  | 'successLatencySamples'
  | 'latencyWindowErrorRate'
  | 'errorRate'
  | 'timeToErrorByCause'
>

function scopedLatencyValue(
  metrics: LatencyLensMetrics,
  bucket: 'p50' | 'p95' | 'p99'
): number | null | undefined {
  if (metrics.latencyNodeLocal) {
    return metrics.latencyNodeLocal[bucket]
  }

  switch (bucket) {
    case 'p50':
      return metrics.latencyP50
    case 'p95':
      return metrics.latencyP95
    case 'p99':
      return metrics.latencyP99
  }
}

export function buildLatencyLensCard(
  sloP99: number | undefined,
  metrics: LatencyLensMetrics
): LensCardData | null {
  const successP50 = scopedLatencyValue(metrics, 'p50')
  const successP95 = scopedLatencyValue(metrics, 'p95')
  const successP99 = scopedLatencyValue(metrics, 'p99')
  const successLatencySamples = metrics.successLatencySamples ?? 0
  const failureRateRatio = metrics.latencyWindowErrorRate ?? (metrics.errorRate ?? 0) / 100
  const failureRateText = formatFailurePercentLabel(failureRateRatio * 100)
  const dominantFailure = dominantTimeToErrorCause(metrics.timeToErrorByCause)
  const dominantFailureText = dominantFailure
    ? `, mostly ${ERROR_CAUSE_LABELS[dominantFailure]}`
    : ''
  const hasLatencyContext =
    successP95 !== undefined ||
    metrics.latencyNodeLocal !== undefined ||
    metrics.successLatencySamples !== undefined ||
    metrics.latencyWindowErrorRate !== undefined

  if (!hasLatencyContext) {
    return null
  }

  let sloTone: NodeHealthStatus = 'healthy'
  let sloText = 'no SLO set'
  if (typeof sloP99 === 'number' && sloP99 > 0 && successP99 !== undefined && successP99 !== null) {
    if (successP99 > sloP99 * 1.5) {
      sloTone = 'critical'
    } else if (successP99 > sloP99) {
      sloTone = 'degraded'
    }
    sloText = sloTone === 'healthy' ? `within ${sloP99}ms p99 SLO` : `above ${sloP99}ms p99 SLO`
  }

  const errorTone =
    successLatencySamples === 0 && failureRateRatio > 0
      ? 'critical'
      : toneFromFailureRatio(failureRateRatio)
  const tone = worseTone(sloTone, errorTone)

  let why = `p50 ${formatLatencyMetric(successP50)} · ${sloText} · click for detail`
  if (successLatencySamples === 0 && failureRateRatio > 0) {
    why = `no successful requests · ${failureRateText} failed${dominantFailureText} · click for detail`
  } else if (successLatencySamples === 0) {
    why = 'no successful requests in this window · click for detail'
  } else if (failureRateRatio >= 0.5) {
    why = `p50 ${formatLatencyMetric(successP50)} · success-only latency, ${failureRateText} failed${dominantFailureText} · click for detail`
  } else if (failureRateRatio > 0) {
    why = `p50 ${formatLatencyMetric(successP50)} · over ${successLatencySamples.toLocaleString()} successes only, ${failureRateText} failed${dominantFailureText} · click for detail`
  }

  return {
    value: formatLatencyMetric(successP95),
    limit: 'p95',
    glyph: GLYPH_BY_TONE[tone],
    why,
    tone
  }
}

/**
 * One metric family, driven by the active lens — the value/limit card. Never
 * shows more than one family at once; deep detail lives behind selection.
 */
export function getLensCard(
  lens: MetricLens,
  data: AnyNodeData,
  metrics: NodeSimulationMetrics
): LensCardData | null {
  switch (lens) {
    case 'saturation': {
      const workers = data.sim?.queue?.workers
      if (!workers || metrics.utilization === undefined) {
        return null
      }
      const utilization = metrics.utilization
      const activeWorkers = Math.min(workers, (utilization / 100) * workers)
      const capacity = deriveCapacityStatus({
        utilization,
        queueDepth: metrics.queueDepth,
        workers,
        utilizationUnit: 'percent'
      })
      const tone: NodeHealthStatus = capacity.level === 'headroom' ? 'healthy' : 'degraded'
      return {
        value: formatWorkerUsage(activeWorkers, workers),
        limit: formatWorkerLimit(workers),
        glyph: capacity.level === 'headroom' ? '✓' : '⚠',
        why: `${capacity.utilizationPercent.toFixed(1)}% average utilization - ${capacity.label.toLowerCase()} · click for detail`,
        tone
      }
    }
    case 'latency': {
      const sloP99 = data.sim?.slo?.latencyP99
      return buildLatencyLensCard(sloP99, metrics)
    }
    case 'errors': {
      if (metrics.errorRate === undefined) {
        return null
      }
      const tone: NodeHealthStatus =
        metrics.errorRate >= 50 ? 'critical' : metrics.errorRate > 0 ? 'degraded' : 'healthy'
      const reasons = Object.entries(metrics.rejectionsByReason ?? {}).sort((a, b) => b[1] - a[1])
      const why =
        reasons.length > 0
          ? `${reasons[0][1]} rejected: ${reasons[0][0]} · click for detail`
          : 'no rejections'
      return {
        value: formatFailurePercentLabel(metrics.errorRate),
        limit: `${metrics.totalRejected ?? 0} rejected`,
        glyph: GLYPH_BY_TONE[tone],
        why,
        tone
      }
    }
    case 'throughput': {
      if (metrics.throughput === undefined) {
        return null
      }
      const why =
        data.componentType === 'stream' &&
        metrics.finalInSystem !== undefined &&
        metrics.peakInSystem !== undefined
          ? `${metrics.finalInSystem.toFixed(0)} lag at end · peak ${metrics.peakInSystem.toFixed(0)}`
          : metrics.cacheHitRatio !== undefined && metrics.cacheHitRatio > 0
            ? `${metrics.cacheHitRatio.toFixed(0)}% served from cache`
            : 'click for detail'
      return {
        value: metrics.throughput.toFixed(1),
        limit: 'req/s',
        glyph: '✓',
        why,
        tone: 'healthy'
      }
    }
    default:
      return null
  }
}
