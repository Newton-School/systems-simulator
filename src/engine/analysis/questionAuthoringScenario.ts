import type {
  FaultSpec,
  InvariantCheck,
  TrafficOrigin,
  WorkloadProfile,
  WorkloadStopCondition
} from '../core/types'
import { FaultSpecSchema, GlobalConfigSchema, WorkloadProfileSchema } from '../validation/validator'
import type { QuestionSuiteCase } from './question'

export type AuthoringWorkloadPattern = WorkloadProfile['pattern']

export interface AuthoringFaultDraft {
  id: string
  targetId: string
  faultType: string
  timing: FaultSpec['timing']
  mode: string
  atSeconds: number | null
  duration: FaultSpec['duration']
  durationSeconds: number | null
  extraParams: AuthoringValueDraft[]
}

export interface AuthoringValueDraft {
  id: string
  key: string
  valueType: 'string' | 'number' | 'boolean' | 'json'
  value: string
}

export interface AuthoringScenarioDraft {
  id: string
  description: string
  seed: string
  pattern: AuthoringWorkloadPattern
  durationSeconds: number | null
  warmupSeconds: number | null
  timeResolution?: 'microsecond' | 'millisecond'
  defaultTimeoutMs?: number | null
  traceSampleRatePercent?: number | null
  baseRps: number | null
  readPercent: number | null
  requestSizeBytes: number | null
  sourceNodeId?: string
  requestDistribution?: WorkloadProfile['requestDistribution']
  origins?: TrafficOrigin[]
  stopCondition?: WorkloadStopCondition
  burstRps?: number | null
  burstDurationSeconds?: number | null
  normalDurationSeconds?: number | null
  spikeTimeSeconds?: number | null
  spikeRps?: number | null
  spikeDurationSeconds?: number | null
  sawtoothPeakRps?: number | null
  rampDurationSeconds?: number | null
  diurnalPeakMultiplier?: number | null
  keyspaceField?: string
  keyspaceSize?: number | null
  keyspaceSkew?: number | null
  faults?: AuthoringFaultDraft[]
  invariants?: InvariantCheck[]
}

type AuthoringScenarioTextField = 'description' | 'seed'
type AuthoringScenarioNumberField =
  | 'durationSeconds'
  | 'warmupSeconds'
  | 'baseRps'
  | 'readPercent'
  | 'requestSizeBytes'

export type AuthoringScenarioAction =
  | { type: 'add'; scenario: AuthoringScenarioDraft }
  | { type: 'update'; id: string; changes: Partial<AuthoringScenarioDraft> }
  | { type: 'update-text'; id: string; field: AuthoringScenarioTextField; value: string }
  | { type: 'update-number'; id: string; field: AuthoringScenarioNumberField; value: number | null }
  | { type: 'remove'; id: string }

export type AuthoringScenarioFieldErrors = Partial<
  Record<AuthoringScenarioTextField | AuthoringScenarioNumberField | 'pattern' | 'keyspace', string>
>

export function createAuthoringFault(id = `fault-${Date.now()}`): AuthoringFaultDraft {
  return {
    id,
    targetId: '',
    faultType: 'crash',
    timing: 'deterministic',
    mode: 'reject',
    atSeconds: 10,
    duration: 'fixed',
    durationSeconds: 10,
    extraParams: []
  }
}

export function createAuthoringScenario(id = 'baseline'): AuthoringScenarioDraft {
  return {
    id,
    description: 'Sustain steady traffic under normal conditions.',
    seed: 'baseline-v1',
    pattern: 'constant',
    durationSeconds: 60,
    warmupSeconds: 5,
    baseRps: 1000,
    readPercent: 80,
    requestSizeBytes: 512,
    sourceNodeId: '',
    burstRps: 2500,
    burstDurationSeconds: 10,
    normalDurationSeconds: 20,
    spikeTimeSeconds: 20,
    spikeRps: 5000,
    spikeDurationSeconds: 10,
    sawtoothPeakRps: 3000,
    rampDurationSeconds: 20,
    diurnalPeakMultiplier: 2,
    keyspaceField: '',
    keyspaceSize: null,
    keyspaceSkew: null,
    faults: [],
    invariants: []
  }
}

