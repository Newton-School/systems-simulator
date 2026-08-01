import { describe, expect, it } from 'vitest'
import {
  buildQuestionEvaluationBatch,
  buildQuestionEvaluationContract,
  buildQuestionEvaluationErrorContract,
  buildScenarioEvaluationContract,
  type ScenarioEvaluationResult
} from './evaluationContract'
import type { AttemptGrade, QuestionPackage } from './question'

describe('buildScenarioEvaluationContract', () => {
  const topology = {
    id: 'student-topology',
    version: '2.0.0'
  }

  it('builds a stable summary and keeps evaluatedAt optional for deterministic output', () => {
    const verdicts: ScenarioEvaluationResult[] = [
      { scenarioId: 'a', status: 'completed', verdict: { version: '1.0' } as never },
      { scenarioId: 'b', status: 'error', error: 'boom' },
      { scenarioId: 'c', status: 'timeout', error: 'timed out' }
    ]

    const contract = buildScenarioEvaluationContract(topology, verdicts, {
      simulatorVersion: '1.2.3',
      submissionId: 'sub-1'
    })

    expect(contract).toMatchObject({
      version: '1.0',
      simulatorVersion: '1.2.3',
      topologyId: 'student-topology',
      topologySchemaVersion: '2.0.0',
      submissionId: 'sub-1',
      summary: { total: 3, completed: 1, errored: 1, timedOut: 1 }
    })
    expect('evaluatedAt' in contract).toBe(false)
  })

  it('includes an explicit evaluatedAt only when the caller provides one', () => {
    const contract = buildScenarioEvaluationContract(topology, [], {
      evaluatedAt: '2026-08-01T00:00:00.000Z'
    })

    expect(contract.evaluatedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

function questionPackage(): QuestionPackage {
  return {
    version: '1.0',
    id: 'q1',
    title: 'Demo Question',
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Design it',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    },
    scaffold: { type: 'empty' },
    constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
    suite: {
      name: 'demo-suite',
      visibleToStudent: false,
      cases: [{ id: 'baseline' }, { id: 'peak' }]
    },
    rubric: {
      checks: [
        {
          id: 'err',
          description: 'error rate < 10%',
          metric: 'summary.errorRate',
          op: '<',
          value: 0.1,
          points: 2
        }
      ]
    }
  }
}

function failedGrade(): AttemptGrade {
  return {
    structural: {
      version: '1.0',
      passed: true,
      checks: [{ id: 'shape', description: 'Shape is valid', passed: true }]
    },
    graded: {
      version: '1.0',
      suite: 'demo-suite',
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
                actual: 0.01,
                passed: true,
                points: 2,
                awarded: 2
              }
            ],
            score: { earned: 2, possible: 2, fraction: 1 },
            passed: true
          }
        },
        {
          id: 'peak',
          ran: false,
          error: 'boom'
        }
      ],
      summary: { total: 2, ran: 1, errored: 1, passed: 1, failed: 1 }
    },
    contract: {
      tests: [
        { id: 'structural:shape', name: 'Shape is valid', passed: true },
        { id: 'baseline:err', name: 'error rate < 10%', passed: true },
        { id: 'peak:did-not-run', name: 'Case peak could not run', passed: false, detail: 'boom' }
      ],
      totalTests: 3,
      passedTests: 2,
      allPassed: false
    }
  }
}

