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
})
