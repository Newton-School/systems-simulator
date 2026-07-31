import { describe, expect, it } from 'vitest'
import type { AnyNodeData } from '@renderer/types/ui'
import {
  resolveDisplayedSourceWorkload,
  resolveEffectiveSelectedSourceNodeId,
  updateWorkloadOverrideForField,
  withDisplayedSourceWorkload
} from './useEffectiveSourceWorkload'

function sourceNode(id: string): { id: string; data: AnyNodeData } {
  return {
    id,
    data: {
      schemaVersion: '2.0.0',
      templateId: 'client-app',
      profile: 'source',
      structuralRole: 'leaf',
      rendererType: 'compute',
      label: 'Client App',
      iconKey: 'client-app',
      source: {
        requestDistribution: 'independent',
        defaultWorkload: {
          pattern: 'poisson',
          baseRps: 120
        }
      }
    } as unknown as AnyNodeData
  }
}

describe('resolveEffectiveSelectedSourceNodeId', () => {
  it('falls back to the first source node when none is explicitly selected', () => {
    const selected = resolveEffectiveSelectedSourceNodeId(
      [sourceNode('client-a'), sourceNode('client-b')],
      undefined
    )

    expect(selected).toBe('client-a')
  })

  it('falls back to the first source node when the selected id is missing', () => {
    const selected = resolveEffectiveSelectedSourceNodeId(
      [sourceNode('client-a'), sourceNode('client-b')],
      'missing-client'
    )

    expect(selected).toBe('client-a')
  })
})

describe('resolveDisplayedSourceWorkload', () => {
  it('uses the scenario override for the effective selected source', () => {
    const workload = resolveDisplayedSourceWorkload('client', sourceNode('client').data, 'client', {
      baseRps: 100
    })

    expect(workload?.pattern).toBe('poisson')
    expect(workload?.baseRps).toBe(100)
  })

  it('keeps the node default workload for non-selected source nodes', () => {
    const workload = resolveDisplayedSourceWorkload(
      'client-b',
      sourceNode('client-b').data,
      'client-a',
      { baseRps: 100 }
    )

    expect(workload?.baseRps).toBe(120)
  })
})

describe('withDisplayedSourceWorkload', () => {
  it('overlays the displayed source workload onto source node data', () => {
    const next = withDisplayedSourceWorkload(sourceNode('client').data, {
      pattern: 'poisson',
      baseRps: 100
    })

    expect(next.source?.defaultWorkload.baseRps).toBe(100)
    expect(next.source?.defaultWorkload.pattern).toBe('poisson')
  })
})

describe('updateWorkloadOverrideForField', () => {
  it('writes source workload fields into the scenario override shape', () => {
    const next = updateWorkloadOverrideForField({}, 'source.defaultWorkload.baseRps', 100)

    expect(next).toEqual({ baseRps: 100 })
  })

  it('removes cleared override leaves instead of storing undefined', () => {
    const next = updateWorkloadOverrideForField(
      {
        bursty: {
          burstRps: 500,
          burstDuration: 2000,
          normalDuration: 8000
        }
      },
      'source.defaultWorkload.bursty.burstRps',
      undefined
    )

    expect(next).toEqual({
      bursty: {
        burstDuration: 2000,
        normalDuration: 8000
      }
    })
  })
})
