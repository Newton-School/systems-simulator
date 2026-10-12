import type { Node } from 'reactflow'
import type { AttemptState, QuestionPackage } from '../../../engine/analysis/question'
import {
  admitDefinitions,
  areDefinitionsLocked,
  definitionEntriesFromCanvasNodes,
  evaluateBuilderPolicy,
  isBuilderPolicyRestrictive,
  resolveBuilderPolicy,
  type BuilderPolicyViolation,
  type DefinitionEntry,
  type ResolvedBuilderPolicy
} from '../../../engine/analysis/builderPolicy'

/** The store slice the builder policy reads. */
export interface BuilderPolicyStateSlice {
  activeQuestion: QuestionPackage | null
  attemptState: AttemptState | null
  scaffoldNodeIds: readonly string[]
  questionRunCount: number
  nodes: readonly Node[]
}

export interface BuilderPolicyContext {
  policy: ResolvedBuilderPolicy
  /** False when there is no question or its policy is all-default (today's behaviour). */
  restrictive: boolean
  locked: boolean
  /** Created definitions on the canvas, scaffold nodes excluded. */
  entries: DefinitionEntry[]
}

export function builderPolicyContext(state: BuilderPolicyStateSlice): BuilderPolicyContext {
  const question = state.activeQuestion
  const policy = resolveBuilderPolicy(question?.builderPolicy)
  const restrictive = question !== null && isBuilderPolicyRestrictive(question.builderPolicy)
  return {
    policy,
    restrictive,
    locked:
      restrictive &&
      areDefinitionsLocked(policy, {
        testRunCount: state.attemptState?.testRunCount,
        hasGrade: Boolean(state.attemptState?.grade || state.attemptState?.lastDryRun),
        sessionRunCount: state.questionRunCount
      }),
    entries: restrictive ? definitionEntriesFromCanvasNodes(state.nodes, state.scaffoldNodeIds) : []
  }
}

/** Current policy findings on the canvas (empty when the policy is not restrictive). */
export function builderPolicyViolations(state: BuilderPolicyStateSlice): BuilderPolicyViolation[] {
  const context = builderPolicyContext(state)
  return context.restrictive ? evaluateBuilderPolicy(context.policy, context.entries) : []
}

/**
 * Why adding these canvas nodes (paste, duplicate) would break the builder policy,
 * or null when they may be added. Pasted definitions count like new ones.
 */
export function builderPolicyAdmissionBlock(
  state: BuilderPolicyStateSlice,
  incomingNodes: readonly Node[]
): string | null {
  const context = builderPolicyContext(state)
  if (!context.restrictive) return null
  const admission = admitDefinitions(
    context.policy,
    context.entries,
    definitionEntriesFromCanvasNodes(incomingNodes),
    context.locked
  )
  return admission.ok === false ? admission.reason : null
}
