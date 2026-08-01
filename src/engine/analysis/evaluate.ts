import type {
  FaultSpec,
  GlobalConfig,
  TopologyJSON,
  WorkloadProfile
} from '../core/types'
import type { SimulationOutput } from './output'
import { projectToVerdict, type SimulationVerdict } from './verdict'
import { validateTopology } from '../validation/validator'
import {
  buildScenarioEvaluationContract,
  type ScenarioEvaluationContract,
  type ScenarioEvaluationResult
} from './evaluationContract'

export const EVALUATION_BATCH_VERSION = '1.0' as const

export interface ScenarioOverrides {
  global?: Partial<GlobalConfig>
  workload?: Partial<WorkloadProfile>
  faults?: FaultSpec[]
}

export interface ScenarioSpec {
  id: string
  name?: string
  overrides?: ScenarioOverrides
}

/**
 * A single case ready to be evaluated: either a fully-resolved topology to run,
 * or a case that already failed to load/validate before it could run. Keeping
 * both shapes here lets the batch summary be computed in one place regardless of
 * where a case failed.
 */
export type PreparedCase =
  | { id: string; topology: TopologyJSON }
  | { id: string; error: string }

export type EvaluationCaseResult =
  | { id: string; ok: true; verdict: SimulationVerdict }
  | { id: string; ok: false; error: string }

export interface EvaluationBatch {
  version: typeof EVALUATION_BATCH_VERSION
  suite?: string
  results: EvaluationCaseResult[]
  summary: {
    total: number
    succeeded: number
    failed: number
  }
}

function firstValidationErrorDetail(raw: unknown): string {
  const validation = validateTopology(raw)
  if (validation.valid) {
    return ''
  }

  const first = validation.errors?.[0]
  if (!first) {
    return 'invalid topology'
  }

  return `${first.path ? `${first.path}: ` : ''}${first.message}`
}

/**
 * Shared override merge used by both headless CLI batch evaluation and
 * question grading. `faults` are intentionally replace-only because each
 * scenario defines the full injected-failure set for that run.
 */
export function mergeTopologyWithOverrides(
  base: TopologyJSON,
  overrides: ScenarioOverrides = {}
): TopologyJSON {
  return {
    ...base,
    global: {
      ...base.global,
      ...(overrides.global ?? {})
    },
    ...(base.workload || overrides.workload
      ? {
          workload: {
            ...(base.workload ?? ({} as WorkloadProfile)),
            ...(overrides.workload ?? {})
          } as WorkloadProfile
        }
      : {}),
    ...(overrides.faults ? { faults: overrides.faults } : base.faults ? { faults: base.faults } : {})
  }
}

/**
 * Runs a suite of prepared cases and projects each successful run to a
 * grading-safe SimulationVerdict. This is the headless batch counterpart to a
 * single `--verdict` run: same contract per case, wrapped in a deterministic,
 * order-preserving envelope with an aggregate summary.
 *
 * The engine run is injected as `runTopology` so this stays pure and unit-
 * testable; the CLI passes `(t) => new SimulationEngine(t).run()`. Each case is
 * isolated — a throw in one becomes that case's error and never aborts the rest.
 */
export function evaluateSuite(
  cases: readonly PreparedCase[],
  runTopology: (topology: TopologyJSON) => SimulationOutput,
  suiteName?: string
): EvaluationBatch {
  const results: EvaluationCaseResult[] = cases.map((entry) => {
    if ('error' in entry) {
      return { id: entry.id, ok: false, error: entry.error }
    }
    try {
      const output = runTopology(entry.topology)
      return { id: entry.id, ok: true, verdict: projectToVerdict(output) }
    } catch (err) {
      return { id: entry.id, ok: false, error: (err as Error).message }
    }
  })

  const succeeded = results.filter((result) => result.ok).length
  return {
    version: EVALUATION_BATCH_VERSION,
    ...(suiteName ? { suite: suiteName } : {}),
    results,
    summary: {
      total: results.length,
      succeeded,
      failed: results.length - succeeded
    }
  }
}

/**
 * Runs a validated base topology under a list of named scenario overrides and
 * emits the backend-facing verdict envelope: one row per scenario, each either
 * a completed SimulationVerdict or an isolated per-scenario error. Unlike the
 * older suite-of-topologies flow, this keeps the student's topology as the
 * single source of truth and varies only the scenario conditions.
 */
export function evaluateScenarios(
  baseTopology: TopologyJSON,
  scenarios: readonly ScenarioSpec[],
  runTopology: (topology: TopologyJSON) => SimulationOutput,
  options?: {
    simulatorVersion?: string
    submissionId?: string
    topologyId?: string
    evaluatedAt?: string
  }
) : ScenarioEvaluationContract {
  const verdicts: ScenarioEvaluationResult[] = scenarios.map((scenario, index) => {
    const scenarioId =
      typeof scenario.id === 'string' && scenario.id.length > 0
        ? scenario.id
        : `scenario-${index + 1}`
    const scenarioName = scenario.name

    try {
      const merged = mergeTopologyWithOverrides(baseTopology, scenario.overrides)
      const validation = validateTopology(merged)
      if (!validation.valid || !validation.data) {
        return {
          scenarioId,
          ...(scenarioName ? { scenarioName } : {}),
          status: 'error' as const,
          error: `Validation failed: ${firstValidationErrorDetail(merged)}`
        }
      }

      const output = runTopology(validation.data)
      return {
        scenarioId,
        ...(scenarioName ? { scenarioName } : {}),
        status: 'completed' as const,
        verdict: projectToVerdict(output)
      }
    } catch (err) {
      return {
        scenarioId,
        ...(scenarioName ? { scenarioName } : {}),
        status: 'error' as const,
        error: (err as Error).message
      }
    }
  })

  return buildScenarioEvaluationContract(baseTopology, verdicts, options)
}
