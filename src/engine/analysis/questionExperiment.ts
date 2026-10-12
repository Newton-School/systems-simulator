/**
 * Chaos experiments as question test cases.
 *
 * A suite case may carry `experiment`: one chaos preset (cache-stampede,
 * db-failover, traffic-spike, az-outage) or several composed with offsets. At
 * grading time the experiment is built and compiled against the LEARNER's
 * topology (after the case's workload / global overrides are merged), run once
 * through the same injected engine run as every other case, and evaluated with
 * the experiment's own steady-state and verify checks.
 *
 * Grading rule: the case passes only when the experiment verdict is `passed`.
 * The case's rubric is the experiment, not the shared rubric metric checks:
 *   - `experiment.verdict` - the gate, worth `points` (default 1);
 *   - one informational row per experiment check (steady state, each verify,
 *     final), worth 0 points, carrying the measured values.
 * A preset that cannot apply to the learner's design (no availability zones,
 * no cache with a hit model, ...) fails the case with the preset's plain reason
 * instead of crashing the attempt.
 */

import { z } from 'zod'
import type { TopologyJSON } from '../core/types'
import type { SimulationOutput } from './output'
import type { PreparedCase } from './evaluate'
import {
  CHAOS_PRESETS,
  buildExperimentFromPresets,
  describeAssertion,
  evaluateExperiment,
  formatMetricValue,
  validatePresetOptions,
  type AssertionResult,
  type ChaosPresetId,
  type CheckResult as ExperimentCheckResult,
  type ExperimentPlan,
  type ExperimentResult,
  type ExperimentVerdict
} from '../scenarios'
import {
  EXECUTION_CHECK_DESCRIPTION,
  EXECUTION_CHECK_ID,
  aggregateBatchScore,
  batchSummary,
  type CheckResult,
  type GradedCaseResult,
  type GradedEvaluationBatch,
  type Rubric
} from './rubric'

export interface QuestionCaseExperimentPreset {
  presetId: ChaosPresetId
  /**
   * Composition only: seconds after the shared steady-state baseline before this
   * preset's first step. Whole seconds; default 0.
   */
  offsetSeconds?: number
  /** Preset overrides (see PRESET_OPTION_FIELDS), e.g. `{ outageSeconds: 20 }`. */
  options?: Record<string, string | number>
}

export interface QuestionCaseExperiment {
  /** One preset, or several composed into one run (offsets decide the overlap). */
  presets: QuestionCaseExperimentPreset[]
  /** Points for the verdict gate. Default 1. */
  points?: number
}

export const EXPERIMENT_VERDICT_CHECK_ID = 'experiment.verdict' as const

/** The Prove-stage obligation an experiment case stands for (a gamed design can name it). */
export function experimentObligationId(caseId: string): string {
  return `experiment:${caseId}`
}

/** What an experiment case did for one attempt, kept on the grade for display. */
export interface QuestionExperimentCaseResult {
  caseId: string
  name: string
  /** `unavailable`: the experiment could not be built for this design. `error`: the run threw. */
  verdict: ExperimentVerdict | 'unavailable' | 'error'
  passed: boolean
  summary: string
  /** The full experiment result when it ran. */
  result?: ExperimentResult
}

const PRESET_IDS = CHAOS_PRESETS.map((preset) => preset.id) as [ChaosPresetId, ...ChaosPresetId[]]

/** The shape alone (drafts stay saveable while options are being edited). */
export const QuestionCaseExperimentShapeSchema = z
  .object({
    presets: z
      .array(
        z
          .object({
            presetId: z.enum(PRESET_IDS),
            offsetSeconds: z.number().int().nonnegative().optional(),
            options: z.record(z.string(), z.union([z.string(), z.number().finite()])).optional()
          })
          .strict()
      )
      .min(1),
    points: z.number().int().positive().optional()
  })
  .strict()

export const QuestionCaseExperimentSchema: z.ZodType<QuestionCaseExperiment> =
  QuestionCaseExperimentShapeSchema.superRefine((experiment, ctx) => {
    experiment.presets.forEach((preset, index) => {
      for (const issue of validatePresetOptions(preset.presetId, preset.options)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['presets', index, 'options'],
          message: issue
        })
      }
    })
  })