export function decompileAuthoringScenario(
  testCase: QuestionSuiteCase,
  index = 0
): AuthoringScenarioDraft {
  const defaults = createAuthoringScenario(testCase.id || `scenario-${index + 1}`)
  const workload = testCase.workload
  const read = workload?.requestDistribution?.find((entry) => entry.type.toLowerCase() === 'read')
  const firstRequest = workload?.requestDistribution?.[0]
  const keyspace = firstRequest?.keyspace
  return {
    ...defaults,
    id: testCase.id,
    description: testCase.description ?? defaults.description,
    seed: testCase.global?.seed ?? defaults.seed,
    pattern: workload?.pattern ?? defaults.pattern,
    durationSeconds:
      testCase.global?.simulationDuration !== undefined
        ? testCase.global.simulationDuration / 1000
        : defaults.durationSeconds,
    warmupSeconds:
      testCase.global?.warmupDuration !== undefined
        ? testCase.global.warmupDuration / 1000
        : defaults.warmupSeconds,
    timeResolution: testCase.global?.timeResolution ?? defaults.timeResolution,
    defaultTimeoutMs: testCase.global?.defaultTimeout ?? defaults.defaultTimeoutMs,
    traceSampleRatePercent:
      testCase.global?.traceSampleRate !== undefined
        ? testCase.global.traceSampleRate * 100
        : defaults.traceSampleRatePercent,
    baseRps: workload?.baseRps ?? defaults.baseRps,
    readPercent: read ? read.weight * 100 : defaults.readPercent,
    requestSizeBytes: firstRequest?.sizeBytes ?? defaults.requestSizeBytes,
    sourceNodeId: workload?.sourceNodeId ?? '',
    requestDistribution: workload?.requestDistribution
      ? workload.requestDistribution.map((entry) => structuredClone(entry))
      : undefined,
    origins: workload?.origins?.map((origin) => structuredClone(origin)),
    stopCondition: workload?.stopCondition ? structuredClone(workload.stopCondition) : undefined,
    burstRps: workload?.bursty?.burstRps ?? defaults.burstRps,
    burstDurationSeconds:
      workload?.bursty?.burstDuration !== undefined
        ? workload.bursty.burstDuration / 1000
        : defaults.burstDurationSeconds,
    normalDurationSeconds:
      workload?.bursty?.normalDuration !== undefined
        ? workload.bursty.normalDuration / 1000
        : defaults.normalDurationSeconds,
    spikeTimeSeconds:
      workload?.spike?.spikeTime !== undefined
        ? workload.spike.spikeTime / 1000
        : defaults.spikeTimeSeconds,
    spikeRps: workload?.spike?.spikeRps ?? defaults.spikeRps,
    spikeDurationSeconds:
      workload?.spike?.spikeDuration !== undefined
        ? workload.spike.spikeDuration / 1000
        : defaults.spikeDurationSeconds,
    sawtoothPeakRps: workload?.sawtooth?.peakRps ?? defaults.sawtoothPeakRps,
    rampDurationSeconds:
      workload?.sawtooth?.rampDuration !== undefined
        ? workload.sawtooth.rampDuration / 1000
        : defaults.rampDurationSeconds,
    diurnalPeakMultiplier: workload?.diurnal?.peakMultiplier ?? defaults.diurnalPeakMultiplier,
    keyspaceField: keyspace?.field ?? '',
    keyspaceSize: keyspace?.size ?? null,
    keyspaceSkew: keyspace?.skew ?? null,
    faults: (testCase.faults ?? []).map((fault, faultIndex) => ({
      id: `fault-${faultIndex + 1}`,
      targetId: fault.targetId,
      faultType: fault.faultType,
      timing: fault.timing,
      mode: typeof fault.params.mode === 'string' ? fault.params.mode : '',
      atSeconds: typeof fault.params.atMs === 'number' ? fault.params.atMs / 1000 : null,
      duration: fault.duration,
      durationSeconds:
        typeof fault.params.durationMs === 'number' ? fault.params.durationMs / 1000 : null,
      extraParams: Object.entries(fault.params)
        .filter(([key]) => !['mode', 'atMs', 'durationMs'].includes(key))
        .map(([key, value], paramIndex) => valueToDraft(key, value, paramIndex))
    })),
    invariants: testCase.invariants?.map((invariant) => ({ ...invariant })) ?? []
  }
}

function valueToDraft(key: string, value: unknown, index: number): AuthoringValueDraft {
  if (typeof value === 'string') {
    return { id: `param-${index + 1}`, key, valueType: 'string', value }
  }
  if (typeof value === 'number') {
    return { id: `param-${index + 1}`, key, valueType: 'number', value: String(value) }
  }
  if (typeof value === 'boolean') {
    return { id: `param-${index + 1}`, key, valueType: 'boolean', value: String(value) }
  }
  return {
    id: `param-${index + 1}`,
    key,
    valueType: 'json',
    value: JSON.stringify(value) ?? 'null'
  }
}

