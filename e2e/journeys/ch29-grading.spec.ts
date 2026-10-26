/**
 * Chapter 29: question and grading concepts (docs/reference/29-question-and-grading-concepts.md).
 * Expected behaviour comes from the chapter: structural rules gate grading before any simulation, a question discriminates (the
 * reference design passes every check and each plausible wrong design fails a named one), an unmeasurable metric fails
 * rather than passing, cases catch designs tuned to one load, the budget is enforced independently of performance,
 * pass thresholds follow points, justifications must name what is in the graph, grading is reproducible, and the
 * attempt moves through its states. Never from engine output.
 */
import { expect, test } from '@playwright/test'
import {
  autosaveAttempt,
  createAttemptState,
  gradeAttempt,
  lockAttempt,
  markAttemptGrading,
  recordSubmittedGrade,
  topologySnapshotSignature,
  type AttemptGrade,
  type QuestionPackage
} from '../../src/engine/analysis/question'
import { SimulationEngine } from '../../src/engine/engine'
import { chain, queueNode } from '../support/topology'
import type { TopologyJSON } from '../../src/engine/core/types'

const tcp = (a: string, b: string) =>
  [a, b, { protocol: 'tcp' }] as [string, string, Record<string, unknown>]
const simulate = (t: TopologyJSON) => new SimulationEngine(structuredClone(t)).run()

/** source -> cache -> db. The database does 2 workers / 20 ms = 100 req/s. */
function design(hit: number, dbMs = 20, extraNode = false, faults: unknown[] = []): TopologyJSON {
  const nodes = [
    queueNode('cache', 'in-memory-cache', {
      serviceMs: 0.1,
      config: { cacheModel: 'declared-rate', cacheHitRate: hit, cacheHitLatencyMs: 1 }
    }),
    queueNode('db', 'relational-db', { workers: 2, capacity: 50, config: { storageReadMs: dbMs } }),
    ...(extraNode
      ? [queueNode('spare', 'microservice', { category: 'compute', serviceMs: 1 })]
      : [])
  ]
  return chain({
    run: {
      name: 'q',
      rps: 200,
      pattern: 'constant',
      durationMs: 10_000,
      warmupMs: 0,
      seed: 's',
      timeoutMs: 2000
    },
    nodes,
    edges: [
      tcp('source', 'cache'),
      tcp('cache', 'db'),
      ...(extraNode ? [tcp('cache', 'spare')] : [])
    ],
    faults: faults as Record<string, unknown>[]
  }) as TopologyJSON
}

