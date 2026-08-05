import type { InvariantCheck } from '../core/types'
import type { InvariantViolation, SimulationOutput } from './output'
import { type CheckOp, resolveMetric } from './rubric'
import { projectToVerdict } from './verdict'

const CONDITION_PATTERN =
  /^([A-Za-z0-9_.-]+)\s*(<=|>=|==|!=|<|>)\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/

interface ParsedInvariantCondition {
  metric: string
  op: CheckOp
  value: number
}

function parseInvariantCondition(condition: string): ParsedInvariantCondition | null {
  const match = condition.trim().match(CONDITION_PATTERN)
  if (!match) {
    return null
  }

  const [, metric, op, rawValue] = match
  const value = Number(rawValue)
  if (!Number.isFinite(value)) {
    return null
  }

  return {
    metric,
    op: op as CheckOp,
    value
  }
}

function compare(actual: number, op: CheckOp, expected: number): boolean {
  switch (op) {
    case '<':
      return actual < expected
    case '<=':
      return actual <= expected
    case '>':
      return actual > expected
    case '>=':
      return actual >= expected
    case '==':
      return actual === expected
    case '!=':
      return actual !== expected
  }
}

function unsupportedConditionViolation(
  invariant: InvariantCheck,
  violatedAt: number,
  details: string
): InvariantViolation {
  return {
    invariantId: invariant.id,
    invariantName: invariant.description,
    violatedAt,
    details
  }
}

export function evaluateInvariantViolations(
  invariants: InvariantCheck[] | undefined,
  output: SimulationOutput
): InvariantViolation[] {
  if (!invariants || invariants.length === 0) {
    return []
  }

  const violatedAt = output.simulationDuration
  const verdict = projectToVerdict(output)

  return invariants.flatMap((invariant) => {
    const parsed = parseInvariantCondition(invariant.condition)
    if (!parsed) {
      return [
        unsupportedConditionViolation(
          invariant,
          violatedAt,
          `Unsupported invariant condition '${invariant.condition}'. Use '<metric> <op> <number>'.`
        )
      ]
    }

    if (parsed.metric.startsWith('invariantViolations.')) {
      return [
        unsupportedConditionViolation(
          invariant,
          violatedAt,
          `Invariant metric '${parsed.metric}' is self-referential and is not supported.`
        )
      ]
    }

    const actual = resolveMetric(verdict, parsed.metric)
    if (actual === null) {
      return [
        unsupportedConditionViolation(
          invariant,
          violatedAt,
          `Invariant metric '${parsed.metric}' could not be resolved to a finite number.`
        )
      ]
    }

    if (compare(actual, parsed.op, parsed.value)) {
      return []
    }

    return [
      unsupportedConditionViolation(
        invariant,
        violatedAt,
        `actual ${actual} does not satisfy ${parsed.metric} ${parsed.op} ${parsed.value}`
      )
    ]
  })
}
