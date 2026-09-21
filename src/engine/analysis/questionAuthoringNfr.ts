import type { NFRTarget } from './question'

export type AuthoringNfrMetric = NFRTarget['metric']
export type AuthoringNfrOperator = NFRTarget['operator']
export type AuthoringNfrUnit = NFRTarget['unit']

export interface AuthoringNfrCapability {
  metric: AuthoringNfrMetric
  label: string
  operators: readonly AuthoringNfrOperator[]
  units: readonly AuthoringNfrUnit[]
  defaultOperator: AuthoringNfrOperator
  defaultUnit: AuthoringNfrUnit
  defaultValue: number
}

const CAPABILITIES_BY_METRIC = {
  latency_p99: {
    metric: 'latency_p99',
    label: 'P99 latency',
    operators: ['<', '<='],
    units: ['ms'],
    defaultOperator: '<',
    defaultUnit: 'ms',
    defaultValue: 100
  },
  latency_p50: {
    metric: 'latency_p50',
    label: 'P50 latency',
    operators: ['<', '<='],
    units: ['ms'],
    defaultOperator: '<',
    defaultUnit: 'ms',
    defaultValue: 50
  },
  availability: {
    metric: 'availability',
    label: 'Availability',
    operators: ['>', '>='],
    units: ['percent', 'nines'],
    defaultOperator: '>=',
    defaultUnit: 'percent',
    defaultValue: 99.9
  },
  error_rate: {
    metric: 'error_rate',
    label: 'Error rate',
    operators: ['<', '<='],
    units: ['percent'],
    defaultOperator: '<',
    defaultUnit: 'percent',
    defaultValue: 1
  },
  throughput: {
    metric: 'throughput',
    label: 'Throughput',
    operators: ['>', '>='],
    units: ['req_per_sec'],
    defaultOperator: '>=',
    defaultUnit: 'req_per_sec',
    defaultValue: 1000
  }
} as const satisfies Record<AuthoringNfrMetric, AuthoringNfrCapability>

export const AUTHORING_NFR_CAPABILITIES: readonly AuthoringNfrCapability[] =
  Object.values(CAPABILITIES_BY_METRIC)

export const AUTHORING_NFR_OPERATORS = [
  '<',
  '<=',
  '>',
  '>='
] as const satisfies readonly AuthoringNfrOperator[]
export const AUTHORING_NFR_UNITS = [
  'ms',
  'percent',
  'req_per_sec',
  'nines'
] as const satisfies readonly AuthoringNfrUnit[]

export const AUTHORING_NFR_UNIT_LABELS: Readonly<Record<AuthoringNfrUnit, string>> = {
  ms: 'milliseconds (ms)',
  percent: 'percent (%)',
  req_per_sec: 'requests / second',
  nines: 'availability nines'
}

export interface AuthoringNonFunctionalRequirement {
  id: string
  metric: AuthoringNfrMetric
  operator: AuthoringNfrOperator
  value: number | null
  unit: AuthoringNfrUnit
}

export type NonFunctionalRequirementAction =
  | { type: 'add'; requirement: AuthoringNonFunctionalRequirement }
  | { type: 'update-metric'; id: string; metric: AuthoringNfrMetric }
  | { type: 'update-operator'; id: string; operator: AuthoringNfrOperator }
  | { type: 'update-value'; id: string; value: number | null }
  | { type: 'update-unit'; id: string; unit: AuthoringNfrUnit }
  | { type: 'remove'; id: string }

function createRequirementId(): string {
  const uniquePart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return `nfr-${uniquePart}`
}

export function getAuthoringNfrCapability(metric: AuthoringNfrMetric): AuthoringNfrCapability {
  return CAPABILITIES_BY_METRIC[metric]
}

export function isAuthoringNfrMetric(value: unknown): value is AuthoringNfrMetric {
  return typeof value === 'string' && value in CAPABILITIES_BY_METRIC
}

export function isAuthoringNfrOperator(value: unknown): value is AuthoringNfrOperator {
  return AUTHORING_NFR_OPERATORS.includes(value as AuthoringNfrOperator)
}

export function isAuthoringNfrUnit(value: unknown): value is AuthoringNfrUnit {
  return AUTHORING_NFR_UNITS.includes(value as AuthoringNfrUnit)
}

export function isValidAuthoringNfrCombination(
  requirement: Pick<AuthoringNonFunctionalRequirement, 'metric' | 'operator' | 'unit'>
): boolean {
  const capability = getAuthoringNfrCapability(requirement.metric)
  return (
    capability.operators.includes(requirement.operator) &&
    capability.units.includes(requirement.unit)
  )
}

