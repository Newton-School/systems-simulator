import { msToMicro } from '../core/time'
import type { ComponentNode, ComponentType, EdgeDefinition } from '../core/types'
import type { ResolveRoute } from '../routing'
import { getPathTypeLatencyProfile } from '../defaults/edgeDefaults'
import type { NodeBehaviourTrait, NodeCapabilityModule } from './types'

export const DNS_ROUTING_COMPONENT_TYPES = ['internal-dns'] as const satisfies readonly ComponentType[]

type DnsRoutingPolicy = 'simple' | 'weighted' | 'failover' | 'latency-based' | 'geolocation'

interface DnsGeoTarget {
  origin: string
  targetNodeId: string
}

interface DnsConfig {
  routingPolicy: DnsRoutingPolicy
  cacheTtlSeconds: number
  geoTargets: DnsGeoTarget[]
}

const DEFAULT_DNS_CACHE_TTL_SECONDS = 30

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function asRoutingPolicy(value: unknown): DnsRoutingPolicy | null {
  return value === 'simple' ||
    value === 'weighted' ||
    value === 'failover' ||
    value === 'latency-based' ||
    value === 'geolocation'
    ? value
    : null
}

function asGeoTargets(value: unknown): DnsGeoTarget[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null
      }
      const candidate = entry as Partial<DnsGeoTarget>
      return typeof candidate.origin === 'string' &&
        candidate.origin.length > 0 &&
        typeof candidate.targetNodeId === 'string' &&
        candidate.targetNodeId.length > 0
        ? { origin: candidate.origin, targetNodeId: candidate.targetNodeId }
        : null
    })
    .filter((entry): entry is DnsGeoTarget => entry !== null)
}

function readDnsConfig(node: ComponentNode): DnsConfig {
  return {
    routingPolicy: asRoutingPolicy(node.config?.['dnsRoutingPolicy']) ?? 'simple',
    cacheTtlSeconds:
      asPositiveNumber(node.config?.['dnsCacheTtlSeconds']) ?? DEFAULT_DNS_CACHE_TTL_SECONDS,
    geoTargets: asGeoTargets(node.config?.['dnsGeoTargets'])
  }
}

function pickWeightedRoute(routes: ResolveRoute[], random?: () => number): ResolveRoute {
  const normalizedWeights = routes.map((route) =>
    Number.isFinite(route.edge.weight) && (route.edge.weight ?? 0) > 0 ? (route.edge.weight as number) : 1
  )
  const total = normalizedWeights.reduce((sum, value) => sum + value, 0)
  const target = (random?.() ?? Math.random()) * total
  let cumulative = 0

  for (let i = 0; i < routes.length; i++) {
    cumulative += normalizedWeights[i]
    if (target < cumulative) {
      return routes[i]
    }
  }

  return routes[routes.length - 1]
}

function estimatedEdgeLatencyMs(edge: EdgeDefinition): number {
  const distribution = edge.latency.derivedFromPathType
    ? getPathTypeLatencyProfile(edge.latency.pathType)
    : edge.latency.distribution

  switch (distribution.type) {
    case 'constant':
    case 'deterministic':
      return distribution.value
    case 'exponential':
    case 'poisson':
      return 1 / distribution.lambda
    case 'normal':
      return distribution.mean
    case 'log-normal':
      return Math.exp(distribution.mu)
    default:
      return Math.exp(getPathTypeLatencyProfile(edge.latency.pathType).mu)
  }
}

function sortRoutesStable(routes: ResolveRoute[]): ResolveRoute[] {
  return [...routes].sort((a, b) => a.targetNodeId.localeCompare(b.targetNodeId))
}