function draftValue(param: AuthoringValueDraft): unknown {
  if (param.valueType === 'number') return Number(param.value)
  if (param.valueType === 'boolean') return param.value === 'true'
  if (param.valueType === 'json') return JSON.parse(param.value)
  return param.value
}

function positiveNumberError(value: number | null | undefined, label: string): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return `Enter ${label}.`
  if (value <= 0) return `${label} must be greater than zero.`
  return null
}

export function authoringScenarioFieldErrors(
  scenario: AuthoringScenarioDraft
): AuthoringScenarioFieldErrors {
  const errors: AuthoringScenarioFieldErrors = {}
  if (!scenario.description.trim()) errors.description = 'Describe what this scenario tests.'
  if (!scenario.seed.trim()) errors.seed = 'Add a fixed seed for reproducible runs.'
  const durationError = positiveNumberError(scenario.durationSeconds, 'a duration')
  if (durationError) errors.durationSeconds = durationError
  if (scenario.warmupSeconds === null || !Number.isFinite(scenario.warmupSeconds)) {
    errors.warmupSeconds = 'Enter a warmup duration.'
  } else if (scenario.warmupSeconds < 0) {
    errors.warmupSeconds = 'Warmup cannot be negative.'
  } else if (
    scenario.durationSeconds !== null &&
    scenario.warmupSeconds >= scenario.durationSeconds
  ) {
    errors.warmupSeconds = 'Warmup must be shorter than the run.'
  }
  const rpsError = positiveNumberError(scenario.baseRps, 'a base RPS')
  if (rpsError) errors.baseRps = rpsError
  if (scenario.readPercent === null || !Number.isFinite(scenario.readPercent)) {
    errors.readPercent = 'Enter a read percentage.'
  } else if (scenario.readPercent < 0 || scenario.readPercent > 100) {
    errors.readPercent = 'Read traffic must be between 0% and 100%.'
  }
  const sizeError = positiveNumberError(scenario.requestSizeBytes, 'a request size')
  if (sizeError) errors.requestSizeBytes = sizeError

  const patternValues: Partial<
    Record<AuthoringWorkloadPattern, Array<[number | null | undefined, string]>>
  > = {
    bursty: [
      [scenario.burstRps, 'a burst RPS'],
      [scenario.burstDurationSeconds, 'a burst duration'],
      [scenario.normalDurationSeconds, 'a normal duration']
    ],
    spike: [
      [scenario.spikeRps, 'a spike RPS'],
      [scenario.spikeDurationSeconds, 'a spike duration']
    ],
    sawtooth: [
      [scenario.sawtoothPeakRps, 'a peak RPS'],
      [scenario.rampDurationSeconds, 'a ramp duration']
    ],
    diurnal: [[scenario.diurnalPeakMultiplier, 'a peak multiplier']]
  }
  if (
    patternValues[scenario.pattern]?.some(([value, label]) => positiveNumberError(value, label))
  ) {
    errors.pattern = 'Complete the selected traffic pattern settings.'
  }
  if (
    scenario.defaultTimeoutMs === null ||
    (scenario.defaultTimeoutMs !== undefined && scenario.defaultTimeoutMs <= 0) ||
    scenario.traceSampleRatePercent === null ||
    (scenario.traceSampleRatePercent !== undefined &&
      (scenario.traceSampleRatePercent < 0 || scenario.traceSampleRatePercent > 100))
  ) {
    errors.pattern = 'Default timeout must be positive and trace sampling must be 0–100%.'
  }
  if (
    (scenario.faults ?? []).some((fault) =>
      fault.extraParams.some((param, index) => {
        if (
          !param.key.trim() ||
          fault.extraParams.findIndex((other) => other.key.trim() === param.key.trim()) !== index
        )
          return true
        try {
          const value = draftValue(param)
          return param.valueType === 'number' && !Number.isFinite(value)
        } catch {
          return true
        }
      })
    )
  ) {
    errors.pattern = 'Complete every custom fault parameter with a valid typed value.'
  }
  if (scenario.pattern === 'spike' && (scenario.spikeTimeSeconds ?? -1) < 0) {
    errors.pattern = 'Spike start cannot be negative.'
  }
  if (!scenario.requestDistribution && scenario.keyspaceField?.trim()) {
    if (!scenario.keyspaceSize || scenario.keyspaceSize <= 0 || (scenario.keyspaceSkew ?? 0) < 0) {
      errors.keyspace = 'Keyspace size must be positive and skew cannot be negative.'
    }
  }
  if (
    (scenario.faults ?? []).some(
      (fault) =>
        !fault.targetId.trim() ||
        !fault.faultType.trim() ||
        (fault.timing === 'deterministic' && (fault.atSeconds === null || fault.atSeconds < 0)) ||
        (fault.duration === 'fixed' && (!fault.durationSeconds || fault.durationSeconds <= 0))
    )
  ) {
    errors.pattern = 'Complete every fault target, start time, and duration.'
  }
  if (scenario.requestDistribution) {
    const weight = scenario.requestDistribution.reduce((sum, request) => sum + request.weight, 0)
    if (
      scenario.requestDistribution.length === 0 ||
      scenario.requestDistribution.some(
        (request) => !request.type.trim() || request.weight < 0 || request.sizeBytes <= 0
      ) ||
      Math.abs(weight - 1) >= 0.0001
    ) {
      errors.pattern = 'Custom request weights must total 100%, with a type and positive size.'
    }
  }
  if (scenario.origins) {
    const weight = scenario.origins.reduce((sum, origin) => sum + origin.weight, 0)
    if (
      scenario.origins.length === 0 ||
      scenario.origins.some(
        (origin) => !origin.id.trim() || !origin.label.trim() || origin.weight < 0
      ) ||
      Math.abs(weight - 1) >= 0.0001
    ) {
      errors.pattern = 'Traffic origin weights must total 100%, with an ID and label.'
    }
  }
  return errors
}

