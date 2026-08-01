import { describe, expect, it } from 'vitest'
import {
  buildScenarioEvaluationContract,
  type ScenarioEvaluationResult
} from './evaluationContract'

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