export const dnsRoutingPolicyTrait: NodeBehaviourTrait = {
  name: 'dns.routing-policy',
  beforeArrival: ({ node, request, clock, state }) => {
    const { cacheTtlSeconds } = readDnsConfig(node)
    if (cacheTtlSeconds <= 0) {
      return { action: 'continue' }
    }

    const cacheKey =
      typeof request.metadata.host === 'string' && request.metadata.host.length > 0
        ? request.metadata.host
        : request.type
    const stateKey = `dns-cache:${cacheKey}`
    const expiresAt = state?.get<bigint>(stateKey)

    if (expiresAt !== undefined && expiresAt > clock) {
      return {
        action: 'continue',
        payload: {
          dnsCacheHit: true,
          cacheKey,
          cacheTtlSeconds,
          metricCounters: { dnsCacheHits: 1 }
        }
      }
    }

    state?.set(stateKey, clock + msToMicro(cacheTtlSeconds * 1000))
    return {
      action: 'continue',
      payload: {
        dnsCacheHit: false,
        cacheKey,
        cacheTtlSeconds,
        metricCounters: { dnsCacheMisses: 1 }
      }
    }
  },
  filterRoutes: ({ node, request, candidates, random, isTargetHealthy }) => {
    if (candidates.length <= 1) {
      return { routes: candidates, decision: 'single-answer' }
    }

    const config = readDnsConfig(node)

    if (config.routingPolicy === 'weighted') {
      const selected = pickWeightedRoute(candidates, random)
      return {
        routes: [selected],
        decision: 'weighted',
        payload: {
          routingPolicy: config.routingPolicy,
          targetNodeId: selected.targetNodeId
        }
      }
    }

    if (config.routingPolicy === 'failover') {
      const sorted = sortRoutesStable(candidates).sort(
        (a, b) => (b.edge.weight ?? 1) - (a.edge.weight ?? 1)
      )
      const healthy = sorted.filter((route) => isTargetHealthy?.(route.targetNodeId) ?? true)
      if (healthy.length === 0) {
        return {
          routes: [],
          decision: 'failover-no-healthy-target',
          rejectionReason: 'no_healthy_targets',
          payload: { routingPolicy: config.routingPolicy }
        }
      }
      return {
        routes: [healthy[0]],
        decision: healthy[0] === sorted[0] ? 'primary' : 'failover',
        payload: {
          routingPolicy: config.routingPolicy,
          targetNodeId: healthy[0].targetNodeId
        }
      }
    }

    if (config.routingPolicy === 'latency-based') {
      const selected = sortRoutesStable(candidates).sort(
        (a, b) => estimatedEdgeLatencyMs(a.edge) - estimatedEdgeLatencyMs(b.edge)
      )[0]
      return {
        routes: [selected],
        decision: 'latency-based',
        payload: {
          routingPolicy: config.routingPolicy,
          targetNodeId: selected.targetNodeId
        }
      }
    }

    if (config.routingPolicy === 'geolocation') {
      const origin =
        typeof request.metadata.origin === 'string' && request.metadata.origin.length > 0
          ? request.metadata.origin
          : undefined
      const matchedTarget = origin
        ? config.geoTargets.find((candidate) => candidate.origin === origin)?.targetNodeId
        : undefined
      const targeted = matchedTarget
        ? candidates.filter((candidate) => candidate.targetNodeId === matchedTarget)
        : candidates

      return {
        routes: targeted.length > 0 ? [sortRoutesStable(targeted)[0]] : [sortRoutesStable(candidates)[0]],
        decision: matchedTarget ? 'geolocation-match' : 'geolocation-fallback',
        payload: {
          routingPolicy: config.routingPolicy,
          origin,
          targetNodeId:
            (targeted.length > 0 ? targeted[0] : candidates[0])?.targetNodeId
        }
      }
    }

    return {
      routes: [sortRoutesStable(candidates)[0]],
      decision: 'simple',
      payload: { routingPolicy: config.routingPolicy }
    }
  }
}

export const dnsRoutingPolicyCapabilityModule: NodeCapabilityModule = {
  name: 'dns.routing-policy',
  appliesTo: DNS_ROUTING_COMPONENT_TYPES,
  hooks: dnsRoutingPolicyTrait,
  config: {
    sections: [
      {
        id: 'dns-routing',
        title: 'Routing',
        fields: [
          {
            path: 'sim.dnsRoutingPolicy',
            type: 'select',
            label: 'DNS routing policy',
            options: ['simple', 'weighted', 'failover', 'latency-based', 'geolocation'],
            why: 'Controls how this resolver chooses among multiple DNS answers.'
          },
          {
            path: 'sim.dnsCacheTtlSeconds',
            type: 'input',
            label: 'Cache TTL',
            unit: 's',
            step: 1,
            why: 'Requests within this TTL are answered from the resolver cache instead of re-resolving.'
          }
        ]
      }
    ]
  },
  defaults: [
    {
      path: 'sim.dnsRoutingPolicy',
      value: 'simple',
      rationale: 'Plain resolvers answer deterministically until you choose a more advanced policy.'
    },
    {
      path: 'sim.dnsCacheTtlSeconds',
      value: DEFAULT_DNS_CACHE_TTL_SECONDS,
      rationale: 'DNS answers are usually cached for tens of seconds, not per-request.'
    }
  ],
  metrics: {
    counters: ['dnsCacheHits', 'dnsCacheMisses']
  },
  honesty: {
    simulates: ['DNS answer selection policies', 'TTL-based resolver caching'],
    notModeled: ['recursive resolution chains', 'authoritative zone transfers']
  }
}