function roundedWeight(value: number): number {
  return Number(value.toFixed(8))
}

function diurnalMultipliers(peak: number): WorkloadProfile['diurnal'] {
  const hourlyMultipliers = Array.from({ length: 24 }, (_, hour) => {
    const normalized = (Math.sin(((hour - 8) / 24) * Math.PI * 2) + 1) / 2
    return Number((1 + normalized * (peak - 1)).toFixed(4))
  }) as WorkloadProfile['diurnal']['hourlyMultipliers']
  return { peakMultiplier: peak, hourlyMultipliers }
}

export function normalizeAuthoringScenarioWorkload(
  scenario: AuthoringScenarioDraft
): Partial<WorkloadProfile> | null {
  const errors = authoringScenarioFieldErrors(scenario)
  if (
    errors.baseRps ||
    errors.readPercent ||
    errors.requestSizeBytes ||
    errors.pattern ||
    errors.keyspace
  )
    return null
  if (
    scenario.baseRps === null ||
    scenario.readPercent === null ||
    scenario.requestSizeBytes === null
  )
    return null

  const readWeight = roundedWeight(scenario.readPercent / 100)
  const keyspace = scenario.keyspaceField?.trim()
    ? {
        field: scenario.keyspaceField.trim(),
        size: scenario.keyspaceSize!,
        ...(scenario.keyspaceSkew !== null && scenario.keyspaceSkew !== undefined
          ? { skew: scenario.keyspaceSkew }
          : {})
      }
    : undefined
  const workload: Partial<WorkloadProfile> = {
    pattern: scenario.pattern,
    baseRps: scenario.baseRps,
    ...(scenario.sourceNodeId?.trim() ? { sourceNodeId: scenario.sourceNodeId.trim() } : {}),
    requestDistribution: scenario.requestDistribution?.map((request) =>
      structuredClone(request)
    ) ?? [
      {
        type: 'read',
        weight: readWeight,
        sizeBytes: scenario.requestSizeBytes,
        ...(keyspace ? { keyspace } : {})
      },
      {
        type: 'write',
        weight: roundedWeight(1 - readWeight),
        sizeBytes: scenario.requestSizeBytes,
        ...(keyspace ? { keyspace } : {})
      }
    ],
    ...(scenario.origins
      ? { origins: scenario.origins.map((origin) => structuredClone(origin)) }
      : {}),
    ...(scenario.stopCondition ? { stopCondition: structuredClone(scenario.stopCondition) } : {})
  }
  if (scenario.pattern === 'bursty') {
    workload.bursty = {
      burstRps: scenario.burstRps!,
      burstDuration: scenario.burstDurationSeconds! * 1000,
      normalDuration: scenario.normalDurationSeconds! * 1000
    }
  } else if (scenario.pattern === 'spike') {
    workload.spike = {
      spikeTime: (scenario.spikeTimeSeconds ?? 0) * 1000,
      spikeRps: scenario.spikeRps!,
      spikeDuration: scenario.spikeDurationSeconds! * 1000
    }
  } else if (scenario.pattern === 'sawtooth') {
    workload.sawtooth = {
      peakRps: scenario.sawtoothPeakRps!,
      rampDuration: scenario.rampDurationSeconds! * 1000
    }
  } else if (scenario.pattern === 'diurnal') {
    workload.diurnal = diurnalMultipliers(scenario.diurnalPeakMultiplier!)
  }
  const parsed = WorkloadProfileSchema.partial().safeParse(workload)
  return parsed.success ? parsed.data : null
}