export const QuestionExperimentCaseResultSchema: z.ZodType<QuestionExperimentCaseResult> = z.object(
  {
    caseId: z.string().min(1),
    name: z.string(),
    verdict: z.enum(['passed', 'failed', 'not-stable', 'inconclusive', 'unavailable', 'error']),
    passed: z.boolean(),
    summary: z.string(),
    result: z
      .custom<ExperimentResult>((value) => typeof value === 'object' && value !== null)
      .optional()
  }
)

const VERDICT_TEXT: Record<QuestionExperimentCaseResult['verdict'], string> = {
  passed: 'Passed',
  failed: 'Failed',
  'not-stable': 'Not stable before the fault',
  inconclusive: 'Inconclusive',
  unavailable: 'Cannot run on this design',
  error: 'Run failed'
}

export function experimentVerdictText(verdict: QuestionExperimentCaseResult['verdict']): string {
  return VERDICT_TEXT[verdict]
}

/** "AZ outage", or "Traffic spike + Cache stampede (5s in)" for a composition. */
export function describeCaseExperiment(experiment: QuestionCaseExperiment): string {
  return experiment.presets
    .map((preset) => {
      const name = CHAOS_PRESETS.find((entry) => entry.id === preset.presetId)?.name
      const label = name ?? preset.presetId
      return preset.offsetSeconds ? `${label} (${preset.offsetSeconds}s in)` : label
    })
    .join(' + ')
}

export function experimentPresetEntries(experiment: QuestionCaseExperiment) {
  return experiment.presets.map((preset) => ({
    presetId: preset.presetId,
    offsetMs: (preset.offsetSeconds ?? 0) * 1000,
    ...(preset.options ? { options: preset.options } : {})
  }))
}

/** A case ready to run, plus what is needed to evaluate it afterwards. */
export interface PreparedExperimentCase {
  prepared: PreparedCase
  name: string
  plan?: ExperimentPlan
  /** Set when the experiment cannot be built for this topology. */
  unavailableReason?: string
}

/**
 * Build + compile the case's experiment against the (already merged) learner
 * topology. The compiled topology owns the run's duration, warmup and faults.
 */
export function prepareExperimentCase(
  caseId: string,
  topology: TopologyJSON,
  experiment: QuestionCaseExperiment
): PreparedExperimentCase {
  const name = describeCaseExperiment(experiment)
  const built = buildExperimentFromPresets(topology, experimentPresetEntries(experiment))
  if (built.ok === false) {
    const reason = `This design cannot run the ${name} experiment: ${built.reason}`
    return { prepared: { id: caseId, error: reason }, name, unavailableReason: reason }
  }
  return {
    prepared: { id: caseId, topology: built.compiled.topology },
    name,
    plan: built.compiled.plan
  }
}

function assertionLine(assertion: AssertionResult): string {
  const measured =
    assertion.actual === null
      ? assertion.status === 'skipped'
        ? 'not measured'
        : 'no data'
      : formatMetricValue(assertion.assertion.metric, assertion.actual)
  const status =
    assertion.status === 'pass'
      ? 'pass'
      : assertion.status === 'observed'
        ? 'observed'
        : assertion.status === 'skipped'
          ? 'skipped'
          : 'fail'
  return `${assertion.label}: ${measured} (${status})`
}

function checkRow(name: string, check: ExperimentCheckResult): CheckResult {
  const status: CheckResult['status'] =
    check.status === 'fail' ? 'failed' : check.status === 'skipped' ? 'skipped' : 'passed'
  return {
    id: `experiment.${check.id}`,
    description: `${name}: ${check.label}`,
    kind: 'simulation',
    metric: `experiment.${check.id}`,
    actual: null,
    status,
    passed: status === 'passed',
    points: 0,
    awarded: 0,
    detail: check.assertions.map(assertionLine).join('; ') || check.label
  }
}

