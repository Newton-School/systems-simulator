/**
 * The immutable, grading-safe evaluation envelope.
 *
 * An envelope is the frozen record of a single *submission* at grade time. It
 * ties together everything needed to audit or reproduce a grade without any
 * external state:
 *
 *   - a frozen snapshot of the exact topology that was graded,
 *   - the per-case simulation verdict(s),
 *   - a bounded replay digest per case (with optional full replay attached),
 *   - the evaluation contract (the grade itself), and
 *   - a content checksum that makes the whole thing tamper-evident.
 *
 * Design decisions (see docs/question-platform-hardening/05-...):
 *  - Replay is captured as a *digest* by default (counts + an event-stream
 *    checksum). The full per-request replay can be attached on demand but is
 *    excluded from the envelope checksum, so attaching/detaching it never
 *    invalidates the envelope — the digest's `eventStreamChecksum` still binds
 *    the replay content.
 *  - The checksum is an integrity/reproducibility primitive, not a cryptographic
 *    signature (see stableHash.ts).
 */
import { z } from 'zod'
import type { TopologyJSON } from '../core/types'
import type {
  CanonicalEventRecord,
  EventCountsByType,
  TerminalRequestStatus
} from '../core/event-stream'
import { TopologyJSONSchema } from '../validation/validator'
import { canonicalChecksum } from './stableHash'
import { replayEventStream, type ReplayResult } from './replay'
import type { SimulationVerdict } from './verdict'
import type { CaseExecutionStatus } from './rubric'
import {
  parseQuestionEvaluationContract,
  type QuestionEvaluationContract
} from './evaluationContract'

export const EVALUATION_ENVELOPE_VERSION = '1.0' as const

const TERMINAL_STATUSES: readonly TerminalRequestStatus[] = [
  'success',
  'timeout',
  'rejected',
  'connection_reset'
]

/** A bounded summary of a case's replay — safe to persist in every envelope. */
export interface ReplayDigest {
  lifecycleCount: number
  eventCountsByType: EventCountsByType
  terminalStatusCounts: Record<TerminalRequestStatus, number>
  /** Checksum of the canonical event stream this digest was built from. */
  eventStreamChecksum: string
}

export interface EvaluationEnvelopeCase {
  caseId: string
  executionStatus: CaseExecutionStatus
  /** Present when the case actually ran to a verdict. */
  verdict?: SimulationVerdict
  /** Present when events were captured for the case. */
  replayDigest?: ReplayDigest
  /** Optional full replay — excluded from the envelope checksum. */
  replay?: ReplayResult
}

export interface EvaluationEnvelope {
  version: typeof EVALUATION_ENVELOPE_VERSION
  submissionId: string
  questionId: string
  questionVersion: string
  attemptId: string
  topologyId: string
  topologySchemaVersion: string
  submittedAt: string
  evaluatedAt: string
  /** The exact topology that was graded, frozen. */
  topologySnapshot: TopologyJSON
  cases: EvaluationEnvelopeCase[]
  /** The grade: the full question evaluation contract. */
  contract: QuestionEvaluationContract
  /** Integrity checksum over the whole envelope except optional full replay. */
  checksum: string
}

/** Builds a bounded replay digest from a canonical event stream. */
export function buildReplayDigest(events: CanonicalEventRecord[]): ReplayDigest {
  const replay = replayEventStream(events)
  return buildReplayDigestFromResult(replay)
}

/** Builds a replay digest from an already-computed replay result. */
export function buildReplayDigestFromResult(replay: ReplayResult): ReplayDigest {
  const terminalStatusCounts = TERMINAL_STATUSES.reduce(
    (counts, status) => {
      counts[status] = 0
      return counts
    },
    {} as Record<TerminalRequestStatus, number>
  )

  for (const status of Object.values(replay.terminalStatusByRequestId)) {
    terminalStatusCounts[status] += 1
  }

  return {
    lifecycleCount: replay.lifecycles.length,
    eventCountsByType: { ...replay.eventCountsByType },
    terminalStatusCounts,
    eventStreamChecksum: canonicalChecksum(replay.lifecycles)
  }
}

type EnvelopeForChecksum = Omit<EvaluationEnvelope, 'checksum'> & { checksum?: string }

/**
 * The projection of an envelope that the checksum covers: the self-checksum and
 * any optional full replay are excluded, so the function is idempotent whether
 * it is handed a pre-seal base or an already-sealed envelope.
 */
function checksumTarget(envelope: EnvelopeForChecksum): unknown {
  const { checksum: _checksum, cases, ...rest } = envelope
  return {
    ...rest,
    cases: cases.map(({ replay: _replay, ...caseRest }) => caseRest)
  }
}

