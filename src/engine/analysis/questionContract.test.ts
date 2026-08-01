import { describe, expect, it } from 'vitest'
import type { EdgeDefinition, TopologyJSON } from '../core/types'
import type { AttemptGrade } from './question'
import {
  autosaveAttempt,
  createAttemptState,
  markAttemptGrading,
  parseAttemptState,
  parseQuestionPackage,
  recordDryRunGrade,
  recordSubmittedGrade,
  recoverAttemptAfterGradingError,
  resumePersistedAttempt
} from './question'

function edge(id: string, source: string, target: string): EdgeDefinition {
  return {
    id,
    source,
    target,
    mode: 'synchronous',
    protocol: 'https',
    latency: {
      distribution: { type: 'constant', value: 1 },
      pathType: 'same-dc'
    },
    bandwidth: 1_000,
    maxConcurrentRequests: 100,
    packetLossRate: 0,
    errorRate: 0
  }
}

function topology(): TopologyJSON {
  return {
    id: 'topology-under-test',
    name: 'Topology Under Test',
    version: '2.0.0',
    global: {
      seed: 'seed',
      simulationDuration: 1000,
      warmupDuration: 0,
      timeResolution: 'millisecond',
      defaultTimeout: 1000
    },
    nodes: [
      {
        id: 'client',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'client',
        position: { x: 0, y: 0 }
      },
      {
        id: 'api',
        type: 'microservice',
        category: 'compute',
        role: 'processor',
        label: 'api',
        position: { x: 100, y: 0 },
        queue: { workers: 1, capacity: 10, discipline: 'fifo' },
        processing: {
          distribution: { type: 'constant', value: 5 },
          timeout: 1000
        }
      }
    ],
    edges: [edge('client-api', 'client', 'api')],
    workload: {
      sourceNodeId: 'client',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'GET', weight: 1, sizeBytes: 1024 }]
    }
  }
}

function fakeGrade(passed: boolean): AttemptGrade {
  return {
    structural: { version: '1.0', checks: [], passed: true },
    graded: {
      version: '1.0',
      cases: [
        {
          id: 'baseline',
          ran: true,
          rubric: {
            version: '1.0',
            checks: [
              {
                id: 'err',
                description: 'error rate < 10%',
                metric: 'summary.errorRate',
                op: '<',
                value: 0.1,
                actual: passed ? 0.01 : 0.5,
                passed,
                points: 1,
                awarded: passed ? 1 : 0
              }
            ],
            score: { earned: passed ? 1 : 0, possible: 1, fraction: passed ? 1 : 0 },
            passed
          }
        }
      ],
      summary: { total: 1, ran: 1, errored: 0, passed: passed ? 1 : 0, failed: passed ? 0 : 1 }
    },
    contract: {
      tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed }],
      totalTests: 1,
      passedTests: passed ? 1 : 0,
      allPassed: passed
    }
  }
}

describe('question contract parsing', () => {
  it('defaults the question package version and rejects duplicate case ids', () => {
    const raw = {
      id: 'q1',
      title: 'demo',
      difficulty: 'intermediate',
      type: 'open-build',
      prompt: {
        text: 'design it',
        functionalRequirements: [],
        nonFunctionalRequirements: [],
        scale: {}
      },
      scaffold: { type: 'empty' },
      constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
      suite: {
        name: 'suite',
        visibleToStudent: false,
        cases: [{ id: 'baseline' }]
      },
      rubric: {
        checks: [
          {
            id: 'err',
            description: 'error rate < 10%',
            metric: 'summary.errorRate',
            op: '<',
            value: 0.1
          }
        ]
      }
    }

    expect(parseQuestionPackage(raw).version).toBe('1.0')

    expect(() =>
      parseQuestionPackage({
        ...raw,
        suite: {
          ...raw.suite,
          cases: [{ id: 'baseline' }, { id: 'baseline' }]
        }
      })
    ).toThrow(/Question suite case ids must be unique/)
  })

  it('defaults attempt version and enforces graded attempt invariants', () => {
    const raw = {
      attemptId: 'attempt-1',
      questionId: 'q1',
      topology: topology(),
      status: 'GRADED',
      startedAt: '2026-08-01T00:00:00.000Z',
      lastSavedAt: '2026-08-01T00:05:00.000Z',
      submittedAt: '2026-08-01T00:04:00.000Z',
      testRunCount: 1,
      grade: {
        gradedAt: '2026-08-01T00:05:00.000Z',
        result: fakeGrade(true)
      }
    }

    expect(parseAttemptState(raw).version).toBe('1.0')
    expect(() => parseAttemptState({ ...raw, submittedAt: undefined })).toThrow(
      /requires submittedAt/
    )
  })
})

