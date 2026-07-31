import { describe, expect, it } from 'vitest'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import { L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE } from '../../../engine/traits/contentRouting'
import { getNodeConfigSections } from './fieldConfig'

function makeRuntimeNode(
  overrides: Partial<CanvasNodeDataV2> &
    Pick<CanvasNodeDataV2, 'templateId' | 'componentType' | 'profile'>
): CanvasNodeDataV2 {
  return {
    schemaVersion: 2,
    templateId: overrides.templateId,
    componentType: overrides.componentType,
    structuralRole: overrides.structuralRole ?? 'processor',
    profile: overrides.profile,
    rendererType: overrides.rendererType ?? 'serviceNode',
    label: overrides.label ?? 'Node',
    iconKey: overrides.iconKey ?? 'server',
    sim: overrides.sim ?? {
      queue: { workers: 8, capacity: 10, discipline: 'fifo' },
      processing: {
        distribution: { type: 'exponential', lambda: 6.666666666667 },
        timeout: 100
      }
    },
    source: overrides.source,
    routingStrategy: overrides.routingStrategy,
    subLabel: overrides.subLabel,
    ui: overrides.ui
  }
}

function makeCompositeNode(
  overrides: Partial<CanvasNodeDataV2> & Pick<CanvasNodeDataV2, 'templateId' | 'label' | 'iconKey'>
): CanvasNodeDataV2 {
  return {
    schemaVersion: 2,
    templateId: overrides.templateId,
    structuralRole: 'composite',
    profile: 'composite',
    rendererType: 'vpcNode',
    label: overrides.label,
    subLabel: overrides.subLabel,
    iconKey: overrides.iconKey,
    sim: overrides.sim,
    source: overrides.source,
    routingStrategy: overrides.routingStrategy,
    ui: overrides.ui
  }
}

