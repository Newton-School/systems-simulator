import {
  getRubricMetricCapability,
  NFR_METRIC_TO_RUBRIC_METRIC,
  type RubricMetricCapability
} from './authoringCapabilities'
import {
  authoringNfrValueError,
  formatAuthoringNfrDescription,
  getAuthoringNfrCapability,
  type AuthoringNfrOperator,
  type AuthoringNfrUnit,
  type AuthoringNonFunctionalRequirement
} from './questionAuthoringNfr'
import type { RubricCheck } from './rubric'

export const AUTHORING_METRIC_RULE_METRICS = ['latency_p99', 'error_rate', 'throughput'] as const

export type AuthoringMetricRuleMetric = (typeof AUTHORING_METRIC_RULE_METRICS)[number]

export interface AuthoringMetricRuleDraft {
  id: string
  metric: AuthoringMetricRuleMetric
  operator: AuthoringNfrOperator
  value: number | null
  unit: AuthoringNfrUnit
}

export interface AuthoringMetricRuleCapability {
  metric: AuthoringMetricRuleMetric
  label: string
  metricSelector: string
  rubricCapability: RubricMetricCapability
  operators: readonly AuthoringNfrOperator[]
  defaultOperator: AuthoringNfrOperator
  unit: AuthoringNfrUnit
  defaultValue: number
}

export type AuthoringMetricRuleAction =
  | { type: 'add'; rule: AuthoringMetricRuleDraft }
  | { type: 'update-metric'; id: string; metric: AuthoringMetricRuleMetric }
  | { type: 'update-operator'; id: string; operator: AuthoringNfrOperator }
  | { type: 'update-value'; id: string; value: number | null }
  | { type: 'remove'; id: string }

export const AUTHORING_METRIC_RULE_OPERATOR_LABELS: Readonly<Record<AuthoringNfrOperator, string>> =
  {
    '<': 'must be below',
    '<=': 'must be at most',
    '>': 'must be above',
    '>=': 'must be at least'
  }

function buildCapability(metric: AuthoringMetricRuleMetric): AuthoringMetricRuleCapability {
  const nfrCapability = getAuthoringNfrCapability(metric)
  const metricSelector = NFR_METRIC_TO_RUBRIC_METRIC[metric]
  const rubricCapability = getRubricMetricCapability(metricSelector)
  const unit = nfrCapability.units[0]

  if (!metricSelector || !rubricCapability || !unit) {
    throw new Error(`Missing authoring capability for metric rule "${metric}"`)
  }

  return {
    metric,
    label: nfrCapability.label,
    metricSelector,
    rubricCapability,
    operators: nfrCapability.operators,
    defaultOperator: nfrCapability.defaultOperator,
    unit,
    defaultValue: nfrCapability.defaultValue
  }
}

export const AUTHORING_METRIC_RULE_CAPABILITIES: readonly AuthoringMetricRuleCapability[] =
  AUTHORING_METRIC_RULE_METRICS.map(buildCapability)

const CAPABILITY_BY_METRIC = Object.fromEntries(
  AUTHORING_METRIC_RULE_CAPABILITIES.map((capability) => [capability.metric, capability])
) as Record<AuthoringMetricRuleMetric, AuthoringMetricRuleCapability>

export function getAuthoringMetricRuleCapability(
  metric: AuthoringMetricRuleMetric
): AuthoringMetricRuleCapability {
  return CAPABILITY_BY_METRIC[metric]
}

export function isAuthoringMetricRuleMetric(value: unknown): value is AuthoringMetricRuleMetric {
  return (
    typeof value === 'string' &&
    AUTHORING_METRIC_RULE_METRICS.includes(value as AuthoringMetricRuleMetric)
  )
}

export function isValidAuthoringMetricRuleCombination(
  rule: Pick<AuthoringMetricRuleDraft, 'metric' | 'operator' | 'unit'>
): boolean {
  const capability = getAuthoringMetricRuleCapability(rule.metric)
  return capability.operators.includes(rule.operator) && capability.unit === rule.unit
}

export function createAuthoringMetricRule(
  metric: AuthoringMetricRuleMetric = 'latency_p99',
  id = 'metric-target'
): AuthoringMetricRuleDraft {
  const capability = getAuthoringMetricRuleCapability(metric)
  return {
    id,
    metric,
    operator: capability.defaultOperator,
    value: capability.defaultValue,
    unit: capability.unit
  }
}

function asNfr(rule: AuthoringMetricRuleDraft): AuthoringNonFunctionalRequirement {
  return { ...rule }
}

export function authoringMetricRuleValueError(rule: AuthoringMetricRuleDraft): string | null {
  return authoringNfrValueError(asNfr(rule))
}

function normalizeRubricValue(rule: AuthoringMetricRuleDraft): number | null {
  if (rule.value === null) return null
  return rule.metric === 'error_rate' && rule.unit === 'percent' ? rule.value / 100 : rule.value
}

export function compileAuthoringMetricRule(rule: AuthoringMetricRuleDraft): RubricCheck | null {
  if (!rule.id.trim() || !isValidAuthoringMetricRuleCombination(rule)) return null
  const description = formatAuthoringNfrDescription(asNfr(rule))
  const value = normalizeRubricValue(rule)
  if (!description || value === null || !Number.isFinite(value)) return null

  const capability = getAuthoringMetricRuleCapability(rule.metric)
  return {
    id: rule.id,
    description,
    kind: capability.rubricCapability.kind,
    metric: capability.metricSelector,
    op: rule.operator,
    value
  }
}

export function authoringMetricRuleReducer(
  rules: readonly AuthoringMetricRuleDraft[],
  action: AuthoringMetricRuleAction
): AuthoringMetricRuleDraft[] {
  switch (action.type) {
    case 'add':
      return rules.some((rule) => rule.id === action.rule.id) ? [...rules] : [...rules, action.rule]
    case 'update-metric':
      return rules.map((rule) => {
        if (rule.id !== action.id) return rule
        const capability = getAuthoringMetricRuleCapability(action.metric)
        return {
          ...rule,
          metric: action.metric,
          operator: capability.defaultOperator,
          value: capability.defaultValue,
          unit: capability.unit
        }
      })
    case 'update-operator':
      return rules.map((rule) => {
        if (rule.id !== action.id) return rule
        const capability = getAuthoringMetricRuleCapability(rule.metric)
        return capability.operators.includes(action.operator)
          ? { ...rule, operator: action.operator }
          : rule
      })
    case 'update-value':
      return rules.map((rule) => (rule.id === action.id ? { ...rule, value: action.value } : rule))
    case 'remove':
      return rules.filter((rule) => rule.id !== action.id)
  }
}