describe('buildQuestionEvaluationContract', () => {
  it('builds a stable question evaluation contract with score, summary, and normalized tests', () => {
    const contract = buildQuestionEvaluationContract(
      questionPackage(),
      { id: 'student-topology', version: '2.0.0' },
      failedGrade(),
      {
        simulatorVersion: '1.2.3',
        attemptId: 'attempt-1',
        submissionId: 'sub-1',
        evaluatedAt: '2026-08-01T00:00:00.000Z'
      }
    )

    expect(contract).toMatchObject({
      version: '1.0',
      mode: 'question',
      simulatorVersion: '1.2.3',
      questionId: 'q1',
      questionVersion: '1.0',
      topologyId: 'student-topology',
      topologySchemaVersion: '2.0.0',
      attemptId: 'attempt-1',
      submissionId: 'sub-1',
      evaluatedAt: '2026-08-01T00:00:00.000Z',
      status: 'failed',
      score: { earned: 2, possible: 4, fraction: 0.5 },
      summary: {
        totalTests: 3,
        passedTests: 2,
        failedTests: 1,
        structuralFailures: 0,
        rubricFailures: 0,
        executionFailures: 1
      }
    })
    expect(contract.tests).toEqual([
      {
        id: 'structural:shape',
        name: 'Shape is valid',
        scope: 'structure',
        kind: 'structural',
        status: 'passed',
        pointsEarned: 0,
        pointsPossible: 0
      },
      {
        id: 'baseline:err',
        name: 'error rate < 10%',
        scope: 'baseline',
        kind: 'rubric',
        status: 'passed',
        pointsEarned: 2,
        pointsPossible: 2
      },
      {
        id: 'peak:did-not-run',
        name: 'Case peak could not run',
        scope: 'peak',
        kind: 'execution',
        status: 'failed',
        pointsEarned: 0,
        pointsPossible: 0,
        detail: 'boom'
      }
    ])
  })

  it('builds explicit error contracts for invalid submissions or evaluation failures', () => {
    const contract = buildQuestionEvaluationErrorContract({
      questionId: 'q1',
      topologyId: 'student-topology',
      status: 'invalid_submission',
      message: 'Question package validation failed',
      evaluatedAt: '2026-08-01T00:00:00.000Z'
    })

    expect(contract).toMatchObject({
      version: '1.0',
      mode: 'question',
      questionId: 'q1',
      topologyId: 'student-topology',
      status: 'invalid_submission',
      score: { earned: 0, possible: 0, fraction: 0 },
      summary: {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        structuralFailures: 0,
        rubricFailures: 0,
        executionFailures: 0
      },
      error: {
        code: 'INVALID_SUBMISSION',
        message: 'Question package validation failed'
      }
    })
    expect(contract.host.allPassed).toBe(false)
  })

  it('aggregates question result statuses into a batch summary', () => {
    const baseQuestion = questionPackage()
    const singleCaseQuestion: QuestionPackage = {
      ...baseQuestion,
      suite: { ...baseQuestion.suite, cases: [{ id: 'baseline' }] }
    }

    const batch = buildQuestionEvaluationBatch([
      buildQuestionEvaluationContract(
        singleCaseQuestion,
        { id: 'topology-1', version: '2.0.0' },
        {
          structural: { version: '1.0', passed: true, checks: [] },
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
                      actual: 0.01,
                      passed: true,
                      points: 2,
                      awarded: 2
                    }
                  ],
                  score: { earned: 2, possible: 2, fraction: 1 },
                  passed: true
                }
              }
            ],
            summary: { total: 1, ran: 1, errored: 0, passed: 1, failed: 0 }
          },
          contract: {
            tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed: true }],
            totalTests: 1,
            passedTests: 1,
            allPassed: true
          }
        }
      ),
      buildQuestionEvaluationErrorContract({
        questionId: 'q2',
        topologyId: 'topology-2',
        status: 'invalid_submission',
        message: 'bad topology'
      }),
      buildQuestionEvaluationErrorContract({
        questionId: 'q3',
        topologyId: 'topology-3',
        status: 'evaluation_error',
        message: 'timeout'
      }),
      buildQuestionEvaluationContract(
        questionPackage(),
        { id: 'topology-4', version: '2.0.0' },
        failedGrade()
      )
    ])

    expect(batch).toMatchObject({
      version: '1.0',
      mode: 'question-batch',
      summary: {
        total: 4,
        passed: 1,
        failed: 1,
        invalidSubmissions: 1,
        evaluationErrors: 1
      }
    })
  })
})