function verdictRow(
  name: string,
  points: number,
  passed: boolean,
  actual: number | null,
  detail: string
): CheckResult {
  return {
    id: EXPERIMENT_VERDICT_CHECK_ID,
    description: `Chaos experiment "${name}" passes`,
    kind: 'simulation',
    metric: EXPERIMENT_VERDICT_CHECK_ID,
    op: '==',
    value: 1,
    actual,
    status: passed ? 'passed' : 'failed',
    passed,
    points,
    awarded: passed ? points : 0,
    detail
  }
}

function caseRubric(rubric: Rubric, checks: CheckResult[]) {
  const possible = checks.reduce((sum, check) => sum + check.points, 0)
  const earned = checks.reduce((sum, check) => sum + check.awarded, 0)
  const fraction = possible > 0 ? earned / possible : 1
  return {
    version: '1.0' as const,
    ...(rubric.id ? { rubricId: rubric.id } : {}),
    checks,
    score: { earned, possible, fraction },
    passed: fraction >= (rubric.passThreshold ?? 1)
  }
}

function executionRow(ok: boolean, detail?: string): CheckResult {
  return {
    id: EXECUTION_CHECK_ID,
    description: EXECUTION_CHECK_DESCRIPTION,
    kind: 'execution',
    actual: null,
    status: ok ? 'passed' : 'failed',
    passed: ok,
    points: 0,
    awarded: 0,
    ...(detail ? { detail } : {})
  }
}

/**
 * Grade one experiment case from its run. `output` is the engine output of the
 * compiled topology; `runError` is set when the run threw.
 */
export function gradeExperimentCase(input: {
  rubric: Rubric
  caseId: string
  experiment: QuestionCaseExperiment
  prepared: PreparedExperimentCase
  output?: SimulationOutput
  runError?: string
  topology: TopologyJSON
}): { graded: GradedCaseResult; result: QuestionExperimentCaseResult } {
  const { rubric, caseId, experiment, prepared } = input
  const points = experiment.points ?? 1
  const name = prepared.name

  if (prepared.unavailableReason || !prepared.plan || !input.output) {
    const reason =
      prepared.unavailableReason ??
      input.runError ??
      'The experiment run did not produce an output.'
    const verdict = prepared.unavailableReason ? 'unavailable' : 'error'
    return {
      graded: {
        id: caseId,
        ran: false,
        executionStatus: 'failed',
        error: reason,
        rubric: caseRubric(rubric, [
          executionRow(false, reason),
          verdictRow(name, points, false, null, reason)
        ])
      },
      result: { caseId, name, verdict, passed: false, summary: reason }
    }
  }

  const labels = new Map(input.topology.nodes.map((node) => [node.id, node.label ?? node.id]))
  const result = evaluateExperiment(prepared.plan, input.output, {
    nodeLabel: (id) => labels.get(id) ?? id
  })
  const passed = result.verdict === 'passed'
  const failing = result.violations
    .slice(0, 3)
    .map(
      (violation) =>
        `${describeAssertion(violation.assertion, (id) => labels.get(id) ?? id)}${
          violation.actual === null
            ? ' (no data)'
            : ` (measured ${formatMetricValue(violation.assertion.metric, violation.actual)})`
        }`
    )
  const detail = `${VERDICT_TEXT[result.verdict]}: ${result.summary}${
    failing.length > 0 ? ` Did not hold: ${failing.join('; ')}.` : ''
  }`
  return {
    graded: {
      id: caseId,
      ran: true,
      executionStatus: 'completed',
      rubric: caseRubric(rubric, [
        executionRow(true),
        verdictRow(name, points, passed, passed ? 1 : 0, detail),
        ...result.checks.map((check) => checkRow(name, check))
      ])
    },
    result: { caseId, name, verdict: result.verdict, passed, summary: result.summary, result }
  }
}

/** Swap experiment cases' graded results into a batch and recompute its score and summary. */
export function applyExperimentCaseGrades(
  rubric: Rubric,
  graded: GradedEvaluationBatch,
  replacements: ReadonlyMap<string, GradedCaseResult>
): GradedEvaluationBatch {
  if (replacements.size === 0) return graded
  const cases = graded.cases.map((entry) => replacements.get(entry.id) ?? entry)
  const { score, passed } = aggregateBatchScore(rubric, graded.question, cases)
  return { ...graded, cases, score, passed, summary: batchSummary(graded.question, cases) }
}
