import type { AnyNodeData, MetricLens, NodeSimulationMetrics } from '@renderer/types/ui'
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

export function getNodeStatus(data: AnyNodeData): NodeHealthStatus {
  return data.ui?.overloadPreview ? 'critical' : 'healthy'
}

export function getRuntimeNodeStatus(
  fallbackStatus: NodeHealthStatus,
  metrics: Pick<NodeSimulationMetrics, 'utilization' | 'errorRate' | 'queueDepth'>,
  hasRuntime: boolean
): NodeHealthStatus {
  if (!hasRuntime) return fallbackStatus

  const utilization = metrics.utilization ?? 0
  const errorRate = metrics.errorRate ?? 0
  const queueDepth = metrics.queueDepth ?? 0

  if (errorRate >= 50 || utilization >= 90) {
    return 'critical'
  }

  if (errorRate > 0 || utilization >= 75 || queueDepth >= 1) {
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
export function getIdentityChip(data: AnyNodeData): IdentityChip | null {
  if (data.profile === 'source') {
    const pattern = data.source?.defaultWorkload.pattern
    const baseRps = data.source?.defaultWorkload.baseRps
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
      const tone = getRuntimeNodeStatus(
        'healthy',
        { utilization, errorRate: metrics.errorRate, queueDepth: metrics.queueDepth },
        true
      )
      const verdict =
        tone === 'critical'
          ? 'saturated'
          : tone === 'degraded'
            ? 'approaching saturation'
            : 'healthy'
      return {
        value: activeWorkers.toFixed(1),
        limit: `/ ${workers} workers`,
        glyph: GLYPH_BY_TONE[tone],
        why: `${utilization.toFixed(0)}% utilized — ${verdict} · click for detail`,
        tone
      }
    }
    case 'latency': {
      if (metrics.latencyP95 === undefined) {
        return null
      }
      const sloP99 = data.sim?.slo?.latencyP99
      let tone: NodeHealthStatus = 'healthy'
      let sloText = 'no SLO set'
      if (typeof sloP99 === 'number' && sloP99 > 0 && metrics.latencyP99 !== undefined) {
        if (metrics.latencyP99 > sloP99 * 1.5) {
          tone = 'critical'
        } else if (metrics.latencyP99 > sloP99) {
          tone = 'degraded'
        }
        sloText = tone === 'healthy' ? `within ${sloP99}ms p99 SLO` : `above ${sloP99}ms p99 SLO`
      }
      return {
        value: `${metrics.latencyP95.toFixed(1)}ms`,
        limit: 'p95',
        glyph: GLYPH_BY_TONE[tone],
        why: `p50 ${(metrics.latencyP50 ?? 0).toFixed(1)}ms · ${sloText} · click for detail`,
        tone
      }
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
        value: `${metrics.errorRate.toFixed(1)}%`,
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
