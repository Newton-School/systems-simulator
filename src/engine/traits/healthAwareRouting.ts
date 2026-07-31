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

function isHealthCheckEnabled(config: Record<string, unknown> | undefined): boolean {
  const raw = config?.['healthCheckEnabled']
  return typeof raw === 'boolean' ? raw : true
}

export const healthAwareRoutingTrait: NodeBehaviourTrait = {
  name: 'routing.health-aware',
  filterRoutes: ({ node, candidates, isTargetHealthy, isEdgeHealthy }) => {
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

    const filtered = candidates.filter((candidate) => {
      const targetHealthy = isTargetHealthy?.(candidate.targetNodeId) ?? true
      const edgeHealthy = isEdgeHealthy?.(candidate.edge) ?? true
      return targetHealthy && edgeHealthy
    })

    if (filtered.length === 0 && candidates.length > 0) {
      return {
        routes: [],
        decision: 'no-healthy-targets',
        rejectionReason: 'no_healthy_targets',
        payload: {
          healthCheckEnabled: true,
          beforeCandidateCount: candidates.length,
          afterCandidateCount: 0
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
    rejectionReasons: ['no_healthy_targets']
  },
  honesty: {
    simulates: ['healthy-target filtering before route selection'],
    notModeled: ['probe intervals, unhealthy thresholds, recovery hysteresis']
  }
}
