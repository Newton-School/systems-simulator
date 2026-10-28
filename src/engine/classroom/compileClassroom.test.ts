import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ComponentNode, EdgeDefinition, TopologyJSON } from '../core/types'
import {
  CLASSROOM_COMPONENTS_CHECK_ID,
  gradeAttempt,
  parseQuestionPackage,
  type QuestionPackage
} from '../analysis/question'
import { runSimulation } from '../runSimulation'
import { resolveMetric } from '../analysis/rubric'
import { projectToVerdict } from '../analysis/verdict'
import {
  compileClassroomQuestion,
  compileClassroomTopology,
  minimumClassroomCopies
} from './compileClassroom'
import { conceptCardForType, defaultCardGivens, getConceptCard, roundGiven } from './conceptCards'
import { ClassroomSettingsSchema, type ClassroomSettings } from './types'

const QUICKCART_CLASSROOM: ClassroomSettings = {
  givens: { microservice: { label: 'Server', capacityRps: 100_000, costPerHour: 0.192 } },
  targets: { maxUtilization: 0.8, maxErrorRate: 0.01 },
  checks: [
    {
      id: 'through-lb',
      template: 'traffic-flows-through',
      via: 'load-balancer',
      component: 'microservice',
      label: 'All traffic reaches the servers through the load balancer'
    },
    { id: 'serves-all', template: 'serves-all-traffic', label: 'Every request is served' },
    {
      id: 'headroom',
      template: 'within-target-utilization',
      component: 'microservice',
      label: 'Every server stays at or below 80%',
      points: 2
    },
    {
      id: 'right-size',
      template: 'right-sized',
      component: 'microservice',
      factor: 1.5,
      severity: 'feedback',
      label: "The fleet isn't much bigger than it needs to be"
    }
  ],
  misconceptions: [
    {
      id: 'no-lb',
      title: 'Traffic is not distributed',
      message: 'Put a load balancer before the servers.',
      priority: 1,
      detect: { kind: 'check-failed', checkId: 'through-lb' }
    },
    {
      id: 'forgot-headroom',
      title: 'Planned to 100%, not 80%',
      message: 'Leave room for a burst.',
      nudge: 'Divide by usable capacity and round up.',
      priority: 2,
      detect: {
        kind: 'all',
        of: [
          { kind: 'check-passed', checkId: 'serves-all' },
          { kind: 'check-failed', checkId: 'headroom' }
        ]
      }
    }
  ]
}

function quickcart(classroom: ClassroomSettings = QUICKCART_CLASSROOM): QuestionPackage {
  const raw = JSON.parse(
    readFileSync(
      resolve(__dirname, '../analysis/fixtures/quickcart-flash-sale.question.json'),
      'utf-8'
    )
  ) as Record<string, unknown>
  return parseQuestionPackage({ ...raw, classroom })
}

/** A server as the canvas serializes a fresh palette node: architect config, no givens. */
function server(id: string, copies = 1): ComponentNode {
  return {
    id,
    type: 'microservice',
    category: 'compute',
    role: 'processor',
    label: id,
    position: { x: 0, y: 0 },
    resources: { instanceType: 'm5.large', instanceCount: copies, workloadKind: 'io-bound' },
    processing: { distribution: { type: 'exponential', mean: 20 }, timeout: 1000 },
    queue: { workers: 4, capacity: 40, discipline: 'fifo' }
  }
}

function edge(source: string, target: string): EdgeDefinition {
  return {
    id: `${source}->${target}`,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: { distribution: { type: 'constant', value: 25 }, pathType: 'cross-region' },
    bandwidth: 10,
    maxConcurrentRequests: 5,
    packetLossRate: 0.05,
    errorRate: 0.02
  }
}

