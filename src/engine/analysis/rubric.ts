import type { TopologyJSON } from '../core/types'
import { deriveNodeConcurrency } from '../nodes/resourceDerivation'
import type { EvaluationBatch } from './evaluate'
import type { SimulationVerdict } from './verdict'

export const RUBRIC_VERSION = '1.0' as const
export const EXECUTION_CHECK_ID = '__execution__' as const
export const EXECUTION_CHECK_DESCRIPTION = 'Case execution completed'
export const EXECUTION_FAILURE_DETAIL = 'Execution failed before a verdict was produced.'
export const EXECUTION_SKIPPED_DETAIL = 'Execution was skipped before simulation could run.'
export const CASE_CHECK_SKIPPED_DETAIL =
  'Check was not evaluated because execution did not complete.'
export const TOPOLOGY_CONTEXT_REQUIRED_DETAIL =
  'Topology checks require a question-topology grading context.'

export type CheckOp = '<' | '<=' | '>' | '>=' | '==' | '!='
export type RubricCheckKind = 'topology' | 'simulation' | 'invariant'
export type CheckResultKind = RubricCheckKind | 'execution'
export type CheckStatus = 'passed' | 'failed' | 'skipped'
export type CaseExecutionStatus = 'completed' | 'failed' | 'skipped'

/**
 * One authored grading criterion. Existing question packages may omit `kind`,
 * in which case grading infers it from the metric selector for backwards
 * compatibility (`topology.*` => topology, invariant-derived selectors =>
 * invariant, everything else => simulation).
 */
