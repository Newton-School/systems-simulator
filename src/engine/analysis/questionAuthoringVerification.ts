/**
 * The Prove stage's engine core: run the reference and gamed designs through the
 * *production* grader ({@link gradeAttempt}) and the *production* auto-router
 * ({@link runSimulation} / {@link resolveEvaluationMode}), then report whether the
 * question actually discriminates — reference passes, every gamed design fails, and
 * each gamed design fails on the obligation the author intended.
 *
 * This module never re-implements grading or simulation. It only orchestrates the
 * canonical entry points and shapes their output into a discrimination matrix.
 */

import { getRubricMetricCapability } from './authoringCapabilities'
import { gradeAttempt } from './question'
import type { QuestionPackage } from './question'
import { resolveEvaluationMode, runSimulation } from '../runSimulation'
import type { EvaluationMode, RunSimulationOptions } from '../runSimulation'
import type { TopologyJSON } from '../core/types'
import { computeVerificationSignature } from './questionAuthoringVerificationSignature'

export { computeVerificationSignature } from './questionAuthoringVerificationSignature'

export type VerificationObligationAxis = 'structural' | 'semantic' | 'rubric'

export interface VerificationObligationOutcome {
  id: string
  axis: VerificationObligationAxis
  passed: boolean
}

export type ExpectedDiscriminator = 'not-specified' | 'caught' | 'missed'

export interface VerificationDesignInput {
  id: string
  label: string
  topology: TopologyJSON
  /** Only meaningful for gamed designs. */
  misconception?: string
  /** The obligation id the author expects to catch this gamed design. */
  expectedObligationId?: string
}

export interface QuestionAuthoringVerificationInput {
  reference: VerificationDesignInput
  gamed: readonly VerificationDesignInput[]
}

export interface VerificationDesignResult {
  id: string
  label: string
  role: 'reference' | 'gamed'
  misconception?: string
  expectedObligationId?: string
  structuralPassed: boolean
  semanticPassed: boolean
  rubricPassed: boolean
  overallPassed: boolean
  obligations: VerificationObligationOutcome[]
  /** Evaluation modes the auto-router resolved across this design's cases. */
  resolvedModes: EvaluationMode[]
  /** Obligations whose required evidence the resolved mode cannot authoritatively provide. */
  evidenceBlockers: string[]
  /** For gamed designs: did the expected obligation actually catch it? */
  expectedDiscriminator: ExpectedDiscriminator
  /**
   * A gamed design that fails, but NOT via its intended obligation, is not proof of
   * a good grading contract — the failure is accidental.
   */
  accidentalFailure: boolean
}

export interface QuestionAuthoringVerificationReport {
  reference: VerificationDesignResult
  gamed: VerificationDesignResult[]
  /** True only when reference passes, every gamed design fails on its obligation, and no evidence is blocked. */
  ready: boolean
  /** Human-readable reasons the report is not publish-ready. */
  blockers: string[]
  /** Detects staleness: recompute and compare to a stored value after any relevant edit. */
  signature: string
  generatedAt: string
}

function obligationMap(
  pkg: QuestionPackage,
  grade: ReturnType<typeof gradeAttempt>
): VerificationObligationOutcome[] {
  const outcomes: VerificationObligationOutcome[] = []

  for (const check of grade.structural.checks) {
    outcomes.push({ id: check.id, axis: 'structural', passed: check.passed })
  }

  for (const result of grade.semantic?.results ?? []) {
    outcomes.push({ id: result.id, axis: 'semantic', passed: result.outcome === 'passed' })
  }

  const ranCases = grade.graded.cases.filter((entry) => entry.ran)
  for (const check of pkg.rubric.checks) {
    const passed =
      ranCases.length > 0 &&
      ranCases.every((entry) =>
        (entry.rubric?.checks ?? []).some((result) => result.id === check.id && result.passed)
      )
    outcomes.push({ id: check.id, axis: 'rubric', passed })
  }

  return outcomes
}

/**
 * An obligation whose evidence the resolved mode cannot provide. Today only rubric
 * metrics depend on the run: static-topology structural/semantic obligations do not
 * consume a simulation mode. The check stays general so it tightens automatically as
 * per-request-only metrics are added to the registry.
 */
