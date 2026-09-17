import { buildQuestionEvaluationContract } from '../engine/analysis/evaluationContract'
import { gradeAttempt, type QuestionPackage } from '../engine/analysis/question'
import type { TopologyJSON } from '../engine/core/types'
import { runSimulation } from '../engine/runSimulation'

export interface QuestionEvaluationOptions {
  simulatorVersion?: string
  attemptId?: string
  submissionId?: string
  topologyId?: string
  evaluatedAt?: string
}

export function evaluateQuestionSubmission(
  question: QuestionPackage,
  topology: TopologyJSON,
  options: QuestionEvaluationOptions = {}
) {
  const grade = gradeAttempt(question, topology, (candidateTopology) =>
    runSimulation(candidateTopology)
  )

  return buildQuestionEvaluationContract(question, topology, grade, options)
}
