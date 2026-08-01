import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildQuestionEvaluationBatch,
  buildQuestionEvaluationContract,
  buildQuestionEvaluationErrorContract,
  buildScenarioEvaluationContract,
  parseQuestionEvaluationBatch,
  parseQuestionEvaluationContract,
  parseScenarioEvaluationContract,
  type ScenarioEvaluationResult
} from './evaluationContract'
import {
  caseRubricTestId,
  structuralTestId,
  type AttemptGrade,
  type QuestionPackage
} from './question'
import { EXECUTION_CHECK_ID } from './rubric'

const fixtures = JSON.parse(
  readFileSync(resolve(__dirname, 'fixtures/evaluation-contracts.json'), 'utf-8')
) as {
  questionPassed: unknown
  questionFailed: unknown
  questionInvalidSubmission: unknown
  questionEvaluationError: unknown
  questionBatch: unknown
  scenarioEvaluation: unknown
}

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
      submissionId: 'sub-1',
      evaluatedAt: '2026-08-01T00:00:00.000Z'
    })

    expect(contract).toEqual(fixtures.scenarioEvaluation)
    expect(parseScenarioEvaluationContract(fixtures.scenarioEvaluation)).toEqual(
      fixtures.scenarioEvaluation
    )
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
      score: { earned: 2, possible: 4, fraction: 0.5 },
      passed: false,
      cases: [
        {
          id: 'baseline',
          ran: true,
          executionStatus: 'completed',
          rubric: {
            version: '1.0',
            checks: [
              {
                id: EXECUTION_CHECK_ID,
                description: 'Case execution completed',
                kind: 'execution',
                actual: null,
                status: 'passed',
                passed: true,
                points: 0,
                awarded: 0
              },
              {
                id: 'err',
                description: 'error rate < 10%',
                kind: 'simulation',
                metric: 'summary.errorRate',
                op: '<',
                value: 0.1,
                actual: 0.01,
                status: 'passed',
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
          executionStatus: 'failed',
          error: 'Execution failed before a verdict was produced.',
          rubric: {
            version: '1.0',
            checks: [
              {
                id: EXECUTION_CHECK_ID,
                description: 'Case execution completed',
                kind: 'execution',
                actual: null,
                status: 'failed',
                passed: false,
                points: 0,
                awarded: 0,
                detail: 'Execution failed before a verdict was produced.'
              },
              {
                id: 'err',
                description: 'error rate < 10%',
                kind: 'simulation',
                metric: 'summary.errorRate',
                op: '<',
                value: 0.1,
                actual: null,
                status: 'skipped',
                passed: false,
                points: 2,
                awarded: 0,
                detail: 'Check was not evaluated because execution did not complete.'
              }
            ],
            score: { earned: 0, possible: 2, fraction: 0 },
            passed: false
          }
        }
      ],
      summary: {
        total: 2,
        ran: 1,
        errored: 1,
        passed: 1,
        failed: 1,
        totalChecks: 4,
        passedChecks: 2,
        failedChecks: 1,
        skippedChecks: 1
      }
    },
    contract: {
      tests: [
        { id: structuralTestId('shape'), name: 'Shape is valid', passed: true },
        {
          id: caseRubricTestId('baseline', 'execution', EXECUTION_CHECK_ID),
          name: 'Case baseline execution completed',
          passed: true
        },
        {
          id: caseRubricTestId('baseline', 'simulation', 'err'),
          name: 'error rate < 10%',
          passed: true
        },
        {
          id: caseRubricTestId('peak', 'execution', EXECUTION_CHECK_ID),
          name: 'Case peak execution completed',
          passed: false,
          detail: 'Execution failed before a verdict was produced.'
        },
        {
          id: caseRubricTestId('peak', 'simulation', 'err'),
          name: 'error rate < 10%',
          passed: false,
          detail: 'Check was not evaluated because execution did not complete.'
        }
      ],
      totalTests: 5,
      passedTests: 3,
      allPassed: false
    }
  }
}

