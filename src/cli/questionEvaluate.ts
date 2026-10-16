import { buildQuestionEvaluationContract } from '../engine/analysis/evaluationContract'
import { gradeAttempt, type QuestionPackage } from '../engine/analysis/question'
import type { TopologyJSON } from '../engine/core/types'
import { runSimulation } from '../engine/runSimulation'
import type { Abstraction } from '../engine/classroom/types'

export interface QuestionEvaluationOptions {
  simulatorVersion?: string
  attemptId?: string
  submissionId?: string
  topologyId?: string
  evaluatedAt?: string
  /** Grade at this abstraction; 'classroom' rebuilds the submission from the question's givens. */
  abstraction?: Abstraction
}

export function evaluateQuestionSubmission(
  question: QuestionPackage,
  topology: TopologyJSON,
  options: QuestionEvaluationOptions = {}
) {
  const grade = gradeAttempt(
    question,
    topology,
    (candidateTopology) => runSimulation(candidateTopology),
    [],
    { abstraction: options.abstraction }
  )

  return buildQuestionEvaluationContract(question, topology, grade, options)
}
