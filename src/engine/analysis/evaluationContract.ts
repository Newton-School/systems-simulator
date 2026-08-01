import type { TopologyJSON } from '../core/types'
import type { SimulationVerdict } from './verdict'

export const SCENARIO_EVALUATION_CONTRACT_VERSION = '1.0' as const

export type ScenarioEvaluationResult =
  | {
      scenarioId: string
      scenarioName?: string
      status: 'completed'
      verdict: SimulationVerdict
    }
  | {
      scenarioId: string
      scenarioName?: string
      status: 'error' | 'timeout'
      error: string
    }

export interface ScenarioEvaluationContract {
  version: typeof SCENARIO_EVALUATION_CONTRACT_VERSION
  simulatorVersion?: string
  topologyId: string
  topologySchemaVersion: string
  submissionId?: string
  /**
   * Optional on purpose: callers that need byte-identical output can omit it,
   * while orchestrators that need a wall-clock stamp can inject one explicitly.
   */
  evaluatedAt?: string
  verdicts: ScenarioEvaluationResult[]
  summary: {
    total: number
    completed: number
    errored: number
    timedOut: number
  }
}

export function buildScenarioEvaluationContract(
  topology: Pick<TopologyJSON, 'id' | 'version'>,
  verdicts: ScenarioEvaluationResult[],
  options?: {
    simulatorVersion?: string
    submissionId?: string
    topologyId?: string
    evaluatedAt?: string
  }
): ScenarioEvaluationContract {
  const completed = verdicts.filter((entry) => entry.status === 'completed').length
  const timedOut = verdicts.filter((entry) => entry.status === 'timeout').length

  return {
    version: SCENARIO_EVALUATION_CONTRACT_VERSION,
    ...(options?.simulatorVersion ? { simulatorVersion: options.simulatorVersion } : {}),
    topologyId: options?.topologyId ?? topology.id,
    topologySchemaVersion: topology.version,
    ...(options?.submissionId ? { submissionId: options.submissionId } : {}),
    ...(options?.evaluatedAt ? { evaluatedAt: options.evaluatedAt } : {}),
    verdicts,
    summary: {
      total: verdicts.length,
      completed,
      errored: verdicts.length - completed - timedOut,
      timedOut
    }
  }
}
