import type { QuestionConstraints } from './question'

export const QUESTION_OWNED_CONFIG_REASON =
  'Provided by this question. It is visible for context but is not one of the learner decisions.'

type QuestionConfigPolicyLens = {
  constraints?: Pick<QuestionConstraints, 'questionOwnedConfigPaths'>
}

/** Returns the learner-facing lock reason for a question-owned node setting. */
export function questionOwnedConfigReason(
  question: QuestionConfigPolicyLens | null | undefined,
  path: string
): string | null {
  return question?.constraints?.questionOwnedConfigPaths?.includes(path)
    ? QUESTION_OWNED_CONFIG_REASON
    : null
}
