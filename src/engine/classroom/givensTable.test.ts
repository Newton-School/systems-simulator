import { describe, expect, it } from 'vitest'
import type { QuestionPackage } from '../analysis/question'
import { runSimulation } from '../runSimulation'
import type { TopologyJSON } from '../core/types'
import { classroomGivensTable, formatPercent, formatRps } from './givensTable'
import { compileClassroomTopology } from './compileClassroom'
import { summarizeClassroomRun } from './runSummary'
import type { ClassroomSettings } from './types'

const settings: ClassroomSettings = {
  givens: { microservice: { label: 'Server', capacityRps: 100_000, costPerHour: 0.192 } },
  targets: { maxUtilization: 0.8, maxErrorRate: 0.01 }
}

const question = {
  constraints: {
    allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'],
    canModifyScaffold: true,
    canRemoveScaffoldNodes: true
  },
  suite: { name: 's', cases: [], visibleToStudent: false },
  prompt: {
    text: '',
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    scale: { peakRps: 1_000_000 }
  },
  classroom: settings
} as unknown as QuestionPackage

describe('classroom givens table', () => {
  it('lists the traffic, every placeable component and the targets', () => {
    expect(classroomGivensTable(question).map((row) => [row.component, row.given])).toEqual([
      ['Users', '1,000,000 req/s at peak'],
      ['Load Balancer', 'Spreads traffic evenly'],
      ['Server', '100,000 req/s each · $0.192/hr each'],
      ['Rule', 'Keep every component at or below 80% utilization'],
      ['Rule', 'Drop fewer than 1% of requests']
    ])
  })

  it('includes a card when the question allows only a subtype of its family', () => {
    const l7Only = {
      ...question,
      constraints: {
        ...question.constraints,
        allowedNodeTypes: ['api-endpoint', 'load-balancer-l7', 'microservice']
      }
    } as QuestionPackage
    expect(classroomGivensTable(l7Only).map((row) => row.component)).toContain('Load Balancer')
  })

  it('formats numbers the way the lecture writes them', () => {
    expect(formatRps(76_923.07)).toBe('76,923 req/s')
    expect(formatPercent(0.7692)).toBe('76.9%')
  })
})

describe('classroom run summary', () => {
  it('reports utilization against the target, traffic and cost', () => {
    const raw: TopologyJSON = {
      id: 't',
      name: 't',
      version: '1',
      global: {
        simulationDuration: 5000,
        seed: 's',
        warmupDuration: 0,
        timeResolution: 'microsecond',
        defaultTimeout: 30000
      },
      nodes: [
        {
          id: 'u',
          type: 'api-endpoint',
          category: 'compute',
          label: 'Users',
          position: { x: 0, y: 0 }
        },
        {
          id: 'lb',
          type: 'load-balancer-l7',
          category: 'network-and-edge',
          label: 'LB',
          position: { x: 0, y: 0 }
        },
        {
          id: 's',
          type: 'microservice',
          category: 'compute',
          label: 'Server',
          position: { x: 0, y: 0 },
          resources: { instanceCount: 12 }
        }
      ],
      edges: [
        ['u', 'lb'],
        ['lb', 's']
      ].map(([source, target]) => ({
        id: `${source}-${target}`,
        source,
        target,
        mode: 'synchronous' as const,
        protocol: 'https' as const,
        latency: {
          distribution: { type: 'constant' as const, value: 0 },
          pathType: 'same-dc' as const
        },
        bandwidth: 1000,
        maxConcurrentRequests: 100,
        packetLossRate: 0,
        errorRate: 0
      }))
    }
    const { topology } = compileClassroomTopology(raw, {
      settings,
      workload: { pattern: 'constant', baseRps: 1_000_000 }
    })
    const summary = summarizeClassroomRun(topology, runSimulation(topology), settings)
    expect(summary.components).toHaveLength(1)
    expect(summary.components[0]).toMatchObject({ label: 'Server', copies: 12, overTarget: true })
    expect(summary.components[0].utilization).toBeCloseTo(1_000_000 / 1_200_000, 3)
    expect(summary.offeredRps).toBe(1_000_000)
    expect(summary.droppedShare).toBe(0)
    expect(summary.costPerHour).toBeCloseTo(12 * 0.192, 6)
  })
})