export function createAuthoringNonFunctionalRequirement(
  metric: AuthoringNfrMetric = 'latency_p99',
  id = createRequirementId()
): AuthoringNonFunctionalRequirement {
  const capability = getAuthoringNfrCapability(metric)
  return {
    id,
    metric,
    operator: capability.defaultOperator,
    value: capability.defaultValue,
    unit: capability.defaultUnit
  }
}

function rounded(value: number, precision = 8): number {
  return Number(value.toFixed(precision))
}

/** Converts the human-facing availability value when its display unit changes. */
export function convertAvailabilityValue(
  value: number | null,
  from: AuthoringNfrUnit,
  to: AuthoringNfrUnit
): number | null {
  if (value === null || from === to) return value
  if (from === 'percent' && to === 'nines') {
    if (value < 0 || value >= 100) return null
    return rounded(-Math.log10(1 - value / 100))
  }
  if (from === 'nines' && to === 'percent') {
    if (value <= 0) return null
    return rounded((1 - 10 ** -value) * 100)
  }
  return null
}

export function authoringNfrValueError(
  requirement: AuthoringNonFunctionalRequirement
): string | null {
  const { metric, unit, value } = requirement
  if (value === null || !Number.isFinite(value)) return 'Enter a numeric target.'
  if (value < 0) return 'Target must be zero or greater.'
  if ((metric === 'availability' || metric === 'error_rate') && unit === 'percent' && value > 100) {
    return 'Percentage targets cannot exceed 100%.'
  }
  if (unit === 'nines' && value <= 0) return 'Availability nines must be greater than zero.'
  return null
}

function formatValue(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value)
}

function formatTarget(value: number, unit: AuthoringNfrUnit): string {
  const formatted = formatValue(value)
  if (unit === 'percent') return `${formatted}%`
  if (unit === 'ms') return `${formatted} ms`
  if (unit === 'req_per_sec') return `${formatted} req/s`
  return `${formatted} nines`
}

const OPERATOR_PHRASES: Readonly<Record<AuthoringNfrOperator, string>> = {
  '<': 'below',
  '<=': 'at most',
  '>': 'above',
  '>=': 'at least'
}

export function formatAuthoringNfrDescription(
  requirement: AuthoringNonFunctionalRequirement
): string | null {
  if (authoringNfrValueError(requirement)) return null
  const capability = getAuthoringNfrCapability(requirement.metric)
  return `${capability.label} must be ${OPERATOR_PHRASES[requirement.operator]} ${formatTarget(requirement.value!, requirement.unit)}.`
}

export function compileAuthoringNfr(
  requirement: AuthoringNonFunctionalRequirement
): NFRTarget | null {
  if (!isValidAuthoringNfrCombination(requirement)) return null
  const description = formatAuthoringNfrDescription(requirement)
  if (!description || requirement.value === null) return null
  return {
    metric: requirement.metric,
    operator: requirement.operator,
    value: requirement.value,
    unit: requirement.unit,
    description
  }
}

export function nonFunctionalRequirementReducer(
  requirements: readonly AuthoringNonFunctionalRequirement[],
  action: NonFunctionalRequirementAction
): AuthoringNonFunctionalRequirement[] {
  switch (action.type) {
    case 'add':
      return requirements.some((requirement) => requirement.id === action.requirement.id)
        ? [...requirements]
        : [...requirements, action.requirement]
    case 'update-metric':
      return requirements.map((requirement) => {
        if (requirement.id !== action.id) return requirement
        const capability = getAuthoringNfrCapability(action.metric)
        const unit = capability.units.includes(requirement.unit)
          ? requirement.unit
          : capability.defaultUnit
        return {
          ...requirement,
          metric: action.metric,
          operator: capability.operators.includes(requirement.operator)
            ? requirement.operator
            : capability.defaultOperator,
          unit,
          value: unit === requirement.unit ? requirement.value : capability.defaultValue
        }
      })
    case 'update-operator':
      return requirements.map((requirement) => {
        if (requirement.id !== action.id) return requirement
        const capability = getAuthoringNfrCapability(requirement.metric)
        return capability.operators.includes(action.operator)
          ? { ...requirement, operator: action.operator }
          : requirement
      })
    case 'update-value':
      return requirements.map((requirement) =>
        requirement.id === action.id ? { ...requirement, value: action.value } : requirement
      )
    case 'update-unit':
      return requirements.map((requirement) => {
        if (requirement.id !== action.id) return requirement
        const capability = getAuthoringNfrCapability(requirement.metric)
        if (!capability.units.includes(action.unit)) return requirement
        return {
          ...requirement,
          value: convertAvailabilityValue(requirement.value, requirement.unit, action.unit),
          unit: action.unit
        }
      })
    case 'remove':
      return requirements.filter((requirement) => requirement.id !== action.id)
  }
}