/** Users → [LB →] servers. `servers` lists the copies on each server node. */
function design(servers: number[], options: { lb?: boolean; rps?: number } = {}): TopologyJSON {
  const lb = options.lb ?? true
  const serverNodes = servers.map((copies, index) => server(`srv-${index}`, copies))
  const entry = lb ? 'lb' : null
  return {
    id: 'design',
    name: 'Design',
    version: '1',
    global: {
      simulationDuration: 5000,
      seed: 'classroom-test',
      warmupDuration: 500,
      timeResolution: 'microsecond',
      defaultTimeout: 30000
    },
    nodes: [
      {
        id: 'users',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'Users',
        position: { x: 0, y: 0 }
      },
      ...(lb
        ? [
            {
              id: 'lb',
              type: 'load-balancer-l7',
              category: 'network-and-edge',
              role: 'router',
              label: 'LB',
              position: { x: 0, y: 0 },
              config: { routingStrategy: 'least-connections' }
            } satisfies ComponentNode
          ]
        : []),
      ...serverNodes
    ],
    edges: entry
      ? [edge('users', entry), ...serverNodes.map((node) => edge(entry, node.id))]
      : serverNodes.map((node) => edge('users', node.id)),
    workload: {
      sourceNodeId: 'users',
      pattern: 'poisson',
      baseRps: options.rps ?? 123,
      requestDistribution: [{ type: 'read', weight: 1, sizeBytes: 100 }]
    }
  }
}

function settings(capacityRps: number, maxUtilization = 0.8): ClassroomSettings {
  return {
    givens: { microservice: { capacityRps } },
    targets: { maxUtilization }
  }
}

function run(topology: TopologyJSON, mode: 'discrete' | 'analytic') {
  const output = runSimulation(topology, { mode })
  const verdict = projectToVerdict(output)
  return {
    utilization: resolveMetric(verdict, 'perNode.maxUtilization') ?? Number.NaN,
    errorRate: resolveMetric(verdict, 'summary.errorRate') ?? Number.NaN
  }
}

describe('Classroom compile: engine parity (both simulation paths agree)', () => {
  const cases = [
    { name: 'under target', servers: [1, 1, 1, 1], capacity: 1000, rps: 3000 },
    { name: 'copies on one node', servers: [4], capacity: 1000, rps: 3000 },
    { name: 'mixed nodes', servers: [2, 1, 1], capacity: 500, rps: 1200 }
  ]

  for (const entry of cases) {
    it(`utilization matches between discrete and analytic: ${entry.name}`, () => {
      const { topology } = compileClassroomTopology(design(entry.servers), {
        settings: settings(entry.capacity),
        workload: { pattern: 'constant', baseRps: entry.rps },
        global: { simulationDuration: 10_000 }
      })
      const discrete = run(topology, 'discrete')
      const analytic = run(topology, 'analytic')
      expect(Math.abs(discrete.utilization - analytic.utilization)).toBeLessThan(0.02)
      expect(discrete.errorRate).toBeLessThan(0.001)
      expect(analytic.errorRate).toBeLessThan(0.001)
    })
  }

  it('drops roughly the same share when overloaded', () => {
    // 2 servers × 1000 req/s against 3000 req/s: a third of the traffic can't be served.
    const { topology } = compileClassroomTopology(design([1, 1]), {
      settings: settings(1000),
      workload: { pattern: 'constant', baseRps: 3000 },
      global: { simulationDuration: 10_000 }
    })
    const discrete = run(topology, 'discrete')
    const analytic = run(topology, 'analytic')
    expect(analytic.errorRate).toBeCloseTo(1 / 3, 2)
    expect(Math.abs(discrete.errorRate - analytic.errorRate)).toBeLessThan(0.05)
  })
})

