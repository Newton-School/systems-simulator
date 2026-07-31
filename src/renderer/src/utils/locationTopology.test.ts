import { describe, expect, it } from 'vitest'
import {
  buildEdgeLocalityRollups,
  buildLocationTopology,
  buildNodeLocationRollups,
  describeEdgeLocality,
  formatNodeLocation,
  type EdgeRollupInput,
  type NodeRollupInput
} from './locationTopology'

const nodes = [
  {
    id: 'region-us',
    data: { templateId: 'vpc-region', label: 'US East', sim: { locationId: 'us-east-1' } }
  },
  {
    id: 'az-a',
    parentNode: 'region-us',
    data: { templateId: 'availability-zone', label: 'AZ A', sim: { locationId: 'us-east-1a' } }
  },
  {
    id: 'subnet-a',
    parentNode: 'az-a',
    data: { templateId: 'subnet', label: 'Subnet A', sim: { locationId: '10.0.1.0/24' } }
  },
  {
    id: 'az-b',
    parentNode: 'region-us',
    data: { templateId: 'availability-zone', label: 'AZ B', sim: { locationId: 'us-east-1b' } }
  },
  {
    id: 'subnet-b',
    parentNode: 'az-b',
    data: { templateId: 'subnet', label: 'Subnet B', sim: { locationId: '10.0.2.0/24' } }
  },
  {
    id: 'region-eu',
    data: { templateId: 'vpc-region', label: 'EU West', sim: { locationId: 'eu-west-1' } }
  },
  {
    id: 'az-eu',
    parentNode: 'region-eu',
    data: { templateId: 'availability-zone', label: 'AZ EU', sim: { locationId: 'eu-west-1a' } }
  },
  {
    id: 'subnet-eu',
    parentNode: 'az-eu',
    data: { templateId: 'subnet', label: 'Subnet EU', sim: { locationId: '10.1.1.0/24' } }
  },
  { id: 'web', parentNode: 'subnet-a', data: { templateId: 'client-user', label: 'Web' } },
  { id: 'api', parentNode: 'subnet-b', data: { templateId: 'backend-server', label: 'API' } },
  { id: 'fraud', parentNode: 'subnet-eu', data: { templateId: 'backend-server', label: 'Fraud' } }
]

describe('locationTopology', () => {
  it('resolves node ancestry labels and rollups', () => {
    const topology = buildLocationTopology(nodes)
    const nodeRollups = buildNodeLocationRollups(topology, [
      {
        nodeId: 'web',
        postWarmupArrived: 0,
        postWarmupProcessed: 0,
        totalFailures: 0,
        throughput: 0,
        utilization: null,
        p95: null,
        active: false,
        isSource: true
      },
      {
        nodeId: 'api',
        postWarmupArrived: 120,
        postWarmupProcessed: 118,
        totalFailures: 2,
        throughput: 58,
        utilization: 0.72,
        p95: 95,
        active: true
      },
      {
        nodeId: 'fraud',
        postWarmupArrived: 40,
        postWarmupProcessed: 38,
        totalFailures: 2,
        throughput: 19,
        utilization: 0.44,
        p95: 180,
        active: true
      }
    ] satisfies NodeRollupInput[])

    expect(formatNodeLocation(topology.nodeLocations.get('api'))).toBe(
      'us-east-1 / us-east-1b / 10.0.2.0/24'
    )
    expect(nodeRollups.region[0]).toMatchObject({
      label: 'us-east-1',
      nodeCount: 2,
      activeNodeCount: 1,
      sourceCount: 1
    })
    expect(nodeRollups.region[1]).toMatchObject({
      label: 'eu-west-1',
      totalArrived: 40,
      worstP95: 180
    })
  })

  it('describes edge locality and aggregates traffic by locality group', () => {
    const topology = buildLocationTopology(nodes)
    const sameRegion = describeEdgeLocality(topology, {
      source: 'web',
      target: 'api',
      data: {}
    })
    const crossRegion = describeEdgeLocality(topology, {
      source: 'web',
      target: 'fraud',
      data: {}
    })
    const rollups = buildEdgeLocalityRollups(topology, [
      {
        edgeId: 'web-api',
        source: 'web',
        target: 'api',
        data: {},
        attempts: 120,
        failures: 2,
        p95: 96
      },
      {
        edgeId: 'web-fraud',
        source: 'web',
        target: 'fraud',
        data: {},
        attempts: 40,
        failures: 4,
        p95: 182
      }
    ] satisfies EdgeRollupInput[])

    expect(sameRegion).toMatchObject({
      pathType: 'cross-zone',
      detailLabel: 'us-east-1a -> us-east-1b'
    })
    expect(crossRegion).toMatchObject({
      pathType: 'cross-region',
      detailLabel: 'us-east-1 -> eu-west-1'
    })
    expect(rollups[0]).toMatchObject({
      pathType: 'cross-zone',
      attempts: 120
    })
    expect(rollups[1]).toMatchObject({
      pathType: 'cross-region',
      failures: 4
    })
  })
})