export interface RubricCheck {
  id: string
  description: string
  kind?: RubricCheckKind
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

export interface ScoreSummary {
  earned: number
  possible: number
  fraction: number
}

export interface CheckResult {
  id: string
  description: string
  kind: CheckResultKind
  metric?: string
  op?: CheckOp
  value?: number
  actual: number | null
  status: CheckStatus
  passed: boolean
  points: number
  awarded: number
  detail?: string
}

export interface RubricResult {
  version: typeof RUBRIC_VERSION
  rubricId?: string
  checks: CheckResult[]
  score: ScoreSummary
  passed: boolean
}

export interface GradedCaseResult {
  id: string
  ran: boolean
  executionStatus: CaseExecutionStatus
  error?: string
  rubric?: RubricResult
}

export interface GradedEvaluationBatch {
  version: typeof RUBRIC_VERSION
  suite?: string
  rubricId?: string
  question?: RubricResult
  cases: GradedCaseResult[]
  score: ScoreSummary
  passed: boolean
  summary: {
    total: number
    ran: number
    errored: number
    passed: number
    failed: number
    totalChecks: number
    passedChecks: number
    failedChecks: number
    skippedChecks: number
  }
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

function isFiniteMetricValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isInvariantMetric(metric: string): boolean {
  return (
    metric.startsWith('invariantViolations.') ||
    metric.startsWith('conservation.') ||
    metric.startsWith('littlesLaw.')
  )
}

export function inferRubricCheckKind(check: Pick<RubricCheck, 'kind' | 'metric'>): RubricCheckKind {
  if (check.kind) {
    return check.kind
  }

  if (check.metric.startsWith('topology.')) {
    return 'topology'
  }

  if (isInvariantMetric(check.metric)) {
    return 'invariant'
  }

  return 'simulation'
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
  return isFiniteMetricValue(value) ? value : null
}

export function resolveTopologyMetric(topology: TopologyJSON, metric: string): number | null {
  switch (metric) {
    case 'topology.nodeCount':
      return topology.nodes.length
    case 'topology.edgeCount':
      return topology.edges.length
    case 'topology.sourceCount':
      return topology.nodes.filter((node) => node.role === 'source').length
    case 'topology.totalWorkers':
      // Derived effective concurrency (instance × workload), not the vestigial queue.
      return topology.nodes.reduce(
        (sum, node) => sum + (node.queue ? deriveNodeConcurrency(node).effectiveC : 0),
        0
      )
    case 'topology.totalReplicas':
      return topology.nodes.reduce(
        (sum, node) => sum + (node.resources?.instanceCount ?? node.resources?.replicas ?? 0),
        0
      )
  }

  if (metric.startsWith('topology.componentCounts.')) {
    const componentType = metric.slice('topology.componentCounts.'.length)
    return topology.nodes.filter((node) => node.type === componentType).length
  }

  if (metric.startsWith('topology.categoryCounts.')) {
    const category = metric.slice('topology.categoryCounts.'.length)
    return topology.nodes.filter((node) => node.category === category).length
  }

  const value = getByPath(topology, metric.slice('topology.'.length))
  return isFiniteMetricValue(value) ? value : null
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

function scoreChecks(checks: readonly CheckResult[]): ScoreSummary {
  const possible = checks.reduce((sum, check) => sum + check.points, 0)
  const earned = checks.reduce((sum, check) => sum + check.awarded, 0)
  return {
    earned,
    possible,
    fraction: possible > 0 ? earned / possible : 1
  }
}

function buildRubricResult(
  rubric: Rubric,
  checks: CheckResult[],
  score?: ScoreSummary
): RubricResult {
  const finalScore = score ?? scoreChecks(checks)
  const threshold = rubric.passThreshold ?? 1
  return {
    version: RUBRIC_VERSION,
    ...(rubric.id ? { rubricId: rubric.id } : {}),
    checks,
    score: finalScore,
    passed: finalScore.fraction >= threshold
  }
}

function metricLabel(kind: RubricCheckKind): string {
  switch (kind) {
    case 'topology':
      return 'Topology'
    case 'invariant':
      return 'Invariant'
    case 'simulation':
      return 'Simulation'
  }
}

function unresolvedMetricDetail(kind: RubricCheckKind, metric: string): string {
  return `${metricLabel(kind)} metric '${metric}' could not be resolved to a finite number.`
}

function invalidInvariantMetricDetail(metric: string): string {
  return `Invariant check metric '${metric}' must target invariant-derived selectors.`
}

function failedMetricDetail(actual: number, metric: string, op: CheckOp, value: number): string {
  return `actual ${actual} does not satisfy ${metric} ${op} ${value}`
}

function normalizeExecutionDetail(
  status: Exclude<CaseExecutionStatus, 'completed'>,
  detail?: string
): string {
  if (detail) {
    return detail
  }

  return status === 'skipped' ? EXECUTION_SKIPPED_DETAIL : EXECUTION_FAILURE_DETAIL
}

function metricCheckResult(
  check: RubricCheck,
  kind: RubricCheckKind,
  actual: number | null,
  detail?: string
): CheckResult {
  const points = check.points ?? 1
  const passed = actual !== null && detail === undefined && compare(actual, check.op, check.value)
  return {
    id: check.id,
    description: check.description,
    kind,
    metric: check.metric,
    op: check.op,
    value: check.value,
    actual,
    status: passed ? 'passed' : 'failed',
    passed,
    points,
    awarded: passed ? points : 0,
    ...(detail
      ? { detail }
      : !passed && actual !== null
        ? { detail: failedMetricDetail(actual, check.metric, check.op, check.value) }
        : {})
  }
}

function skippedMetricCheck(check: RubricCheck, detail: string): CheckResult {
  const kind = inferRubricCheckKind(check)
  return {
    id: check.id,
    description: check.description,
    kind,
    metric: check.metric,
    op: check.op,
    value: check.value,
    actual: null,
    status: 'skipped',
    passed: false,
    points: check.points ?? 1,
    awarded: 0,
    detail
  }
}

function executionCheck(status: CaseExecutionStatus, detail?: string): CheckResult {
  return {
    id: EXECUTION_CHECK_ID,
    description: EXECUTION_CHECK_DESCRIPTION,
    kind: 'execution',
    actual: null,
    status: status === 'completed' ? 'passed' : status,
    passed: status === 'completed',
    points: 0,
    awarded: 0,
    ...(status === 'completed' ? {} : { detail: normalizeExecutionDetail(status, detail) })
  }
}

function topologyChecksForQuestion(rubric: Rubric): RubricCheck[] {
  return rubric.checks.filter((check) => inferRubricCheckKind(check) === 'topology')
}

function caseChecksForQuestion(rubric: Rubric): RubricCheck[] {
  return rubric.checks.filter((check) => inferRubricCheckKind(check) !== 'topology')
}

function gradeQuestionChecksWithoutTopologyContext(rubric: Rubric): RubricResult | undefined {
  const checks = topologyChecksForQuestion(rubric)
  if (checks.length === 0) {
    return undefined
  }

  return buildRubricResult(
    rubric,
    checks.map((check) =>
      metricCheckResult(check, 'topology', null, TOPOLOGY_CONTEXT_REQUIRED_DETAIL)
    )
  )
}

function gradeQuestionChecksWithTopology(
  rubric: Rubric,
  topology: TopologyJSON
): RubricResult | undefined {
  const checks = topologyChecksForQuestion(rubric)
  if (checks.length === 0) {
    return undefined
  }

  return buildRubricResult(
    rubric,
    checks.map((check) =>
      metricCheckResult(check, 'topology', resolveTopologyMetric(topology, check.metric), undefined)
    )
  )
}

function gradeVerdictCheck(check: RubricCheck, verdict: SimulationVerdict): CheckResult {
  const kind = inferRubricCheckKind(check)
  if (kind === 'topology') {
    return metricCheckResult(check, 'topology', null, TOPOLOGY_CONTEXT_REQUIRED_DETAIL)
  }

  if (kind === 'invariant' && !isInvariantMetric(check.metric)) {
    return metricCheckResult(check, 'invariant', null, invalidInvariantMetricDetail(check.metric))
  }

  const actual = resolveMetric(verdict, check.metric)
  if (actual === null) {
    return metricCheckResult(check, kind, null, unresolvedMetricDetail(kind, check.metric))
  }

  return metricCheckResult(check, kind, actual)
}

function completedCaseRubric(rubric: Rubric, verdict: SimulationVerdict): RubricResult {
  const checks = [
    executionCheck('completed'),
    ...caseChecksForQuestion(rubric).map((check) => gradeVerdictCheck(check, verdict))
  ]
  return buildRubricResult(rubric, checks)
}

function incompleteCaseRubric(
  rubric: Rubric,
  status: Exclude<CaseExecutionStatus, 'completed'>,
  detail?: string
): RubricResult {
  const skippedDetail =
    status === 'skipped'
      ? 'Check was skipped because simulation never started.'
      : CASE_CHECK_SKIPPED_DETAIL
  const checks = [
    executionCheck(status, detail),
    ...caseChecksForQuestion(rubric).map((check) => skippedMetricCheck(check, skippedDetail))
  ]
  return buildRubricResult(rubric, checks)
}

function aggregateBatchScore(
  rubric: Rubric,
  question: RubricResult | undefined,
  cases: readonly GradedCaseResult[]
): { score: ScoreSummary; passed: boolean } {
  const possible =
    (question?.score.possible ?? 0) +
    cases.reduce((sum, entry) => sum + (entry.rubric?.score.possible ?? 0), 0)
  const earned =
    (question?.score.earned ?? 0) +
    cases.reduce((sum, entry) => sum + (entry.rubric?.score.earned ?? 0), 0)
  const score = {
    earned,
    possible,
    fraction: possible > 0 ? earned / possible : 1
  }

  return {
    score,
    passed: score.fraction >= (rubric.passThreshold ?? 1)
  }
}

function batchSummary(question: RubricResult | undefined, cases: readonly GradedCaseResult[]) {
  const ran = cases.filter((entry) => entry.ran).length
  const passed = cases.filter((entry) => entry.rubric?.passed).length
  const allChecks = [
    ...(question?.checks ?? []),
    ...cases.flatMap((entry) => entry.rubric?.checks ?? [])
  ]
  const passedChecks = allChecks.filter((check) => check.status === 'passed').length
  const failedChecks = allChecks.filter((check) => check.status === 'failed').length
  const skippedChecks = allChecks.filter((check) => check.status === 'skipped').length

  return {
    total: cases.length,
    ran,
    errored: cases.length - ran,
    passed,
    failed: cases.length - passed,
    totalChecks: allChecks.length,
    passedChecks,
    failedChecks,
    skippedChecks
  }
}

function gradeCases(
  rubric: Rubric,
  batch: EvaluationBatch,
  options?: {
    unresolvedCaseStatus?: Exclude<CaseExecutionStatus, 'completed'>
    unresolvedCaseDetail?: string
  }
): GradedCaseResult[] {
  const unresolvedCaseStatus = options?.unresolvedCaseStatus ?? 'failed'

  return batch.results.map((result) => {
    if ('verdict' in result) {
      return {
        id: result.id,
        ran: true,
        executionStatus: 'completed',
        rubric: completedCaseRubric(rubric, result.verdict)
      }
    }

    const detail = normalizeExecutionDetail(unresolvedCaseStatus, options?.unresolvedCaseDetail)
    return {
      id: result.id,
      ran: false,
      executionStatus: unresolvedCaseStatus,
      error: detail,
      rubric: incompleteCaseRubric(rubric, unresolvedCaseStatus, options?.unresolvedCaseDetail)
    }
  })
}

/** Grades a single verdict against a rubric, producing per-check rows and a score. */
export function gradeVerdict(rubric: Rubric, verdict: SimulationVerdict): RubricResult {
  return buildRubricResult(
    rubric,
    rubric.checks.map((check) => gradeVerdictCheck(check, verdict))
  )
}

/**
 * Applies one rubric across every case in an EvaluationBatch. Cases that failed
 * to run are carried through as deterministic execution failures instead of
 * leaking engine-specific error text into grading output.
 */
export function gradeBatch(rubric: Rubric, batch: EvaluationBatch): GradedEvaluationBatch {
  const question = gradeQuestionChecksWithoutTopologyContext(rubric)
  const cases = gradeCases(rubric, batch)
  const { score, passed } = aggregateBatchScore(rubric, question, cases)

  return {
    version: RUBRIC_VERSION,
    ...(batch.suite ? { suite: batch.suite } : {}),
    ...(rubric.id ? { rubricId: rubric.id } : {}),
    ...(question ? { question } : {}),
    cases,
    score,
    passed,
    summary: batchSummary(question, cases)
  }
}

export function gradeQuestionBatch(
  rubric: Rubric,
  topology: TopologyJSON,
  batch: EvaluationBatch,
  options?: {
    unresolvedCaseStatus?: Exclude<CaseExecutionStatus, 'completed'>
    unresolvedCaseDetail?: string
  }
): GradedEvaluationBatch {
  const question = gradeQuestionChecksWithTopology(rubric, topology)
  const cases = gradeCases(rubric, batch, options)
  const { score, passed } = aggregateBatchScore(rubric, question, cases)

  return {
    version: RUBRIC_VERSION,
    ...(batch.suite ? { suite: batch.suite } : {}),
    ...(rubric.id ? { rubricId: rubric.id } : {}),
    ...(question ? { question } : {}),
    cases,
    score,
    passed,
    summary: batchSummary(question, cases)
  }
}
