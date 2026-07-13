import useStore from '@renderer/store/useStore'

export function useNodeMetrics(id: string) {
  const runtime = useStore((s) => s.simulationMetricsByNode[id])
  const hasRuntime = runtime !== undefined
  const active = hasRuntime ? (runtime.active ?? false) : undefined

  return {
    throughput: runtime?.throughput,
    errorRate: runtime?.errorRate,
    queueDepth: runtime?.queueDepth,
    utilization: runtime?.utilization,
    avgServiceTime: runtime?.avgServiceTime,
    latencyP50: runtime?.latencyP50,
    latencyP95: runtime?.latencyP95,
    latencyP99: runtime?.latencyP99,
    availability: runtime?.availability,
    cacheHits: runtime?.cacheHits,
    cacheMisses: runtime?.cacheMisses,
    cacheHitRatio: runtime?.cacheHitRatio,
    rejectionsByReason: runtime?.rejectionsByReason,
    traitCounters: runtime?.traitCounters,
    totalArrived: runtime?.totalArrived,
    totalRejected: runtime?.totalRejected,
    peakInSystem: runtime?.peakInSystem,
    finalInSystem: runtime?.finalInSystem,
    postWarmupArrived: runtime?.postWarmupArrived,
    postWarmupProcessed: runtime?.postWarmupProcessed,
    postWarmupRejected: runtime?.postWarmupRejected,
    postWarmupTimedOut: runtime?.postWarmupTimedOut,
    hasRuntime,
    active
  }
}