describe('buildQuestionEvaluationContract', () => {
  it('builds the exact passed contract fixture for a single-case question', () => {
    const baseQuestion = questionPackage()
    const singleCaseQuestion: QuestionPackage = {
      ...baseQuestion,
      suite: { ...baseQuestion.suite, cases: [{ id: 'baseline' }] }
    }

    const contract = buildQuestionEvaluationContract(
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
      },
      {
        simulatorVersion: '1.2.3',
        attemptId: 'attempt-pass',
        submissionId: 'sub-pass',
        evaluatedAt: '2026-08-01T00:00:00.000Z'
      }
    )

    expect(contract).toEqual(fixtures.questionPassed)
    expect(parseQuestionEvaluationContract(fixtures.questionPassed)).toEqual(
      fixtures.questionPassed
    )
  })

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

    expect(contract).toEqual(fixtures.questionFailed)
    expect(parseQuestionEvaluationContract(fixtures.questionFailed)).toEqual(
      fixtures.questionFailed
    )
  })

  it('builds explicit error contracts for invalid submissions or evaluation failures', () => {
    const contract = buildQuestionEvaluationErrorContract({
      questionId: 'q1',
      topologyId: 'student-topology',
      status: 'invalid_submission',
      message: 'Question package validation failed',
      evaluatedAt: '2026-08-01T00:00:00.000Z'
    })

    expect(contract).toEqual(fixtures.questionInvalidSubmission)
    expect(parseQuestionEvaluationContract(fixtures.questionInvalidSubmission)).toEqual(
      fixtures.questionInvalidSubmission
    )
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
            score: { earned: 2, possible: 2, fraction: 1 },
            passed: true,
            cases: [
              {
                id: 'baseline',
                ran: true,
                executionStatus: 'completed',
                rubric: {
                  version: '1.0',
                  checks: [
                    {
                      id: EXECUTION_CHECK_ID,
                      description: 'Case execution completed',
                      kind: 'execution',
                      actual: null,
                      status: 'passed',
                      passed: true,
                      points: 0,
                      awarded: 0
                    },
                    {
                      id: 'err',
                      description: 'error rate < 10%',
                      kind: 'simulation',
                      metric: 'summary.errorRate',
                      op: '<',
                      value: 0.1,
                      actual: 0.01,
                      status: 'passed',
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
            summary: {
              total: 1,
              ran: 1,
              errored: 0,
              passed: 1,
              failed: 0,
              totalChecks: 2,
              passedChecks: 2,
              failedChecks: 0,
              skippedChecks: 0
            }
          },
          contract: {
            tests: [{ id: 'baseline:err', name: 'error rate < 10%', passed: true }],
            totalTests: 1,
            passedTests: 1,
            allPassed: true
          }
        },
        {
          simulatorVersion: '1.2.3',
          attemptId: 'attempt-pass',
          submissionId: 'sub-pass',
          evaluatedAt: '2026-08-01T00:00:00.000Z'
        }
      ),
      buildQuestionEvaluationErrorContract({
        questionId: 'q1',
        topologyId: 'student-topology',
        status: 'invalid_submission',
        message: 'Question package validation failed',
        evaluatedAt: '2026-08-01T00:00:00.000Z'
      }),
      buildQuestionEvaluationErrorContract({
        questionId: 'q3',
        topologyId: 'topology-3',
        status: 'evaluation_error',
        message: 'timeout'
      }),
      buildQuestionEvaluationContract(
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
    ],
    {
      simulatorVersion: '1.2.3',
      evaluatedAt: '2026-08-01T00:00:00.000Z'
    })

    expect(batch).toEqual(fixtures.questionBatch)
    expect(parseQuestionEvaluationBatch(fixtures.questionBatch)).toEqual(fixtures.questionBatch)
  })

  it('rejects malformed question contract summaries and malformed batch summaries', () => {
    expect(() =>
      parseQuestionEvaluationContract({
        ...(fixtures.questionFailed as Record<string, unknown>),
        summary: {
          ...((fixtures.questionFailed as Record<string, unknown>).summary as Record<
            string,
            unknown
          >),
          passedTests: 99
        }
      })
    ).toThrow(/summary\.passedTests/i)

    expect(() =>
      parseQuestionEvaluationBatch({
        ...(fixtures.questionBatch as Record<string, unknown>),
        summary: {
          ...((fixtures.questionBatch as Record<string, unknown>).summary as Record<
            string,
            unknown
          >),
          invalidSubmissions: 99
        }
      })
    ).toThrow(/summary\.invalidSubmissions/i)
  })
})
