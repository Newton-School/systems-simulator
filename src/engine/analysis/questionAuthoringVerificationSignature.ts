import type { QuestionPackage } from './question'
import type { QuestionAuthoringVerificationInput } from './questionAuthoringVerification'
import { canonicalChecksum } from './stableHash'

/** Lightweight content signature used to invalidate stored discrimination proof. */
export function computeVerificationSignature(
  pkg: QuestionPackage,
  input: QuestionAuthoringVerificationInput
): string {
  return canonicalChecksum({
    pkg,
    reference: input.reference.topology,
    gamed: input.gamed.map((design) => ({
      id: design.id,
      expectedObligationId: design.expectedObligationId ?? null,
      topology: design.topology
    }))
  })
}