function computeEvidenceBlockers(pkg: QuestionPackage, resolvedModes: EvaluationMode[]): string[] {
  if (resolvedModes.length === 0) return []
  const blockers: string[] = []
  for (const check of pkg.rubric.checks) {
    if (!check.metric) continue
    const capability = getRubricMetricCapability(check.metric)
    if (!capability) continue
    const provable = resolvedModes.some((mode) =>
      mode === 'auto' ? true : capability.evidenceModes.includes(mode)
    )
    if (!provable) {
      blockers.push(
        `Check "${check.id}" needs ${capability.evidenceModes.join('/')} evidence, but the run resolved to ${resolvedModes.join('/')}.`
      )
    }
  }
  return blockers
}

function verifyDesign(
  pkg: QuestionPackage,
  design: VerificationDesignInput,
  role: 'reference' | 'gamed',
  options: RunSimulationOptions
): VerificationDesignResult {
  const modes = new Set<EvaluationMode>()
  const run = (topology: TopologyJSON): ReturnType<typeof runSimulation> => {
    modes.add(resolveEvaluationMode(topology, options))
    return runSimulation(topology, options)
  }

  const grade = gradeAttempt(pkg, design.topology, run)
  const obligations = obligationMap(pkg, grade)
  const resolvedModes = [...modes]
  const evidenceBlockers = computeEvidenceBlockers(pkg, resolvedModes)
  const overallPassed = grade.contract.allPassed

  let expectedDiscriminator: ExpectedDiscriminator = 'not-specified'
  let accidentalFailure = false
  if (role === 'gamed') {
    if (design.expectedObligationId) {
      const expected = obligations.find((outcome) => outcome.id === design.expectedObligationId)
      // An unknown obligation id cannot catch anything.
      const expectedPassed = expected?.passed ?? true
      expectedDiscriminator = expectedPassed ? 'missed' : 'caught'
      accidentalFailure = !overallPassed && expectedPassed
    } else {
      // No intended obligation named: any failure is unattributed, so treat a
      // failing design as an accidental (unproven) discriminator.
      accidentalFailure = !overallPassed
    }
  }

  return {
    id: design.id,
    label: design.label,
    role,
    ...(design.misconception ? { misconception: design.misconception } : {}),
    ...(design.expectedObligationId ? { expectedObligationId: design.expectedObligationId } : {}),
    structuralPassed: grade.structural.passed,
    semanticPassed: grade.semantic?.passed ?? true,
    rubricPassed: grade.graded.passed,
    overallPassed,
    obligations,
    resolvedModes,
    evidenceBlockers,
    expectedDiscriminator,
    accidentalFailure
  }
}

export function runQuestionAuthoringVerification(
  pkg: QuestionPackage,
  input: QuestionAuthoringVerificationInput,
  options: RunSimulationOptions = {}
): QuestionAuthoringVerificationReport {
  const reference = verifyDesign(pkg, input.reference, 'reference', options)
  const gamed = input.gamed.map((design) => verifyDesign(pkg, design, 'gamed', options))

  const blockers: string[] = []
  if (!reference.overallPassed) {
    blockers.push('The reference design does not pass every obligation.')
  }
  reference.evidenceBlockers.forEach((blocker) => blockers.push(`Reference: ${blocker}`))
  if (gamed.length === 0) {
    blockers.push('Add at least one gamed design that the contract must reject.')
  }
  for (const design of gamed) {
    if (design.overallPassed) {
      blockers.push(`Gamed design "${design.label}" still passes — it is not being caught.`)
    } else if (design.expectedObligationId && design.expectedDiscriminator === 'missed') {
      blockers.push(
        `Gamed design "${design.label}" fails, but not on its intended obligation "${design.expectedObligationId}".`
      )
    } else if (design.accidentalFailure) {
      blockers.push(
        `Gamed design "${design.label}" fails for an unattributed reason — name the obligation that should catch it.`
      )
    }
    design.evidenceBlockers.forEach((blocker) => blockers.push(`${design.label}: ${blocker}`))
  }

  return {
    reference,
    gamed,
    ready: blockers.length === 0,
    blockers,
    signature: computeVerificationSignature(pkg, input),
    generatedAt: new Date().toISOString()
  }
}
