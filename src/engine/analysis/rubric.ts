import type { EvaluationBatch } from './evaluate'
import type { SimulationVerdict } from './verdict'

export const RUBRIC_VERSION = '1.0' as const

export type CheckOp = '<' | '<=' | '>' | '>=' | '==' | '!='

/**
 * One authored grading criterion. `metric` selects a numeric value out of a
 * SimulationVerdict (see resolveMetric for the supported selectors), which is
 * then compared against `value` with `op`. A check is worth `points` (default 1)
 * toward the overall score.
 */
export interface RubricCheck {
  id: string
  description: string
  metric: string
  op: CheckOp
  value: number
  points?: number
}

export interface Rubric {
  version?: string
  id?: string
  /** Fraction of points (0..1) required for the whole rubric to pass. Default 1 (every point). */
  passThreshold?: number
  checks: RubricCheck[]
}

export interface CheckResult {
  id: string
  description: string
  metric: string
  op: CheckOp
  value: number
  actual: number | null
  passed: boolean
  points: number
  awarded: number
  detail?: string
}

export interface RubricResult {
  version: typeof RUBRIC_VERSION
  rubricId?: string
  checks: CheckResult[]
  score: { earned: number; possible: number; fraction: number }
  passed: boolean
}

function maxOverNodes(
  verdict: SimulationVerdict,
  pick: (node: SimulationVerdict['perNode'][string]) => number
): number | null {
  const nodes = Object.values(verdict.perNode)
  if (nodes.length === 0) return null
  return nodes.reduce((max, node) => Math.max(max, pick(node)), Number.NEGATIVE_INFINITY)
}

function getByPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object') {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, root)
}

/**
 * Resolves a rubric metric selector to a finite number, or null when it can't be
 * measured (unknown path, or a latency percentile that is null because there were
 * no successful samples). Null never silently passes a check — it fails with a
 * detail note, so grading is honest about missing data.
 *
 * Supported: derived aggregates (e.g. `sloBreaches.count`, `perNode.maxUtilization`)
 * and dotted paths into the verdict (e.g. `summary.errorRate`,
 * `summary.latency.p99`, `perNode.<nodeId>.utilization`).
 */
export function resolveMetric(verdict: SimulationVerdict, metric: string): number | null {
  switch (metric) {
    case 'sloBreaches.count':
      return verdict.sloBreaches.length
    case 'invariantViolations.count':
      return verdict.invariantViolations.length
    case 'conservation.unbalanced':
      return verdict.conservation.filter((entry) => !entry.balanced).length
    case 'littlesLaw.violations':
      return verdict.littlesLaw.filter((entry) => !entry.withinTolerance).length
    case 'perNode.maxUtilization':
      return maxOverNodes(verdict, (node) => node.utilization)
    case 'perNode.maxErrorRate':
      return maxOverNodes(verdict, (node) => node.errorRate)
    case 'perNode.maxLatencyP99':
      return maxOverNodes(verdict, (node) => node.latencyP99)
  }

  const value = getByPath(verdict, metric)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function compare(actual: number, op: CheckOp, value: number): boolean {
  switch (op) {
    case '<':
      return actual < value
    case '<=':
      return actual <= value
    case '>':
      return actual > value
    case '>=':
      return actual >= value
    case '==':
      return actual === value
    case '!=':
      return actual !== value
  }
}

/** Grades a single verdict against a rubric, producing per-check rows and a score. */
export function gradeVerdict(rubric: Rubric, verdict: SimulationVerdict): RubricResult {
  const checks: CheckResult[] = rubric.checks.map((check) => {
    const points = check.points ?? 1
    const actual = resolveMetric(verdict, check.metric)
    const passed = actual !== null && compare(actual, check.op, check.value)
    return {
      id: check.id,
      description: check.description,
      metric: check.metric,
      op: check.op,
      value: check.value,
      actual,
      passed,
      points,
      awarded: passed ? points : 0,
      ...(actual === null
        ? { detail: 'metric could not be resolved to a finite number' }
        : {})
    }
  })

  const possible = checks.reduce((sum, check) => sum + check.points, 0)
  const earned = checks.reduce((sum, check) => sum + check.awarded, 0)
  const fraction = possible > 0 ? earned / possible : 1
  const threshold = rubric.passThreshold ?? 1

  return {
    version: RUBRIC_VERSION,
    ...(rubric.id ? { rubricId: rubric.id } : {}),
    checks,
    score: { earned, possible, fraction },
    passed: fraction >= threshold
  }
}

export interface GradedCaseResult {
  id: string
  ran: boolean
  error?: string
  rubric?: RubricResult
}

export interface GradedEvaluationBatch {
  version: typeof RUBRIC_VERSION
  suite?: string
  rubricId?: string
  cases: GradedCaseResult[]
  summary: {
    total: number
    ran: number
    errored: number
    passed: number
    failed: number
  }
}

/**
 * Applies one rubric across every case in an EvaluationBatch. Cases that failed
 * to run are carried through as errors (not graded); cases that ran are graded
 * and counted as passed/failed by their rubric outcome.
 */
export function gradeBatch(rubric: Rubric, batch: EvaluationBatch): GradedEvaluationBatch {
  const cases: GradedCaseResult[] = batch.results.map((result) => {
    if ('verdict' in result) {
      return { id: result.id, ran: true, rubric: gradeVerdict(rubric, result.verdict) }
    }
    return { id: result.id, ran: false, error: result.error }
  })

  const ran = cases.filter((entry) => entry.ran).length
  const passed = cases.filter((entry) => entry.rubric?.passed).length
  return {
    version: RUBRIC_VERSION,
    ...(batch.suite ? { suite: batch.suite } : {}),
    ...(rubric.id ? { rubricId: rubric.id } : {}),
    cases,
    summary: {
      total: cases.length,
      ran,
      errored: cases.length - ran,
      passed,
      failed: cases.length - passed
    }
  }
}