describe('getNodeConfigSections', () => {
  it('composes L4 config from modules with relabeled queue fields and a locked content-routing note', () => {
    const data = makeRuntimeNode({
      templateId: 'load-balancer-l4',
      componentType: 'load-balancer-l4',
      structuralRole: 'router',
      profile: 'router',
      routingStrategy: 'round-robin',
      label: 'Load Balancer L4'
    })

    const sections = getNodeConfigSections(data)
    const routing = sections.find((section) => section.id === 'routing')
    const queueing = sections.find((section) => section.id === 'queueing')
    const processing = sections.find((section) => section.id === 'processing')
    const contentRouting = sections.find((section) => section.id === 'routing.content:forbidden')

    expect(routing?.fields.map((field) => field.label)).toEqual(['Strategy', 'Health checks'])
    expect(queueing?.title).toBe('Forwarding')
    expect(queueing?.fields.map((field) => field.label)).toEqual([
      'Max concurrent connections',
      'Connection queue limit',
      'Queue discipline'
    ])
    expect(contentRouting?.note).toEqual({
      tone: 'locked',
      text: L4_CONTENT_ROUTING_FORBIDDEN_MESSAGE
    })

    const meanLatencyField = processing?.fields.find(
      (field) => field.path === 'sim.processing.distribution.lambda'
    )
    expect(meanLatencyField?.label).toBe('Mean service time')
    expect(meanLatencyField?.displayAs?.toDisplay(6.666666666667, data)).toBeCloseTo(0.15, 2)
    expect(meanLatencyField?.displayAs?.fromDisplay(0.15, data)).toBeCloseTo(6.666666666667, 6)
  })

  it('adds an honesty note for discovery service while still composing the shared base config', () => {
    const data = makeRuntimeNode({
      templateId: 'discovery-service',
      componentType: 'service-registry',
      structuralRole: 'processor',
      profile: 'control-plane',
      label: 'Discovery Service'
    })

    const sections = getNodeConfigSections(data)
    const model = sections.find((section) => section.id === 'model')
    const queueing = sections.find((section) => section.id === 'queueing')

    expect(model?.note?.text).toContain('generic request queue')
    expect(model?.note?.text).toContain('heartbeats')
    expect(queueing?.title).toBe('Discovery')
    expect(queueing?.fields[0]?.label).toBe('Lookup concurrency')
  })

  it('keeps replica role honest while hiding primary-only read/write latency fields', () => {
    const data = makeRuntimeNode({
      templateId: 'read-replica',
      componentType: 'relational-db',
      structuralRole: 'storage',
      profile: 'datastore',
      label: 'Read Replica',
      sim: {
        queue: { workers: 8, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'exponential', lambda: 0.125 },
          timeout: 100
        },
        replicationRole: 'replica'
      }
    })

    const sections = getNodeConfigSections(data)
    const role = sections.find((section) => section.id === 'replica-role')
    const readWrite = sections.find((section) => section.id === 'read-write')
    const slo = sections.find((section) => section.id === 'slo')
    const availabilityTarget = slo?.fields.find(
      (field) => field.path === 'sim.slo.availabilityTarget'
    )

    expect(role?.note?.text).toContain('read-only replica')
    expect(readWrite).toBeUndefined()
    expect(availabilityTarget?.optional).toBe(true)
    expect(availabilityTarget?.displayAs?.toDisplay(0.999, data)).toBe(99.9)
    expect(availabilityTarget?.displayAs?.fromDisplay(99.9, data)).toBeCloseTo(0.999, 6)
  })

  it('marks free-form metadata fields as text inputs', () => {
    const composite = makeCompositeNode({
      templateId: 'availability-zone',
      label: 'AZ A',
      iconKey: 'az',
      sim: { locationId: 'us-east-1a' }
    })
    const keyRouter = makeRuntimeNode({
      templateId: 'sharding',
      componentType: 'sharding',
      structuralRole: 'router',
      profile: 'router',
      label: 'Shard Router',
      sim: {
        queue: { workers: 8, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'exponential', lambda: 0.125 },
          timeout: 100
        },
        routingKeyField: 'tenantId'
      }
    })

    const compositeSections = getNodeConfigSections(composite)
    const locationField = compositeSections
      .find((section) => section.id === 'location')
      ?.fields.find((field) => field.path === 'sim.locationId')
    const routingKeyField = getNodeConfigSections(keyRouter)
      .find((section) => section.id === 'key-routing')
      ?.fields.find((field) => field.path === 'sim.routingKeyField')

    expect(locationField?.inputType).toBe('text')
    expect(routingKeyField?.inputType).toBe('text')
    expect(compositeSections.find((section) => section.id === 'location')?.note?.text).toContain(
      'renderer-side location rollups'
    )
  })

  it('adds a structured request-template editor for source nodes', () => {
    const source = makeRuntimeNode({
      templateId: 'client-user',
      componentType: 'api-endpoint',
      structuralRole: 'source',
      profile: 'source',
      label: 'Client App',
      source: {
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }],
        defaultWorkload: {
          pattern: 'poisson',
          baseRps: 100,
          bursty: { burstRps: 500, burstDuration: 2000, normalDuration: 8000 },
          spike: { spikeTime: 30000, spikeRps: 1000, spikeDuration: 5000 },
          sawtooth: { peakRps: 300, rampDuration: 10000 },
          diurnal: {
            peakMultiplier: 1,
            hourlyMultipliers: [
              0.6, 0.5, 0.45, 0.4, 0.4, 0.5, 0.7, 0.9, 1.1, 1.2, 1.15, 1.05, 1, 1.05, 1.1, 1.2,
              1.25, 1.3, 1.2, 1.05, 0.95, 0.85, 0.75, 0.65
            ]
          }
        }
      }
    })

    const requestTemplatesField = getNodeConfigSections(source)
      .find((section) => section.id === 'request-templates')
      ?.fields.find((field) => field.path === 'source.requestDistribution')

    expect(requestTemplatesField?.renderer).toBe('request-distribution')
    expect(requestTemplatesField?.inputType).toBe('text')
  })

  it('shows workload config sections for workload-overlay entrypoints', () => {
    const gateway = makeRuntimeNode({
      templateId: 'api-gateway',
      componentType: 'api-gateway',
      structuralRole: 'router',
      profile: 'router',
      label: 'API Gateway',
      source: {
        requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }],
        defaultWorkload: {
          pattern: 'poisson',
          baseRps: 100,
          bursty: { burstRps: 500, burstDuration: 2000, normalDuration: 8000 },
          spike: { spikeTime: 30000, spikeRps: 1000, spikeDuration: 5000 },
          sawtooth: { peakRps: 300, rampDuration: 10000 },
          diurnal: {
            peakMultiplier: 1,
            hourlyMultipliers: [
              0.6, 0.5, 0.45, 0.4, 0.4, 0.5, 0.7, 0.9, 1.1, 1.2, 1.15, 1.05, 1, 1.05, 1.1, 1.2,
              1.25, 1.3, 1.2, 1.05, 0.95, 0.85, 0.75, 0.65
            ]
          }
        }
      }
    })

    const sections = getNodeConfigSections(gateway)

    expect(sections.find((section) => section.id === 'workload')).toBeTruthy()
    expect(sections.find((section) => section.id === 'request-templates')).toBeTruthy()
  })
})
