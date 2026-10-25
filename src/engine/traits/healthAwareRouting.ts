import type { ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const HEALTH_AWARE_COMPONENT_TYPES = [
  'load-balancer',
  'load-balancer-l4',
  'load-balancer-l7',
  'api-gateway',
  'ingress-controller',
  'reverse-proxy'
] as const satisfies readonly ComponentType[]

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function isHealthCheckEnabled(config: Record<string, unknown> | undefined): boolean {
  const raw = config?.['healthCheckEnabled']
  return typeof raw === 'boolean' ? raw : true
}

export const healthAwareRoutingTrait: NodeBehaviourTrait = {
  name: 'routing.health-aware',
  filterRoutes: ({ node, candidates, isTargetHealthy, isEdgeHealthy, unhealthyForUs }) => {
    if (!isHealthCheckEnabled(node.config)) {
      return {
        routes: candidates,
        decision: 'disabled',
        payload: {
          healthCheckEnabled: false,
          beforeCandidateCount: candidates.length,
          afterCandidateCount: candidates.length
        }
      }
    }

    // Detection delay (decision C5): with a check interval and failure threshold set, a target that has just
    // failed stays in rotation until that many consecutive probes would have failed. Unset keeps the instant view.
    const intervalMs = positive(node.config?.['healthCheckIntervalMs'])
    const threshold = positive(node.config?.['healthCheckFailureThreshold'])
    const detectionUs =
      intervalMs !== null && threshold !== null
        ? BigInt(Math.round(intervalMs * threshold * 1000))
        : null

    const filtered = candidates.filter((candidate) => {
      const downFor = unhealthyForUs?.(candidate.targetNodeId)
      const withinDetection = detectionUs !== null && downFor !== undefined && downFor < detectionUs
      const targetHealthy = withinDetection || (isTargetHealthy?.(candidate.targetNodeId) ?? true)
      const edgeHealthy = isEdgeHealthy?.(candidate.edge) ?? true
      return targetHealthy && edgeHealthy
    })

    // Panic mode (decision C3): when every target looks unhealthy the health view is more likely wrong than
    // the whole fleet being down (a check that ejected on one failed attempt, a shared dependency blip), so the
    // balancer serves from all of them rather than refusing everything. It rejects only when it has no targets.
    if (filtered.length === 0 && candidates.length > 0) {
      return {
        routes: candidates,
        decision: 'panic-all-unhealthy',
        payload: {
          healthCheckEnabled: true,
          beforeCandidateCount: candidates.length,
          afterCandidateCount: candidates.length,
          metricCounters: { healthPanicRoutes: 1 }
        }
      }
    }

    return {
      routes: filtered,
      decision: filtered.length === candidates.length ? 'continue' : 'filtered-unhealthy-targets',
      payload: {
        healthCheckEnabled: true,
        beforeCandidateCount: candidates.length,
        afterCandidateCount: filtered.length
      }
    }
  }
}

export const healthAwareRoutingCapabilityModule: NodeCapabilityModule = {
  name: 'routing.health-aware',
  appliesTo: HEALTH_AWARE_COMPONENT_TYPES,
  hooks: healthAwareRoutingTrait,
  config: {
    sections: [
      {
        id: 'routing',
        title: 'Routing',
        fields: [
          {
            path: 'sim.healthCheckEnabled',
            type: 'boolean',
            label: 'Health checks',
            defaultValue: true,
            why: 'Filters out unhealthy downstream targets before the routing strategy picks one.'
          },
          {
            path: 'sim.healthCheckIntervalMs',
            type: 'input',
            inputType: 'number',
            label: 'Check interval',
            unit: 'ms',
            min: 0,
            altitude: 'advanced',
            why: 'How often targets are probed. With the failure threshold set, a failed target keeps receiving traffic for interval x threshold before it is removed. Empty means instant removal.'
          },
          {
            path: 'sim.healthCheckFailureThreshold',
            type: 'input',
            inputType: 'number',
            label: 'Failures before removal',
            unit: 'probes',
            min: 1,
            altitude: 'advanced',
            why: 'Consecutive failed probes before a target is removed (see Check interval).'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.healthCheckEnabled',
      value: true,
      rationale: 'Health-aware routers should default to avoiding unhealthy backends.'
    }
  ],
  metrics: {
    rejectionReasons: ['no_healthy_targets'],
    counters: ['healthPanicRoutes']
  },
  honesty: {
    simulates: [
      'healthy-target filtering before route selection',
      'panic mode: with every target unhealthy, route to all of them instead of refusing'
    ],
    notModeled: ['recovery hysteresis (a recovered target is trusted at once)']
  }
}