export function computeEnvelopeChecksum(envelope: EnvelopeForChecksum): string {
  return canonicalChecksum(checksumTarget(envelope))
}

export interface BuildEvaluationEnvelopeInput {
  submissionId: string
  attemptId: string
  submittedAt: string
  evaluatedAt: string
  topologySnapshot: TopologyJSON
  cases: EvaluationEnvelopeCase[]
  contract: QuestionEvaluationContract
}

/**
 * Builds a sealed evaluation envelope. Question/topology identity is derived from
 * the contract so the envelope can never disagree with the grade it carries.
 */
export function buildEvaluationEnvelope(input: BuildEvaluationEnvelopeInput): EvaluationEnvelope {
  const base: Omit<EvaluationEnvelope, 'checksum'> = {
    version: EVALUATION_ENVELOPE_VERSION,
    submissionId: input.submissionId,
    questionId: input.contract.questionId,
    questionVersion: input.contract.questionVersion,
    attemptId: input.attemptId,
    topologyId: input.contract.topologyId,
    topologySchemaVersion: input.contract.topologySchemaVersion,
    submittedAt: input.submittedAt,
    evaluatedAt: input.evaluatedAt,
    topologySnapshot: input.topologySnapshot,
    cases: input.cases,
    contract: input.contract
  }

  return { ...base, checksum: computeEnvelopeChecksum(base) }
}

const ReplayDigestSchema: z.ZodType<ReplayDigest> = z
  .object({
    lifecycleCount: z.number().int().nonnegative(),
    eventCountsByType: z.record(z.string(), z.number().int().nonnegative()),
    terminalStatusCounts: z.record(z.string(), z.number().int().nonnegative()),
    eventStreamChecksum: z.string().min(1)
  })
  .strict() as unknown as z.ZodType<ReplayDigest>

const EnvelopeCaseSchema: z.ZodType<EvaluationEnvelopeCase> = z
  .object({
    caseId: z.string().min(1),
    executionStatus: z.enum(['completed', 'failed', 'skipped']),
    verdict: z.custom<SimulationVerdict>().optional(),
    replayDigest: ReplayDigestSchema.optional(),
    replay: z.custom<ReplayResult>().optional()
  })
  .strict() as unknown as z.ZodType<EvaluationEnvelopeCase>

const EvaluationEnvelopeSchema = z
  .object({
    version: z.literal(EVALUATION_ENVELOPE_VERSION),
    submissionId: z.string().min(1),
    questionId: z.string().min(1),
    questionVersion: z.string().min(1),
    attemptId: z.string().min(1),
    topologyId: z.string().min(1),
    topologySchemaVersion: z.string().min(1),
    submittedAt: z.string().min(1),
    evaluatedAt: z.string().min(1),
    topologySnapshot: TopologyJSONSchema,
    cases: z.array(EnvelopeCaseSchema),
    contract: z.custom<QuestionEvaluationContract>(),
    checksum: z.string().min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    // The carried contract must itself be valid.
    try {
      parseQuestionEvaluationContract(value.contract)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contract'],
        message: 'contract must be a valid question evaluation contract.'
      })
      return
    }

    // Identity must agree with the contract it seals.
    if (value.questionId !== value.contract.questionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionId'],
        message: 'questionId must match the sealed contract.'
      })
    }
    if (value.topologyId !== value.contract.topologyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['topologyId'],
        message: 'topologyId must match the sealed contract.'
      })
    }

    // Integrity: the checksum must match a recomputation.
    const { checksum, ...rest } = value as EvaluationEnvelope
    if (checksum !== computeEnvelopeChecksum(rest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checksum'],
        message: 'checksum does not match envelope contents (possible tampering or drift).'
      })
    }
  })

/** Parses and fully validates (including integrity) an untrusted envelope. */
export function parseEvaluationEnvelope(raw: unknown): EvaluationEnvelope {
  return EvaluationEnvelopeSchema.parse(raw) as EvaluationEnvelope
}

export interface EnvelopeVerification {
  valid: boolean
  reason?: string
}

/** Non-throwing integrity check — useful for archives that must degrade gracefully. */
export function verifyEvaluationEnvelope(envelope: EvaluationEnvelope): EnvelopeVerification {
  const { checksum, ...rest } = envelope
  if (checksum !== computeEnvelopeChecksum(rest)) {
    return { valid: false, reason: 'checksum mismatch' }
  }
  if (envelope.questionId !== envelope.contract.questionId) {
    return { valid: false, reason: 'questionId does not match contract' }
  }
  if (envelope.topologyId !== envelope.contract.topologyId) {
    return { valid: false, reason: 'topologyId does not match contract' }
  }
  return { valid: true }
}