describe('Classroom compile: results match the napkin formula', () => {
  for (const copies of [1, 2, 5, 8, 13]) {
    it(`utilization = offered ÷ (capacity × copies) for ${copies} copies`, () => {
      const peak = 1_000_000
      const { topology } = compileClassroomTopology(design([copies]), {
        settings: settings(100_000),
        workload: { pattern: 'constant', baseRps: Math.min(peak, 100_000 * copies * 0.9) }
      })
      const offered = topology.workload!.baseRps
      const { utilization } = run(topology, 'analytic')
      expect(Math.abs(utilization - offered / (100_000 * copies))).toBeLessThan(0.01)
    })
  }

  it('has no errors anywhere while every node is under 100%', () => {
    const { topology } = compileClassroomTopology(design([1, 1, 1]), {
      settings: settings(1000),
      workload: { pattern: 'constant', baseRps: 2500 },
      global: { simulationDuration: 10_000, seed: 'any-seed' }
    })
    expect(run(topology, 'discrete').errorRate).toBe(0)
  })

  it('neutralizes edges and drops instance resources', () => {
    const { topology } = compileClassroomTopology(design([3]), { settings: settings(1000) })
    for (const compiledEdge of topology.edges) {
      expect(compiledEdge.errorRate).toBe(0)
      expect(compiledEdge.packetLossRate).toBe(0)
      expect(compiledEdge.latency.distribution).toEqual({ type: 'constant', value: 0 })
    }
    const compiledServer = topology.nodes.find((node) => node.id === 'srv-0')!
    expect(compiledServer.resources).toBeUndefined()
    expect(compiledServer.config?.classroom).toMatchObject({ card: 'server', copies: 3 })
    // One target: no routing strategy (the validator warns about a strategy with nothing to pick).
    expect(topology.nodes.find((node) => node.id === 'lb')!.config?.routingStrategy).toBeUndefined()
    const spread = compileClassroomTopology(design([1, 1]), { settings: settings(1000) }).topology
    expect(spread.nodes.find((node) => node.id === 'lb')!.config?.routingStrategy).toBe(
      'round-robin'
    )
  })

  it('is idempotent, so compiling a compiled design changes nothing', () => {
    const options = {
      settings: settings(1000),
      workload: { pattern: 'constant' as const, baseRps: 2500 }
    }
    const once = compileClassroomTopology(design([2, 1]), options).topology
    expect(compileClassroomTopology(once, options).topology).toEqual(once)
  })

  it('gives palette-named nodes the lecture label and keeps renamed ones', () => {
    const raw = design([1, 1])
    raw.nodes[2].label = 'API Server'
    raw.nodes[3].label = 'Checkout'
    const { topology } = compileClassroomTopology(raw, {
      settings: { givens: { microservice: { label: 'Server', capacityRps: 1000 } } }
    })
    expect(topology.nodes.map((node) => node.label)).toEqual(['Users', 'LB', 'Server', 'Checkout'])
  })
})

describe('Classroom Phase 2 and Guided compilation', () => {
  it('models a latency given as fixed delay before the capacity queue', () => {
    const { topology } = compileClassroomTopology(design([1]), {
      settings: { givens: { microservice: { capacityRps: 1000, latencyMs: 25 } } }
    })
    expect(topology.edges.find((entry) => entry.target === 'srv-0')?.latency.distribution).toEqual({
      type: 'constant',
      value: 25
    })
  })

  it('preserves only author-unlocked real knobs in Guided mode', () => {
    const raw = design([1])
    raw.nodes.find((node) => node.id === 'srv-0')!.queue!.workers = 3
    const configured: ClassroomSettings = {
      givens: { microservice: { capacityRps: 1000 } },
      guidedKnobs: [{ path: 'queue.workers', label: 'Workers', objectiveId: 'concurrency' }]
    }
    const classroom = compileClassroomTopology(raw, {
      settings: configured,
      abstraction: 'classroom'
    }).topology
    const guided = compileClassroomTopology(raw, {
      settings: configured,
      abstraction: 'guided'
    }).topology
    expect(classroom.nodes.find((node) => node.id === 'srv-0')?.queue?.workers).not.toBe(3)
    expect(guided.nodes.find((node) => node.id === 'srv-0')?.queue?.workers).toBe(3)
  })

  it('preserves validated named choices and replaces unknown options', () => {
    const raw = design([1])
    raw.nodes.find((node) => node.id === 'srv-0')!.config = {
      classroom: { choices: { routing: 'sticky' } }
    }
    const configured: ClassroomSettings = {
      givens: { microservice: { capacityRps: 1000 } },
      choices: {
        microservice: [
          {
            id: 'routing',
            label: 'Routing',
            explanation: 'Choose a distribution strategy.',
            objectiveId: 'routing',
            target: 'routing-strategy',
            options: [
              {
                id: 'round-robin',
                label: 'Round robin',
                explanation: 'Spread evenly.',
                value: 'round-robin'
              },
              { id: 'sticky', label: 'Sticky', explanation: 'Keep affinity.', value: 'sticky' }
            ]
          }
        ]
      }
    }
    const choice = () =>
      compileClassroomTopology(raw, { settings: configured }).topology.nodes.find(
        (node) => node.id === 'srv-0'
      )?.config?.classroom
    expect(choice()).toMatchObject({ choices: { routing: 'sticky' } })
    ;(
      raw.nodes.find((node) => node.id === 'srv-0')!.config!.classroom as {
        choices: Record<string, string>
      }
    ).choices.routing = 'invented'
    expect(choice()).toMatchObject({ choices: { routing: 'round-robin' } })
  })

  it('refuses to turn caching on without a stated hit rate', () => {
    const caching = (cacheHitRate?: number): ClassroomSettings => ({
      givens: {
        microservice: { capacityRps: 1000, ...(cacheHitRate !== undefined ? { cacheHitRate } : {}) }
      },
      choices: {
        microservice: [
          {
            id: 'caching',
            label: 'Caching',
            explanation: 'Serve repeat reads from memory.',
            objectiveId: 'cache',
            target: 'cache-enabled',
            options: [
              { id: 'on', label: 'On', explanation: 'Cache reads.', value: 'on' },
              { id: 'off', label: 'Off', explanation: 'Read every time.', value: 'off' }
            ]
          }
        ]
      }
    })
    const server = (settings: ClassroomSettings) => {
      const result = compileClassroomTopology(design([1]), { settings })
      return {
        issues: result.issues,
        hitRate: result.topology.nodes.find((node) => node.id === 'srv-0')?.config?.cacheHitRate
      }
    }
    const unstated = server(caching())
    expect(unstated.issues).toHaveLength(1)
    expect(unstated.issues[0].message).toContain('no stated hit rate')
    expect(unstated.hitRate).toBe(0)
    expect(server(caching(0.9))).toEqual({ issues: [], hitRate: 0.9 })
  })
})

