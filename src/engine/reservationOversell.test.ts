import { describe, expect, it } from 'vitest'
import { SimulationEngine } from './engine'
import { projectToVerdict } from './analysis/verdict'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from './core/types'

const SEAT_KEYSPACE = 40

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'grpc',
    latency: { distribution: { type: 'constant', value: 1 }, pathType: 'same-dc' },
    bandwidth: 10_000,
    maxConcurrentRequests: 100_000,
    packetLossRate: 0,
    errorRate: 0
  }
}

function gateway(routingStrategy?: string): ComponentNode {
  return {
    id: 'gw',
    type: 'api-gateway',
    category: 'network-and-edge',
    label: 'Booking Gateway',
    position: { x: 0, y: 0 },
    queue: { workers: 64, capacity: 5_000, discipline: 'fifo' },
    ...(routingStrategy ? { config: { routingStrategy } } : {})
  }
}

function reservation(id: string): ComponentNode {
  return {
    id,
    type: 'reservation-store',
    category: 'auxiliary',
    label: id,
    position: { x: 0, y: 0 },
    queue: { workers: 32, capacity: 5_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 2 }, timeout: 2_000 },
    config: { resourceKeyField: 'seatId' }
  }
}

function sink(): ComponentNode {
  return {
    id: 'ledger',
    type: 'relational-db',
    category: 'storage-and-data',
    label: 'Ledger',
    position: { x: 0, y: 0 },
    queue: { workers: 32, capacity: 5_000, discipline: 'fifo' },
    processing: { distribution: { type: 'constant', value: 3 }, timeout: 2_000 }
  }
}

function baseTopology(nodes: ComponentNode[], edges: EdgeDefinition[]): TopologyJSON {
  return {
    id: 'flash-sale',
    name: 'Flash Sale',
    version: '1.0.0',
    global: {
      simulationDuration: 8_000,
      seed: 'flash-sale-seed',
      warmupDuration: 500,
      timeResolution: 'microsecond',
      defaultTimeout: 2_000
    },
    nodes,
    edges,
    workload: {
      sourceNodeId: 'gw',
      pattern: 'constant',
      baseRps: 1_200,
      requestDistribution: [
        {
          type: 'book',
          weight: 1,
          sizeBytes: 512,
          keyspace: { field: 'seatId', size: SEAT_KEYSPACE }
        }
      ]
    }
  }
}

function runVerdict(topology: TopologyJSON) {
  return projectToVerdict(new SimulationEngine(topology).run())
}

describe('reservation oversell (engine integration)', () => {
  it('a single reservation authority commits seats and never oversells', () => {
    const verdict = runVerdict(
      baseTopology(
        [gateway(), reservation('reservation'), sink()],
        [edge('gw', 'reservation'), edge('reservation', 'ledger')]
      )
    )

    // The keyspace workload actually stamped seat keys and drove atomic reserves…
    expect(verdict.reservations.commits).toBeGreaterThan(0)
    // …and each seat was committed by exactly one authority → zero double-booking.
    expect(verdict.reservations.oversells).toBe(0)
    // Every seat can be committed at most once, so commits are bounded by the keyspace.
    expect(verdict.reservations.commits).toBeLessThanOrEqual(SEAT_KEYSPACE)
  })

  it('two independent reservation authorities double-book seats (oversell > 0)', () => {
    const verdict = runVerdict(
      baseTopology(
        [
          gateway('round-robin'),
          reservation('reservation-a'),
          reservation('reservation-b'),
          sink()
        ],
        [
          edge('gw', 'reservation-a'),
          edge('gw', 'reservation-b'),
          edge('reservation-a', 'ledger'),
          edge('reservation-b', 'ledger')
        ]
      )
    )

    expect(verdict.reservations.commits).toBeGreaterThan(0)
    // The same seat reaches both uncoordinated authorities → real oversell.
    expect(verdict.reservations.oversells).toBeGreaterThan(0)
  })
})
