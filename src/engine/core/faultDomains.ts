import type { TopologyJSON, TopologyLocation, TopologyLocationKind } from './types'

/**
 * Fault domains: a fault whose `targetId` is a Region / Availability Zone /
 * Subnet location (TopologyJSON `locations[]`) fails every component placed
 * inside it, transitively, for the fault's window.
 *
 * Membership comes only from the exported topology - each node's `placement`
 * (regionId / availabilityZoneId / subnetId) plus the `parentId` chain of the
 * locations - never from the canvas. A node is inside location L when L is one
 * of its placement ids or an ancestor of one of them, so a node placed only in
 * a subnet still falls with that subnet's zone and region.
 *
 * The workload source node is never a member: it stands for the client
 * population, not a server in that zone, so a zone outage does not stop
 * clients from sending (what they send to the failed zone is what fails).
 */

/** The domain a node-failure / node-recovery event was caused by. */
export interface FaultDomainRef {
  id: string
  label: string
  kind: TopologyLocationKind
  /** Provider code (e.g. `us-east-1a`) when the location names one. */
  providerCode?: string
}

const KIND_PHRASES: Record<TopologyLocationKind, string> = {
  region: 'region',
  'availability-zone': 'availability zone',
  subnet: 'subnet',
  'edge-pop': 'edge location'
}

export function faultDomainKindPhrase(kind: string): string {
  return KIND_PHRASES[kind as TopologyLocationKind] ?? 'location'
}

export function findFaultDomain(
  topology: Pick<TopologyJSON, 'locations'>,
  id: string
): TopologyLocation | undefined {
  return (topology.locations ?? []).find((location) => location.id === id)
}

export function faultDomainRef(location: TopologyLocation): FaultDomainRef {
  return {
    id: location.id,
    label: location.label || location.id,
    kind: location.kind,
    ...(location.providerCode ? { providerCode: location.providerCode } : {})
  }
}

/** The location ids a node sits inside: its placement ids and all their ancestors. */
export function enclosingLocationIds(
  topology: Pick<TopologyJSON, 'locations'>,
  node: TopologyJSON['nodes'][number]
): Set<string> {
  const parentById = new Map(
    (topology.locations ?? []).map((location) => [location.id, location.parentId] as const)
  )
  const enclosing = new Set<string>()
  const placement = node.placement
  for (const start of [placement?.subnetId, placement?.availabilityZoneId, placement?.regionId]) {
    let current = start
    while (current && !enclosing.has(current)) {
      enclosing.add(current)
      current = parentById.get(current)
    }
  }
  return enclosing
}

/** Node ids (in topology order) a fault on `locationId` takes down. */
export function faultDomainMemberIds(
  topology: Pick<TopologyJSON, 'locations' | 'nodes' | 'workload'>,
  locationId: string
): string[] {
  const sourceNodeId = topology.workload?.sourceNodeId
  return topology.nodes
    .filter(
      (node) =>
        node.id !== sourceNodeId &&
        node.role !== 'source' &&
        enclosingLocationIds(topology, node).has(locationId)
    )
    .map((node) => node.id)
}

type FaultDomainNaming = Pick<FaultDomainRef, 'label' | 'kind'> & { providerCode?: string }

/** "AZ A (us-east-1a)" - the label, plus the provider code when it adds something. */
export function faultDomainName(ref: FaultDomainNaming): string {
  const code = ref.providerCode?.trim()
  return code && code !== ref.label ? `${ref.label} (${code})` : ref.label
}

/** "availability zone AZ A (us-east-1a)" - how results name a failed domain. */
export function describeFaultDomain(ref: FaultDomainNaming): string {
  return `${faultDomainKindPhrase(ref.kind)} ${faultDomainName(ref)}`
}

/** Reads a FaultDomainRef back off a loosely-typed event payload. */
export function readFaultDomainRef(raw: unknown): FaultDomainRef | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.kind !== 'string') return null
  return {
    id: record.id,
    label: typeof record.label === 'string' && record.label ? record.label : record.id,
    kind: record.kind as TopologyLocationKind,
    ...(typeof record.providerCode === 'string' && record.providerCode
      ? { providerCode: record.providerCode }
      : {})
  }
}
