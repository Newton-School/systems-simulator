import { describe, expect, it } from 'vitest'
import { SAMPLE_SCENARIOS } from './sampleScenarios'

function collectLocationIds(
  nodes: Array<{ data?: { sim?: { locationId?: string } }; nodes?: unknown[] }>
): string[] {
  return nodes.flatMap((node) => {
    const own = node.data?.sim?.locationId ? [node.data.sim.locationId] : []
    const children = Array.isArray(node.nodes)
      ? collectLocationIds(
          node.nodes as Array<{ data?: { sim?: { locationId?: string } }; nodes?: unknown[] }>
        )
      : []
    return [...own, ...children]
  })
}

describe('SAMPLE_SCENARIOS composite examples', () => {
  it('includes canvas-backed composite-node samples in the scenarios catalog', () => {
    const multiAz = SAMPLE_SCENARIOS.find((sample) => sample.id === 'multi-az-auto-latency')
    const crossRegion = SAMPLE_SCENARIOS.find((sample) => sample.id === 'cross-region-auto-latency')

    expect(multiAz).toBeDefined()
    expect(crossRegion).toBeDefined()

    const multiAzData = JSON.parse(multiAz!.raw) as {
      nodes: Array<{ type: string; nodes?: unknown[] }>
    }
    const crossRegionData = JSON.parse(crossRegion!.raw) as {
      nodes: Array<{ type: string; data?: { sim?: { locationId?: string } }; nodes?: unknown[] }>
    }
    const crossRegionLocationIds = collectLocationIds(crossRegionData.nodes)

    expect(multiAzData.nodes[0]?.type).toBe('vpcNode')
    expect(Array.isArray(multiAzData.nodes[0]?.nodes)).toBe(true)
    expect(crossRegionLocationIds.length).toBeGreaterThanOrEqual(3)
    expect(crossRegionLocationIds.some((value) => value.includes('us-east'))).toBe(true)
  })

  it('includes the endpoint-aware routing sample with HTTP metadata and L7 rules', () => {
    const endpointMix = SAMPLE_SCENARIOS.find(
      (sample) => sample.id === 'endpoint-routing-request-mix'
    )

    expect(endpointMix).toBeDefined()

    const sampleData = JSON.parse(endpointMix!.raw) as {
      nodes: Array<{
        id: string
        data?: {
          source?: {
            requestDistribution?: Array<{
              metadata?: { method?: string; host?: string; path?: string }
            }>
          }
          sim?: {
            routingRules?: Array<{
              matchField?: string
              matchValue?: string
              targetNodeId?: string
            }>
          }
        }
      }>
    }

    const sourceNode = sampleData.nodes.find((node) => node.id === 'client')
    const gatewayNode = sampleData.nodes.find((node) => node.id === 'api-gateway')

    expect(sourceNode?.data?.source?.requestDistribution).toHaveLength(3)
    expect(
      sourceNode?.data?.source?.requestDistribution?.every(
        (entry) => entry.metadata?.method && entry.metadata?.host && entry.metadata?.path
      )
    ).toBe(true)
    expect(gatewayNode?.data?.sim?.routingRules).toHaveLength(3)
    expect(gatewayNode?.data?.sim?.routingRules?.every((rule) => rule.matchField === 'path')).toBe(
      true
    )
  })

  it('includes the idempotency guard sample with repeated keys and guard config', () => {
    const idempotencySample = SAMPLE_SCENARIOS.find(
      (sample) => sample.id === 'payment-idempotency-dedup'
    )

    expect(idempotencySample).toBeDefined()

    const sampleData = JSON.parse(idempotencySample!.raw) as {
      nodes: Array<{
        id: string
        data?: {
          source?: {
            requestDistribution?: Array<{
              metadata?: { idempotencyKey?: string }
            }>
          }
          sim?: {
            dedupKeyField?: string
            dedupWindowMs?: number
            storeLookupMs?: number
          }
        }
      }>
    }

    const sourceNode = sampleData.nodes.find((node) => node.id === 'client')
    const guardNode = sampleData.nodes.find((node) => node.id === 'idempotency')

    expect(sourceNode?.data?.source?.requestDistribution).toHaveLength(3)
    expect(
      sourceNode?.data?.source?.requestDistribution?.every((entry) =>
        entry.metadata?.idempotencyKey?.startsWith('pay-')
      )
    ).toBe(true)
    expect(guardNode?.data?.sim).toMatchObject({
      dedupKeyField: 'idempotencyKey',
      dedupWindowMs: 300000,
      storeLookupMs: 2
    })
  })
})
