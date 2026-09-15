import { findCloudRegion } from '../catalog/locationCatalog'
import { getPathTypeLatencyProfile } from '../defaults/edgeDefaults'
import type { Request } from '../core/events'
import type {
  ComponentNode,
  DistributionConfig,
  EdgeDefinition,
  TopologyJSON,
  TopologyLocation,
  TrafficOriginLocation
} from '../core/types'

interface Coordinates {
  latitude: number
  longitude: number
}

const EARTH_RADIUS_KM = 6371
const FIBRE_KM_PER_MS = 200
const ROUTE_INFLATION = 1.35
const CLIENT_LAST_MILE_MS = 8
const DATACENTRE_BASE_MS = 1
const GEO_SIGMA = 0.25

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

export function greatCircleDistanceKm(a: Coordinates, b: Coordinates): number {
  const latDelta = degreesToRadians(b.latitude - a.latitude)
  const lonDelta = degreesToRadians(b.longitude - a.longitude)
  const latA = degreesToRadians(a.latitude)
  const latB = degreesToRadians(b.latitude)
  const haversine =
    Math.sin(latDelta / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(lonDelta / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function medianForDistribution(distribution: DistributionConfig): number {
  switch (distribution.type) {
    case 'constant':
    case 'deterministic':
      return distribution.value
    case 'log-normal':
      return Math.exp(distribution.mu)
    case 'normal':
      return distribution.mean
    case 'uniform':
      return (distribution.min + distribution.max) / 2
    case 'exponential':
      return Math.log(2) / distribution.lambda
    case 'weibull':
      return distribution.scale * Math.log(2) ** (1 / distribution.shape)
    case 'poisson':
      return distribution.lambda
    case 'binomial':
      return distribution.n * distribution.p
    case 'gamma':
      return distribution.shape * distribution.scale
    case 'beta':
      return distribution.alpha / (distribution.alpha + distribution.beta)
    case 'pareto':
      return distribution.scale * 2 ** (1 / distribution.shape)
    case 'empirical':
      return [...distribution.samples].sort((left, right) => left - right)[
        Math.floor((distribution.samples.length - 1) / 2)
      ]
    case 'mixture':
      return distribution.components.reduce(
        (sum, component) => sum + component.weight * medianForDistribution(component.distribution),
        0
      )
  }
}

/**
 * Resolves request-aware propagation distributions without mutating authored
 * edges. Explicit edge latency remains authoritative; geo-aware replacement is
 * only considered for an edge marked derivedFromPathType.
 */
export class GeoLatencyResolver {
  private readonly locationsById = new Map<string, TopologyLocation>()
  private readonly nodesById = new Map<string, ComponentNode>()

  constructor(private readonly topology: TopologyJSON) {
    for (const location of topology.locations ?? []) this.locationsById.set(location.id, location)
    for (const node of topology.nodes) this.nodesById.set(node.id, node)
  }

  isEnabled(): boolean {
    return this.topology.networkModel?.mode === 'geo-aware'
  }

  servingRegionId(nodeId: string): string | undefined {
    return this.nodesById.get(nodeId)?.placement?.regionId
  }

  locationLabel(locationId: string): string | undefined {
    return this.locationsById.get(locationId)?.label
  }

  locationDisplayName(locationId: string): string | undefined {
    const location = this.locationsById.get(locationId)
    if (!location) return undefined
    return location.providerCode ? `${location.label} (${location.providerCode})` : location.label
  }

  distributionFor(edge: EdgeDefinition, request: Request): DistributionConfig | null {
    if (!this.isEnabled() || edge.latency.derivedFromPathType !== true) return null

    const sourceRegionId = this.sourceRegionId(edge, request)
    const targetRegionId = this.servingRegionId(edge.target)
    const override = this.pairOverride(sourceRegionId, targetRegionId)
    if (override) return override

    // Inside one deployment region, the existing same-rack/same-dc/cross-zone
    // profiles are more precise than metro-centre coordinates. Client-origin
    // hops still use geo modelling so last-mile latency is represented.
    if (
      !this.shouldUseRequestOrigin(edge, request) &&
      sourceRegionId &&
      sourceRegionId === targetRegionId
    ) {
      return null
    }

    const sourcePoint = this.sourceCoordinates(edge, request)
    const targetPoint = this.locationCoordinates(targetRegionId)
    if (!sourcePoint || !targetPoint) return null

    const isClientHop =
      edge.source === this.topology.workload?.sourceNodeId && request.origin !== undefined
    const distanceKm = greatCircleDistanceKm(sourcePoint, targetPoint)
    const medianMs = Math.max(
      isClientHop ? CLIENT_LAST_MILE_MS : DATACENTRE_BASE_MS,
      (distanceKm / FIBRE_KM_PER_MS) * ROUTE_INFLATION +
        (isClientHop ? CLIENT_LAST_MILE_MS : DATACENTRE_BASE_MS)
    )
    return { type: 'log-normal', mu: Math.log(medianMs), sigma: GEO_SIGMA }
  }

  estimateEdgeLatencyMs(edge: EdgeDefinition, request: Request): number {
    const distribution =
      this.distributionFor(edge, request) ??
      (edge.latency.derivedFromPathType
        ? getPathTypeLatencyProfile(edge.latency.pathType)
        : edge.latency.distribution)
    return Math.max(0, medianForDistribution(distribution))
  }

  private pairOverride(
    sourceRegionId: string | undefined,
    targetRegionId: string | undefined
  ): DistributionConfig | null {
    if (!sourceRegionId || !targetRegionId) return null
    const pairs = this.topology.networkModel?.regionPairOverrides ?? []
    const exact = pairs.find(
      (pair) => pair.fromRegionId === sourceRegionId && pair.toRegionId === targetRegionId
    )
    if (exact) return exact.distribution
    const reverse = pairs.find(
      (pair) => pair.fromRegionId === targetRegionId && pair.toRegionId === sourceRegionId
    )
    return reverse?.distribution ?? null
  }

  private sourceRegionId(edge: EdgeDefinition, request: Request): string | undefined {
    if (this.shouldUseRequestOrigin(edge, request) && request.origin?.location.kind === 'region') {
      return request.origin.location.regionId
    }
    return this.servingRegionId(edge.source)
  }

  private sourceCoordinates(edge: EdgeDefinition, request: Request): Coordinates | undefined {
    if (this.shouldUseRequestOrigin(edge, request) && request.origin) {
      return this.originCoordinates(request.origin.location)
    }
    return this.locationCoordinates(this.servingRegionId(edge.source))
  }

  /**
   * Logical global routers are commonly left outside a deployment region. In
   * that case their candidate-edge estimates should remain anchored at the
   * client, not at an invented router location.
   */
  private shouldUseRequestOrigin(edge: EdgeDefinition, request: Request): boolean {
    return Boolean(
      request.origin &&
      (edge.source === this.topology.workload?.sourceNodeId ||
        this.servingRegionId(edge.source) === undefined)
    )
  }

  private originCoordinates(origin: TrafficOriginLocation): Coordinates | undefined {
    if (origin.kind === 'coordinates') {
      return { latitude: origin.latitude, longitude: origin.longitude }
    }
    return this.locationCoordinates(origin.regionId)
  }

  private locationCoordinates(locationId: string | undefined): Coordinates | undefined {
    if (!locationId) return undefined
    const location = this.locationsById.get(locationId)
    if (!location) return undefined
    if (location.coordinates) return location.coordinates
    const catalogue = findCloudRegion(location.provider, location.providerCode)
    return catalogue ? { latitude: catalogue.latitude, longitude: catalogue.longitude } : undefined
  }
}