function compileFaults(scenario: AuthoringScenarioDraft): FaultSpec[] | null {
  let faults: FaultSpec[]
  try {
    faults = (scenario.faults ?? []).map((fault) => ({
      targetId: fault.targetId.trim(),
      faultType: fault.faultType.trim(),
      timing: fault.timing,
      duration: fault.duration,
      params: {
        ...Object.fromEntries(
          fault.extraParams.map((param) => [param.key.trim(), draftValue(param)])
        ),
        ...(fault.atSeconds !== null ? { atMs: fault.atSeconds * 1000 } : {}),
        ...(fault.mode.trim() ? { mode: fault.mode.trim() } : {}),
        ...(fault.duration === 'fixed' ? { durationMs: fault.durationSeconds! * 1000 } : {})
      }
    }))
  } catch {
    return null
  }
  const parsed = FaultSpecSchema.array().safeParse(faults)
  return parsed.success ? parsed.data : null
}

export function compileAuthoringScenario(
  scenario: AuthoringScenarioDraft
): QuestionSuiteCase | null {
  const errors = authoringScenarioFieldErrors(scenario)
  if (
    Object.keys(errors).length > 0 ||
    scenario.durationSeconds === null ||
    scenario.warmupSeconds === null
  )
    return null
  const global = GlobalConfigSchema.partial().safeParse({
    seed: scenario.seed.trim(),
    simulationDuration: scenario.durationSeconds * 1000,
    warmupDuration: scenario.warmupSeconds * 1000,
    ...(scenario.timeResolution ? { timeResolution: scenario.timeResolution } : {}),
    ...(scenario.defaultTimeoutMs !== null && scenario.defaultTimeoutMs !== undefined
      ? { defaultTimeout: scenario.defaultTimeoutMs }
      : {}),
    ...(scenario.traceSampleRatePercent !== null && scenario.traceSampleRatePercent !== undefined
      ? { traceSampleRate: scenario.traceSampleRatePercent / 100 }
      : {})
  })
  const workload = normalizeAuthoringScenarioWorkload(scenario)
  const faults = compileFaults(scenario)
  if (!global.success || !workload || !faults) return null
  return {
    id: scenario.id,
    description: scenario.description.trim(),
    global: global.data,
    workload,
    ...(faults.length > 0 ? { faults } : {}),
    ...((scenario.invariants?.length ?? 0) > 0
      ? { invariants: scenario.invariants!.map((invariant) => ({ ...invariant })) }
      : {})
  }
}

export function formatAuthoringScenarioSummary(scenario: AuthoringScenarioDraft): string | null {
  if (!compileAuthoringScenario(scenario)) return null
  const requestSummary = scenario.requestDistribution
    ? scenario.requestDistribution
        .map((request) => `${Number((request.weight * 100).toFixed(2))}% ${request.type}`)
        .join(' / ')
    : `${scenario.readPercent}% read / ${Number((100 - scenario.readPercent!).toFixed(8))}% write`
  const faultSummary =
    (scenario.faults?.length ?? 0) > 0
      ? ` · ${scenario.faults!.length} fault${scenario.faults!.length === 1 ? '' : 's'}`
      : ''
  return `${new Intl.NumberFormat('en-US').format(scenario.baseRps!)} req/s ${scenario.pattern} traffic · ${requestSummary} · ${scenario.durationSeconds}s run · ${scenario.warmupSeconds}s warmup · seed ${scenario.seed.trim()}${faultSummary}`
}

export function authoringScenarioReducer(
  scenarios: readonly AuthoringScenarioDraft[],
  action: AuthoringScenarioAction
): AuthoringScenarioDraft[] {
  switch (action.type) {
    case 'add':
      return scenarios.some((scenario) => scenario.id === action.scenario.id)
        ? [...scenarios]
        : [...scenarios, action.scenario]
    case 'update':
      return scenarios.map((scenario) =>
        scenario.id === action.id ? { ...scenario, ...action.changes } : scenario
      )
    case 'update-text':
    case 'update-number':
      return scenarios.map((scenario) =>
        scenario.id === action.id ? { ...scenario, [action.field]: action.value } : scenario
      )
    case 'remove':
      return scenarios.filter((scenario) => scenario.id !== action.id)
  }
}
