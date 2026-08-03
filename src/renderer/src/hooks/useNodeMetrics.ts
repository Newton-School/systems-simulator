import useStore from '@renderer/store/useStore'

export function useNodeMetrics(id: string) {
  // EnvironmentProfile: when the profile hides live metrics, suppress every
  // node's runtime overlay at this single source (all node types key off it).
  const liveMetrics = useStore((s) => s.environmentProfile.visibility.liveMetrics)
  const runtimeRaw = useStore((s) => s.simulationMetricsByNode[id])
  const runtime = liveMetrics ? runtimeRaw : undefined
  const hasRuntime = runtime !== undefined
  const active = hasRuntime ? (runtime.active ?? false) : undefined

  return {
    throughput: runtime?.throughput,
    arrived: runtime?.postWarmupArrived,
    completed: runtime?.postWarmupProcessed,
    inFlight: runtime?.postWarmupInFlight,
    errorRate: runtime?.errorRate,
    queueDepth: runtime?.queueDepth,
    utilization: runtime?.utilization,
    avgServiceTime: runtime?.avgServiceTime,
    latencyP50: runtime?.latencyP50,
    latencyP95: runtime?.latencyP95,
    latencyP99: runtime?.latencyP99,
    successLatencySamples: runtime?.successLatencySamples,
    timeToErrorSamples: runtime?.timeToErrorSamples,
    latencyWindowErrorRate: runtime?.latencyWindowErrorRate,
    latencyNodeLocal: runtime?.latencyNodeLocal,
    timeToErrorByCause: runtime?.timeToErrorByCause,
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
    postWarmupConnectionReset: runtime?.postWarmupConnectionReset,
    postWarmupInFlight: runtime?.postWarmupInFlight,
    hasRuntime,
    active
  }
}
