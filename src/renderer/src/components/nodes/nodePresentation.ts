import type { AnyNodeData, NodeSimulationMetrics } from '@renderer/types/ui'

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

export interface SummaryMetric {
  label: string
  value?: string | number
  unit?: string
  textColor?: string
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

export function getPreRunSummary(data: AnyNodeData): SummaryMetric[] {
  if (data.profile === 'source') {
    return [
      {
        label: 'Pattern',
        value: data.source?.defaultWorkload.pattern
      },
      {
        label: 'Base RPS',
        value: data.source?.defaultWorkload.baseRps?.toFixed(1),
        unit: 'req/s'
      }
    ]
  }

  if (data.profile === 'security-filter') {
    return [
      {
        label: 'Block Rate',
        value:
          typeof data.sim?.securityPolicy?.blockRate === 'number'
            ? (data.sim.securityPolicy.blockRate * 100).toFixed(1)
            : undefined,
        unit: '%',
        textColor: 'text-nss-warning'
      },
      {
        label: 'Dropped Pkts',
        value:
          typeof data.sim?.securityPolicy?.droppedPackets === 'number'
            ? (data.sim.securityPolicy.droppedPackets * 100).toFixed(1)
            : undefined,
        unit: '%',
        textColor: 'text-nss-danger'
      },
      {
        label: 'Timeout',
        value:
          typeof data.sim?.processing?.timeout === 'number'
            ? data.sim.processing.timeout
            : undefined,
        unit: 'ms'
      }
    ]
  }

  const metrics: SummaryMetric[] = [
    {
      label: 'Workers',
      value: data.sim?.queue?.workers
    },
    {
      label: 'Capacity',
      value: data.sim?.queue?.capacity,
      unit: 'req'
    },
    {
      label: 'Timeout',
      value: data.sim?.processing?.timeout,
      unit: 'ms'
    }
  ]

  if (data.profile === 'router') {
    metrics.unshift({
      label: 'Routing',
      value: data.routingStrategy ?? 'passthrough'
    })
  }

  return metrics
}
