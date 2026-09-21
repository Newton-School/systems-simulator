import {
  getRubricMetricCapability,
  RUBRIC_METRIC_CAPABILITIES,
  type RubricMetricCapability
} from './authoringCapabilities'
import type { CheckOp, RubricCheck } from './rubric'

/**
 * The general `RUBRIC_CHECK` composer: any verdict metric in the engine-owned
 * registry (latency percentiles, throughput/volume, errors, per-node worst-case,
 * capability counters, and the invariant family) asserted as `metric op value`.
 * The friendly latency/error/throughput NFR editor stays for the common case; this
 * covers the rest of catalog §3.
 */
export interface AuthoringRubricCheckDraft {
  id: string
  metric: string
  op: CheckOp
  value: number | null
  points: number | null
}

export type AuthoringRubricCheckAction =
  | { type: 'add'; check: AuthoringRubricCheckDraft }
  | { type: 'update-metric'; id: string; metric: string }
  | { type: 'update-op'; id: string; op: CheckOp }
  | { type: 'update-value'; id: string; value: number | null }
  | { type: 'update-points'; id: string; points: number | null }
  | { type: 'remove'; id: string }

export const AUTHORING_RUBRIC_METRIC_CAPABILITIES: readonly RubricMetricCapability[] =
  RUBRIC_METRIC_CAPABILITIES

/** Metrics grouped by their rubric kind, for an optgroup-style selector. */
export const AUTHORING_RUBRIC_METRIC_GROUPS: ReadonlyArray<{
  kind: RubricMetricCapability['kind']
  label: string
  metrics: readonly RubricMetricCapability[]
}> = [
  {
    kind: 'simulation',
    label: 'Simulation metrics',
    metrics: RUBRIC_METRIC_CAPABILITIES.filter((capability) => capability.kind === 'simulation')
  },
  {
    kind: 'invariant',
    label: 'Invariant metrics',
    metrics: RUBRIC_METRIC_CAPABILITIES.filter((capability) => capability.kind === 'invariant')
  }
]

export function isAuthoringRubricMetric(value: unknown): value is string {
  return typeof value === 'string' && getRubricMetricCapability(value) !== undefined
}

const DEFAULT_METRIC = 'perNode.maxUtilization'

export function createAuthoringRubricCheck(
  metric: string = DEFAULT_METRIC,
  id = 'rubric-check'
): AuthoringRubricCheckDraft {
  const capability = getRubricMetricCapability(metric)
  return {
    id,
    metric,
    op: capability?.operators[0] ?? '<',
    value: 0,
    points: 1
  }
}

export function compileAuthoringRubricCheck(draft: AuthoringRubricCheckDraft): RubricCheck | null {
  const id = draft.id.trim()
  if (!id) return null
  const capability = getRubricMetricCapability(draft.metric)
  if (!capability || !capability.operators.includes(draft.op)) return null
  if (draft.value === null || !Number.isFinite(draft.value)) return null
  const points = draft.points
  if (points === null || !Number.isFinite(points) || points < 0) return null

  return {
    id,
    description: `${capability.label} ${draft.op} ${draft.value}.`,
    kind: capability.kind,
    metric: capability.id,
    op: draft.op,
    value: draft.value,
    points
  }
}

export function authoringRubricCheckReducer(
  checks: readonly AuthoringRubricCheckDraft[],
  action: AuthoringRubricCheckAction
): AuthoringRubricCheckDraft[] {
  switch (action.type) {
    case 'add':
      return checks.some((check) => check.id === action.check.id)
        ? [...checks]
        : [...checks, action.check]
    case 'update-metric':
      return checks.map((check) => {
        if (check.id !== action.id) return check
        const capability = getRubricMetricCapability(action.metric)
        const op =
          capability && capability.operators.includes(check.op)
            ? check.op
            : (capability?.operators[0] ?? check.op)
        return { ...check, metric: action.metric, op }
      })
    case 'update-op':
      return checks.map((check) => (check.id === action.id ? { ...check, op: action.op } : check))
    case 'update-value':
      return checks.map((check) =>
        check.id === action.id ? { ...check, value: action.value } : check
      )
    case 'update-points':
      return checks.map((check) =>
        check.id === action.id ? { ...check, points: action.points } : check
      )
    case 'remove':
      return checks.filter((check) => check.id !== action.id)
  }
}
