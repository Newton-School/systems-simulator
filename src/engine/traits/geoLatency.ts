import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const GEO_LATENCY_COMPONENT_TYPES = [
  'cdn',
  'global-traffic-manager',
  'edge-router'
] as const satisfies readonly ComponentType[]

const DEFAULT_REGION_LATENCY_MS = 40

function asNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function addPenalty(request: { metadata: Record<string, unknown> }, ms: number): void {
  const existing =
    typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
      ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
      : 0
  request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + ms
}

/**
 * Region/PoP distance latency. A steering node (CDN, global traffic manager, edge
 * router) adds a per-request propagation penalty representing the distance a
 * request travels to the serving region. Rewards designs that keep users close
 * to their data (edge/multi-region locality) instead of always crossing the map.
 */
export const geoLatencyTrait: NodeBehaviourTrait = {
  name: 'network.geo-latency',
  beforeArrival: ({ node, request }) => {
    const regionLatencyMs = asNonNegativeNumber(node.config?.['regionLatencyMs'])
    if (regionLatencyMs === null || regionLatencyMs === 0) {
      return { action: 'continue' }
    }
    addPenalty(request, regionLatencyMs)
    return {
      action: 'continue',
      payload: { geoLatencyMs: regionLatencyMs, metricCounters: { geoHops: 1 } }
    }
  }
}

export const geoLatencyCapabilityModule: NodeCapabilityModule = {
  name: 'network.geo-latency',
  appliesTo: GEO_LATENCY_COMPONENT_TYPES,
  hooks: geoLatencyTrait,
  config: {
    sections: [
      {
        id: 'geo-latency',
        title: 'Geo Latency',
        note: 'Adds a per-request propagation penalty for the distance to the serving region. Set it low for a nearby PoP, high for a cross-region hop, so locality-aware designs win.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.regionLatencyMs',
            type: 'input',
            inputType: 'number',
            label: 'Region latency',
            unit: 'ms',
            min: 0,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_REGION_LATENCY_MS}ms`,
            why: 'Propagation delay to reach the serving region/PoP for each request.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['geoHops'] },
  honesty: {
    simulates: ['a flat per-request propagation penalty for region/PoP distance'],
    notModeled: ['per-user geo routing decisions, anycast, or real inter-region distance matrices']
  }
}