function question(over: Partial<QuestionPackage> = {}): QuestionPackage {
  return {
    version: '1.0',
    id: 'read-path',
    title: 'Serve a read-heavy path',
    difficulty: 'beginner',
    type: 'open-build',
    prompt: {
      text: 't',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: {
      name: 'grading',
      visibleToStudent: false,
      cases: [{ id: 'steady' }, { id: 'peak', workload: { baseRps: 400 } }]
    },
    rubric: {
      passThreshold: 1,
      checks: [
        {
          id: 'errors',
          description: 'error rate under 5%',
          metric: 'summary.errorRate',
          op: '<',
          value: 0.05
        },
        {
          id: 'p99',
          description: 'p99 under 100 ms',
          metric: 'summary.latency.p99',
          op: '<',
          value: 100
        }
      ]
    },
    ...over
  } as QuestionPackage
}

const grade = (
  q: QuestionPackage,
  t: TopologyJSON,
  answers: { promptId: string; text: string }[] = []
): AttemptGrade => gradeAttempt(q, t, simulate, answers)

const named = (g: AttemptGrade, id: string) => g.contract.tests.filter((x) => x.id.includes(id))

// ───────────────────────── 1. Structure gates grading ─────────────────────────

test.describe('GR-01 a structural rule is checked before any simulation (ch29 section 3)', () => {
  const q = question({
    structuralRules: [
      {
        id: 'needs-cache',
        description: 'Put a cache in front of the database.',
        kind: 'requires_component',
        componentType: 'in-memory-cache'
      }
    ]
  })
  const noCache = chain({
    run: {
      name: 'q',
      rps: 200,
      pattern: 'constant',
      durationMs: 5000,
      warmupMs: 0,
      seed: 's',
      timeoutMs: 2000
    },
    nodes: [queueNode('db', 'relational-db', { workers: 8, config: { storageReadMs: 5 } })],
    edges: [tcp('source', 'db')]
  }) as TopologyJSON

  test('a design missing the required component fails the rule and names it', () => {
    const g = grade(q, noCache)
    expect(g.structural.passed).toBe(false)
    expect(g.structural.checks.find((c) => c.id === 'needs-cache')!.passed).toBe(false)
  })

  test('the cases are not run and the host contract is all false, even though the design would have performed', () => {
    const g = grade(q, noCache)
    expect(g.graded.summary.ran).toBe(0)
    expect(g.graded.summary.skippedChecks).toBeGreaterThan(0)
    expect(g.contract.allPassed).toBe(false)
    expect(g.contract.passedTests).toBe(0)
  })

  test('a design that satisfies the rule is simulated', () => {
    const g = grade(q, design(0.9))
    expect(g.structural.passed).toBe(true)
    expect(g.graded.summary.ran).toBe(2)
  })
})

// ───────────────────────── 2. Discrimination ─────────────────────────

test.describe('GR-02 a good question discriminates: the reference passes everything, each wrong design fails a named check (ch29 section 8)', () => {
  const q = question()

  test('the reference (90% cache, 20 ms database) passes every check in both cases', () => {
    const g = grade(q, design(0.9))
    expect(g.contract.allPassed).toBe(true)
    expect(g.graded.summary.failedChecks).toBe(0)
  })

  test('no cache: the database is overloaded and the error-rate check fails in both cases', () => {
    const g = grade(q, design(0))
    expect(g.contract.allPassed).toBe(false)
    expect(named(g, 'errors').every((x) => !x.passed)).toBe(true)
    expect(named(g, 'errors').length).toBe(2)
  })

  test('a slow database behind the cache: a different wrong design, also caught', () => {
    const g = grade(q, design(0.9, 200))
    expect(g.contract.allPassed).toBe(false)
    expect(named(g, 'errors').some((x) => !x.passed)).toBe(true)
  })
})

// ───────────────────────── 3. Honesty about missing data ─────────────────────────

test.describe('GR-03 a metric that cannot be measured fails its check (ch29 section 3)', () => {
  const dbDown = [
    {
      targetId: 'db',
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'permanent',
      params: { atMs: 0, mode: 'reject' }
    },
    {
      targetId: 'cache',
      faultType: 'node-failure',
      timing: 'deterministic',
      duration: 'permanent',
      params: { atMs: 0, mode: 'reject' }
    }
  ]

  test('with no successful request there is no p99; "p99 under 100 ms" does not pass by default', () => {
    const g = grade(question(), design(0.9, 20, false, dbDown))
    expect(named(g, 'p99').every((x) => !x.passed)).toBe(true)
  })

  test('a metric path that does not exist fails rather than passing', () => {
    const q = question({
      rubric: {
        checks: [
          {
            id: 'ghost',
            description: 'a metric that is not there',
            metric: 'summary.nonsense',
            op: '<',
            value: 1
          }
        ]
      }
    })
    const g = grade(q, design(0.9))
    expect(named(g, 'ghost').every((x) => !x.passed)).toBe(true)
  })
})

// ───────────────────────── 4. Cases and invariants ─────────────────────────

test.describe('GR-04 several cases catch a design tuned to one load (ch29 section 2)', () => {
  // A 65% cache at 200 req/s sends 70 req/s to the database (capacity 100): fine. At 400 req/s it sends 140: overloaded.
  test('passes the steady case and fails the peak case', () => {
    const g = grade(question(), design(0.65))
    const errors = named(g, 'errors')
    expect(errors.find((x) => x.id.includes('steady'))!.passed).toBe(true)
    expect(errors.find((x) => x.id.includes('peak'))!.passed).toBe(false)
    expect(g.contract.allPassed).toBe(false)
  })

  test('a fault case grades the design under failure: losing the cache and database fails the availability check', () => {
    const q = question({
      suite: {
        name: 'chaos',
        visibleToStudent: false,
        cases: [
          {
            id: 'db-down',
            faults: [
              {
                targetId: 'db',
                faultType: 'node-failure',
                timing: 'deterministic',
                duration: 'permanent',
                params: { atMs: 0, mode: 'reject' }
              }
            ]
          }
        ]
      }
    })
    const g = grade(q, design(0.0))
    expect(named(g, 'errors').every((x) => !x.passed)).toBe(true)
  })

  test('a grading invariant the learner cannot see fails a design running too hot', () => {
    const q = question({
      suite: {
        name: 'headroom',
        visibleToStudent: false,
        cases: [
          {
            id: 'headroom',
            invariants: [
              {
                id: 'util',
                description: 'no node above 80%',
                condition: 'perNode.maxUtilization <= 0.8'
              }
            ]
          }
        ]
      },
      rubric: {
        checks: [
          {
            id: 'no-violations',
            description: 'no invariant violated',
            metric: 'invariantViolations.count',
            op: '==',
            value: 0
          }
        ]
      }
    })
    const hot = grade(q, design(0.55)) // 90 req/s into a 100 req/s database: 90% busy
    const cool = grade(q, design(0.9)) // 20 req/s: 20% busy
    expect(named(hot, 'no-violations').every((x) => !x.passed)).toBe(true)
    expect(named(cool, 'no-violations').every((x) => x.passed)).toBe(true)
  })
})

// ───────────────────────── 5. Budget, points and justification ─────────────────────────

test.describe('GR-05 a budget cap is enforced independently of performance (ch29 section 5)', () => {
  // The cap counts every node on the canvas, the traffic source included.
  const q = question({ budget: { unit: 'nodes', cap: 3 } })

  test('the reference fits in 3 nodes (source, cache, database)', () => {
    const g = grade(q, design(0.9))
    expect(g.budget!.withinBudget).toBe(true)
    expect(g.contract.allPassed).toBe(true)
  })

  test('adding a node that changes nothing about performance still fails the budget', () => {
    const g = grade(q, design(0.9, 20, true))
    expect(g.budget!.actual).toBe(4)
    expect(g.budget!.withinBudget).toBe(false)
    expect(g.contract.allPassed).toBe(false)
    // performance checks themselves still pass
    expect(named(g, 'errors').every((x) => x.passed)).toBe(true)
  })
})

test.describe('GR-06 points and the pass threshold (ch29 section 3)', () => {
  // errors is worth 2 points, p99 is worth 1; the reference misses a 15 ms p99 (its misses take about 21 ms).
  const withThreshold = (threshold: number) =>
    question({
      rubric: {
        passThreshold: threshold,
        checks: [
          {
            id: 'errors',
            description: 'error rate under 5%',
            metric: 'summary.errorRate',
            op: '<',
            value: 0.05,
            points: 2
          },
          {
            id: 'p99',
            description: 'p99 under 15 ms',
            metric: 'summary.latency.p99',
            op: '<',
            value: 15,
            points: 1
          }
        ]
      }
    })

  test('failing only the 1-point check earns 2/3 of the points', () => {
    const g = grade(withThreshold(0.6), design(0.9))
    expect(g.graded.score.fraction).toBeCloseTo(2 / 3, 6)
  })

  test('that is enough at a 0.6 threshold and not at 0.8', () => {
    expect(grade(withThreshold(0.6), design(0.9)).graded.passed).toBe(true)
    expect(grade(withThreshold(0.8), design(0.9)).graded.passed).toBe(false)
  })
})

test.describe('GR-07 a justification must name what is actually in the graph (ch29 section 5)', () => {
  const q = question({
    justify: [
      {
        id: 'why-cache',
        decision: 'Why a cache in front of the database?',
        boundTo: { componentType: 'in-memory-cache' },
        requires: { choice: true, number: false, tradeoff: true }
      }
    ]
  })

  test('an answer that names the cache and states what is given up passes', () => {
    const g = grade(q, design(0.9), [
      {
        promptId: 'why-cache',
        text: 'I put an in-memory-cache in front because most reads repeat; the trade-off is that it can serve stale data.'
      }
    ])
    expect(g.justification![0].outcome).toBe('passed')
  })

  test('an answer about a component that is not in the design fails the graph-consistency check', () => {
    const g = grade(q, design(0.9), [
      { promptId: 'why-cache', text: 'I chose kafka because it is popular.' }
    ])
    expect(g.justification![0].outcome).toBe('failed')
    expect(g.justification![0].checks.graphConsistent).toBe(false)
  })
})

// ───────────────────────── 6. Reproducibility and the attempt ─────────────────────────

test.describe('GR-08 grading is reproducible (ch29 section 6)', () => {
  test('the same submission graded twice gives the same contract', () => {
    const a = grade(question(), design(0.9))
    const b = grade(question(), design(0.9))
    expect(a.contract).toEqual(b.contract)
  })

  test('the topology signature is stable for the same design and changes when the design changes', () => {
    expect(topologySnapshotSignature(design(0.9))).toBe(topologySnapshotSignature(design(0.9)))
    expect(topologySnapshotSignature(design(0.9))).not.toBe(topologySnapshotSignature(design(0.5)))
  })
})

test.describe('GR-09 an attempt moves through its states (ch29 section 6)', () => {
  const q = question()
  const t0 = design(0.9)
  const t1 = design(0.5)
  const now = '2026-01-01T00:00:00.000Z'

  test('DRAFT -> AUTOSAVED on a change -> GRADING -> GRADED -> LOCKED', () => {
    const draft = createAttemptState({ questionId: q.id, topology: t0, now })
    expect(draft.status).toBe('DRAFT')
    const saved = autosaveAttempt(draft, { questionId: q.id, topology: t1, now })
    expect(saved.status).toBe('AUTOSAVED')
    const grading = markAttemptGrading(saved, { questionId: q.id, topology: t1, now })
    expect(grading.status).toBe('GRADING')
    const graded = recordSubmittedGrade(grading, { topology: t1, grade: grade(q, t1), now })
    expect(graded.status).toBe('GRADED')
    expect(graded.grade).toBeTruthy()
    expect(graded.submittedAt).toBeTruthy()
    const locked = lockAttempt(graded, now)!
    expect(locked.status).toBe('LOCKED')
    expect(locked.grade).toEqual(graded.grade)
  })

  test('saving the same topology again changes nothing, and a locked attempt ignores further edits', () => {
    const draft = createAttemptState({ questionId: q.id, topology: t0, now })
    expect(autosaveAttempt(draft, { questionId: q.id, topology: t0, now })).toEqual(draft)
    const locked = lockAttempt(draft, now)!
    expect(autosaveAttempt(locked, { questionId: q.id, topology: t1, now }).status).toBe('LOCKED')
  })

  test('an edit after grading clears the stale grade', () => {
    const grading = markAttemptGrading(
      createAttemptState({ questionId: q.id, topology: t0, now }),
      { questionId: q.id, topology: t0, now }
    )
    const graded = recordSubmittedGrade(grading, { topology: t0, grade: grade(q, t0), now })
    const edited = autosaveAttempt(graded, { questionId: q.id, topology: t1, now })
    expect(edited.status).toBe('AUTOSAVED')
    expect(edited.grade).toBeUndefined()
  })
})

test.describe('GR-10 the stated scale is the load, whatever the learner configured (ch29 section 1)', () => {
  // The learner's own workload is 10 req/s. The question says the peak is 400.
  const slowSource = (): TopologyJSON => {
    const t = design(0.65)
    ;(t.workload as unknown as Record<string, unknown>).baseRps = 10
    return t
  }

  test("without a stated scale the design is graded at the learner's 10 req/s and passes", () => {
    const q = question({ suite: { name: 'one', visibleToStudent: false, cases: [{ id: 'only' }] } })
    expect(grade(q, slowSource()).contract.allPassed).toBe(true)
  })

  test('with peakRps 400 stated, every case without its own rate runs at 400 and the same design fails', () => {
    const q = question({
      prompt: {
        text: 't',
        functionalRequirements: [],
        nonFunctionalRequirements: [],
        scale: { peakRps: 400 }
      },
      suite: { name: 'one', visibleToStudent: false, cases: [{ id: 'only' }] }
    })
    const g = grade(q, slowSource())
    expect(g.contract.allPassed).toBe(false)
    expect(named(g, 'errors').every((x) => !x.passed)).toBe(true)
  })

  test('a case that sets its own rate overrides the stated scale', () => {
    const q = question({
      prompt: {
        text: 't',
        functionalRequirements: [],
        nonFunctionalRequirements: [],
        scale: { peakRps: 400 }
      },
      suite: {
        name: 'one',
        visibleToStudent: false,
        cases: [{ id: 'light', workload: { baseRps: 50 } }]
      }
    })
    expect(grade(q, slowSource()).contract.allPassed).toBe(true)
  })
})