describe('attempt lifecycle helpers', () => {
  it('creates, grades, and persists dry-run and submit transitions deterministically', () => {
    const baseTopology = topology()
    const draft = createAttemptState({
      questionId: 'q1',
      topology: baseTopology,
      now: '2026-08-01T00:00:00.000Z',
      attemptId: 'attempt-1'
    })

    expect(draft).toMatchObject({
      version: '1.0',
      attemptId: 'attempt-1',
      questionId: 'q1',
      status: 'DRAFT',
      testRunCount: 0
    })

    const grading = markAttemptGrading(draft, {
      questionId: 'q1',
      topology: baseTopology,
      now: '2026-08-01T00:01:00.000Z'
    })
    expect(grading.status).toBe('GRADING')
    expect(grading.attemptId).toBe('attempt-1')

    const dryRun = recordDryRunGrade(grading, {
      topology: baseTopology,
      grade: fakeGrade(false),
      now: '2026-08-01T00:02:00.000Z'
    })
    expect(dryRun).toMatchObject({
      status: 'DRAFT',
      testRunCount: 1
    })
    expect(dryRun.lastDryRun?.grade.contract.allPassed).toBe(false)

    const submitGrading = markAttemptGrading(dryRun, {
      questionId: 'q1',
      topology: baseTopology,
      now: '2026-08-01T00:03:00.000Z'
    })
    const graded = recordSubmittedGrade(submitGrading, {
      topology: baseTopology,
      grade: fakeGrade(true),
      now: '2026-08-01T00:04:00.000Z'
    })

    expect(graded).toMatchObject({
      status: 'GRADED',
      submittedAt: '2026-08-01T00:04:00.000Z'
    })
    expect(graded.grade?.result.contract.allPassed).toBe(true)

    const recovered = recoverAttemptAfterGradingError(graded, '2026-08-01T00:05:00.000Z')
    expect(recovered?.status).toBe('GRADED')
    expect(recovered?.lastSavedAt).toBe('2026-08-01T00:05:00.000Z')
  })

  it('autosaves topology edits by invalidating stale results and resetting status', () => {
    const baseTopology = topology()
    const graded = recordSubmittedGrade(
      markAttemptGrading(
        createAttemptState({
          questionId: 'q1',
          topology: baseTopology,
          now: '2026-08-01T00:00:00.000Z',
          attemptId: 'attempt-1'
        }),
        {
          questionId: 'q1',
          topology: baseTopology,
          now: '2026-08-01T00:01:00.000Z'
        }
      ),
      {
        topology: baseTopology,
        grade: fakeGrade(true),
        now: '2026-08-01T00:02:00.000Z'
      }
    )

    const editedTopology: TopologyJSON = {
      ...baseTopology,
      workload: {
        ...baseTopology.workload,
        baseRps: 150
      }
    }

    const autosaved = autosaveAttempt(graded, {
      questionId: 'q1',
      topology: editedTopology,
      now: '2026-08-01T00:03:00.000Z'
    })

    expect(autosaved.status).toBe('AUTOSAVED')
    expect(autosaved.topology.workload.baseRps).toBe(150)
    expect(autosaved.grade).toBeUndefined()
    expect(autosaved.lastDryRun).toBeUndefined()
    expect(autosaved.submittedAt).toBeUndefined()
  })

  it('downgrades persisted in-flight attempts to autosaved on restore', () => {
    const inFlight = markAttemptGrading(
      createAttemptState({
        questionId: 'q1',
        topology: topology(),
        now: '2026-08-01T00:00:00.000Z',
        attemptId: 'attempt-1'
      }),
      {
        questionId: 'q1',
        topology: topology(),
        now: '2026-08-01T00:01:00.000Z'
      }
    )

    const resumed = resumePersistedAttempt(inFlight, '2026-08-01T00:02:00.000Z')

    expect(resumed?.status).toBe('AUTOSAVED')
    expect(resumed?.lastSavedAt).toBe('2026-08-01T00:02:00.000Z')
    expect(resumed?.submittedAt).toBeUndefined()
  })
})