describe('Classroom grading: QuickCart', () => {
  const pkg = quickcart()
  const grade = (topology: TopologyJSON) =>
    gradeAttempt(pkg, topology, (t) => runSimulation(t), [], { abstraction: 'classroom' })

  it('passes 13 servers and "1 server ×13" alike', () => {
    for (const servers of [Array.from({ length: 13 }, () => 1), [13]]) {
      const result = grade(design(servers))
      expect(result.contract.allPassed).toBe(true)
      expect(result.classroom?.feedback).toEqual([
        expect.objectContaining({ id: 'right-size', passed: true })
      ])
    }
  })

  it('fails 12 servers on headroom only, and 8 servers on dropped traffic too', () => {
    const twelveGrade = grade(design([12]))
    const twelve = twelveGrade.contract.tests
    expect(twelve.filter((test) => !test.passed).map((test) => test.name)).toEqual([
      'Every server stays at or below 80%'
    ])
    expect(twelveGrade.classroom?.misconceptions[0]).toMatchObject({ id: 'forgot-headroom' })
    const eight = grade(design([8])).contract.tests
    expect(eight.filter((test) => !test.passed).map((test) => test.name)).toEqual(
      expect.arrayContaining(['Every request is served', 'Every server stays at or below 80%'])
    )
  })

  it('explains failures with the component and the number, not engine metrics', () => {
    const twelve = grade(design([12])).contract.tests.find((test) => !test.passed)
    expect(twelve?.detail).toBe('srv-0 ×12: 83.3% (target 80%).')
    const eight = grade(design([8])).contract.tests.find(
      (test) => test.name === 'Every request is served'
    )
    expect(eight?.detail).toBe('20% of requests were dropped (limit 1%).')
  })

  it('never names the smallest fleet in feedback', () => {
    expect(grade(design([13])).classroom?.feedback[0].detail).toBeUndefined()
    const oversized = grade(design([30])).classroom?.feedback[0].detail ?? ''
    expect(oversized).toContain('30 server instances')
    expect(oversized).not.toMatch(/13/)
  })

  it('fails the structure check when users skip the load balancer', () => {
    const result = grade(design([13], { lb: false }))
    expect(result.structural.passed).toBe(false)
    expect(result.contract.allPassed).toBe(false)
    expect(result.classroom?.misconceptions[0]).toMatchObject({ id: 'no-lb' })
  })

  it('does not treat a check skipped after a structure failure as a mistake', () => {
    // The Studio writes the simple form: message fires when the headroom check fails.
    const simple = quickcart({
      ...QUICKCART_CLASSROOM,
      misconceptions: [
        QUICKCART_CLASSROOM.misconceptions![0],
        {
          id: 'forgot-headroom',
          title: 'Planned to 100%, not 80%',
          message: 'Leave room for a burst.',
          detect: { kind: 'check-failed', checkId: 'headroom' }
        }
      ]
    })
    const gradeWith = (topology: TopologyJSON) =>
      gradeAttempt(simple, topology, (t) => runSimulation(t), [], { abstraction: 'classroom' })
    // No load balancer: headroom never ran, so only the structural message applies.
    expect(
      gradeWith(design([13], { lb: false })).classroom?.misconceptions.map((m) => m.id)
    ).toEqual(['no-lb'])
    expect(gradeWith(design([12])).classroom?.misconceptions.map((m) => m.id)).toEqual([
      'forgot-headroom'
    ])
  })

  it('flags an oversized fleet as feedback without failing the grade', () => {
    const result = grade(design([30]))
    expect(result.contract.allPassed).toBe(true)
    expect(result.classroom?.feedback[0]).toMatchObject({ passed: false })
  })

  it('grades a tampered submission exactly like the clean one', () => {
    const tampered = design([12])
    for (const node of tampered.nodes) {
      if (node.type !== 'microservice') continue
      node.config = { capacityRps: 10_000_000, capacityAuthored: true }
      node.resources = { instanceType: 'm5.24xlarge', instanceCount: 12, workloadKind: 'io-bound' }
      node.queue = { workers: 100_000, capacity: 200_000, discipline: 'fifo' }
    }
    expect(grade(tampered).contract).toEqual(grade(design([12])).contract)
    expect(grade(tampered).contract.allPassed).toBe(false)
  })

  it('fails components Classroom mode cannot model', () => {
    const withCache = design([13])
    withCache.nodes.push({
      id: 'cache',
      type: 'cache',
      category: 'storage',
      label: 'Cache',
      position: { x: 0, y: 0 }
    } as ComponentNode)
    const result = grade(withCache)
    expect(result.structural.checks[0]).toMatchObject({
      id: CLASSROOM_COMPONENTS_CHECK_ID,
      passed: false
    })
    expect(result.classroom?.issues).toHaveLength(1)
  })

  it('keeps Architect grading unchanged when no abstraction is passed', () => {
    const architect = gradeAttempt(pkg, design([13]), (t) => runSimulation(t))
    expect(architect.classroom).toBeUndefined()
  })

  it('refuses Classroom grading for an Architect-only question', () => {
    const architectOnly = quickcart({ ...QUICKCART_CLASSROOM, abstractions: ['architect'] })
    expect(() =>
      gradeAttempt(architectOnly, design([13]), (t) => runSimulation(t), [], {
        abstraction: 'classroom'
      })
    ).toThrow(/can't be graded in Classroom mode/)
  })

  it("refuses Classroom grading when the question doesn't state server capacity", () => {
    const unstated = quickcart({ targets: { maxUtilization: 0.8 } })
    expect(() =>
      gradeAttempt(unstated, design([13]), (t) => runSimulation(t), [], {
        abstraction: 'classroom'
      })
    ).toThrow(/doesn't state how many requests per second a Server handles/)
  })

  it('works out the smallest passing fleet', () => {
    expect(minimumClassroomCopies(pkg, 'microservice')).toBe(13)
  })

  it('replaces the authored grading set with the Classroom checks', () => {
    const compiled = compileClassroomQuestion(pkg)
    expect(compiled.rubric.checks.map((check) => check.id)).toEqual(['serves-all', 'headroom'])
    expect(compiled.structuralRules?.map((rule) => rule.id)).toEqual([
      'through-lb.into',
      'through-lb.onward'
    ])
    expect(compiled.suite.cases[0].invariants).toEqual([
      {
        id: 'classroom.headroom',
        description: 'Every server stays at or below 80%',
        condition: 'perNode.maxUtilization <= 0.8'
      }
    ])
  })
})

describe('Classroom settings and cards', () => {
  it('rejects unknown fields and incomplete checks', () => {
    expect(ClassroomSettingsSchema.safeParse({ givens: {}, kit: {} }).success).toBe(false)
    expect(
      ClassroomSettingsSchema.safeParse({
        checks: [{ id: 'a', template: 'right-sized', label: 'Right-sized' }]
      }).success
    ).toBe(false)
    expect(
      ClassroomSettingsSchema.safeParse({
        checks: [{ id: 'a', template: 'serves-all-traffic', label: 'x', severity: 'feedback' }]
      }).success
    ).toBe(false)
  })

  it('accepts the design-checks switch and rejects a non-boolean', () => {
    expect(ClassroomSettingsSchema.safeParse({ designChecks: true }).success).toBe(true)
    expect(ClassroomSettingsSchema.safeParse({ designChecks: 'yes' }).success).toBe(false)
  })

  it('fails closed on unsupported named-choice values and dangling objectives', () => {
    const choice = {
      id: 'routing',
      label: 'Routing',
      explanation: 'Choose a routing policy.',
      objectiveId: 'routing-objective',
      target: 'routing-strategy' as const,
      options: [
        { id: 'a', label: 'A', explanation: 'A', value: 'invented-policy' },
        { id: 'b', label: 'B', explanation: 'B', value: 'round-robin' }
      ]
    }
    const validOptions = [
      { id: 'a', label: 'A', explanation: 'A', value: 'round-robin' },
      { id: 'b', label: 'B', explanation: 'B', value: 'least-conn' }
    ]
    expect(
      ClassroomSettingsSchema.safeParse({
        choices: { 'load-balancer': [{ ...choice, options: validOptions }] }
      }).success
    ).toBe(false)
    expect(
      ClassroomSettingsSchema.safeParse({
        objectives: [{ id: 'routing-objective', statement: 'Choose routing.', concept: 'routing' }],
        choices: { 'load-balancer': [choice] }
      }).success
    ).toBe(false)
    expect(
      ClassroomSettingsSchema.safeParse({
        objectives: [{ id: 'routing-objective', statement: 'Choose routing.', concept: 'routing' }],
        choices: {
          'load-balancer': [
            {
              ...choice,
              options: validOptions
            }
          ]
        }
      }).success
    ).toBe(true)
  })

  it('keeps the classroom block when a package is parsed', () => {
    expect(quickcart().classroom?.givens?.microservice?.capacityRps).toBe(100_000)
  })

  it('maps component families to cards', () => {
    expect(conceptCardForType('load-balancer-l4')?.id).toBe('load-balancer')
    expect(conceptCardForType('microservice')?.id).toBe('server')
    expect(conceptCardForType('api-endpoint')?.id).toBe('users')
    expect(conceptCardForType('api-gateway')?.id).toBe('api-gateway')
    expect(conceptCardForType('cdn')?.id).toBe('cdn')
    expect(conceptCardForType('batch-worker')?.id).toBe('worker')
    expect(conceptCardForType('in-memory-cache')?.id).toBe('cache')
    expect(conceptCardForType('relational-db')?.id).toBe('sql-database')
    expect(conceptCardForType('nosql-db')?.id).toBe('nosql-database')
    expect(conceptCardForType('queue')?.id).toBe('queue')
    expect(conceptCardForType('vector-db')).toBeUndefined()
  })

  it('preserves storage roles without inventing load-balancer behavior', () => {
    const raw = design([1])
    raw.nodes.push(
      {
        id: 'cache',
        type: 'in-memory-cache',
        category: 'storage-and-data',
        role: 'storage',
        label: 'Distributed Cache',
        position: { x: 0, y: 0 }
      },
      {
        id: 'queue',
        type: 'queue',
        category: 'messaging-and-streaming',
        role: 'storage',
        label: 'Message Queue',
        position: { x: 0, y: 0 }
      }
    )
    const { topology, issues } = compileClassroomTopology(raw, {
      settings: {
        givens: {
          microservice: { capacityRps: 1000 },
          'in-memory-cache': { capacityRps: 5000 }
        }
      }
    })
    expect(issues).toEqual([])
    expect(topology.nodes.find((node) => node.id === 'cache')).toMatchObject({
      role: 'storage',
      config: { classroom: { card: 'cache', capacityRps: 5000 } }
    })
    expect(topology.nodes.find((node) => node.id === 'queue')).toMatchObject({
      role: 'storage',
      config: { classroom: { card: 'queue' } }
    })
    expect(
      topology.nodes.find((node) => node.id === 'queue')?.config?.routingStrategy
    ).toBeUndefined()
  })

  it('derives rounded default givens from the palette', () => {
    const givens = defaultCardGivens(getConceptCard('server'))
    expect(givens.capacityRps).toBeGreaterThan(0)
    expect(givens.capacityRps).toBe(roundGiven(givens.capacityRps!))
    expect(givens.costPerHour).toBeGreaterThan(0)
    expect(roundGiven(49_231)).toBe(49_000)
  })
})
