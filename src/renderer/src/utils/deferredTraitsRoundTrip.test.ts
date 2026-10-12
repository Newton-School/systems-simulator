import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../../../engine/core/types'
import clusterSample from '../../../engine/__samples__/topology/cluster-bin-packing.json'
import telemetrySample from '../../../engine/__samples__/topology/telemetry-fire-and-forget.json'
import cdcSample from '../../../engine/__samples__/topology/cdc-change-ordering.json'
import pushSample from '../../../engine/__samples__/topology/websocket-push-fanout.json'
import { getComponentSpec } from '../../../engine/catalog/componentSpecs'
import type { CanvasNodeDataV2 } from '../../../engine/catalog/nodeSpecTypes'
import { topologyToCanvasFileData } from './topologyCanvasAdapter'

function serializedConfig(
  topology: TopologyJSON,
  nodeId: string,
  edit?: (data: CanvasNodeDataV2) => void
) {
  const canvas = topologyToCanvasFileData(topology)
  const node = canvas.nodes.find((candidate) => candidate.id === nodeId)!
  const data = structuredClone(node.data)
  edit?.(data)
  return {
    sim: data.sim,
    config: getComponentSpec(data.componentType)!.serializeCanvas(data, {
      nodeId,
      position: node.position
    })!.config
  }
}

describe('deferred-trait fields round-trip canvas <-> TopologyJSON', () => {
  it('scheduler: cluster and workload fields', () => {
    const cluster = serializedConfig(clusterSample as TopologyJSON, 'k8s')
    expect(cluster.sim).toMatchObject({
      placementStrategy: 'bin-pack',
      podStartupMs: 1000,
      rescheduleDelayMs: 3000,
      machineFailureAtMs: 5000
    })
    expect(cluster.config).toMatchObject({
      placementStrategy: 'bin-pack',
      machineFailureAtMs: 5000
    })
    const api = serializedConfig(clusterSample as TopologyJSON, 'api', (data) => {
      data.sim = { ...data.sim, scheduledOn: ' k8s ' }
    })
    expect(api.config?.['scheduledOn']).toBe('k8s')
  })

  it('telemetry sink, change stream and held connections', () => {
    const logs = serializedConfig(telemetrySample as TopologyJSON, 'logs', (data) => {
      data.sim = { ...data.sim, telemetryIngestRps: 30, telemetrySampleRate: 0.2 }
    })
    expect(logs.config).toMatchObject({
      telemetryAsyncIngest: true,
      telemetryIngestRps: 30,
      telemetrySampleRate: 0.2
    })
    const cdc = serializedConfig(cdcSample as TopologyJSON, 'cdc', (data) => {
      data.sim = { ...data.sim, consumerOrdering: 'per-key', changeKeyField: 'orderId' }
    })
    expect(cdc.config).toMatchObject({
      changeStreamOrdering: true,
      consumerOrdering: 'per-key',
      changeKeyField: 'orderId'
    })
    const gw = serializedConfig(pushSample as TopologyJSON, 'gw')
    expect(gw.sim?.connection).toMatchObject({
      offeredConnections: 200000,
      maxConnectionsPerInstance: 65000,
      heartbeatIntervalMs: 30000
    })
    expect(gw.config).toMatchObject({
      heldConnections: 200000,
      maxConnectionsPerInstance: 65000,
      heartbeatIntervalMs: 30000,
      pushRecipients: 1000
    })
  })

  it('an untouched Connection Server (0 offered connections) exports no held connections', () => {
    const gw = serializedConfig(pushSample as TopologyJSON, 'gw', (data) => {
      data.sim = { ...data.sim, connection: { ...data.sim!.connection!, offeredConnections: 0 } }
    })
    expect(gw.config?.['heldConnections']).toBeUndefined()
  })
})
