import type { TopologyJSON } from '../core/types'
import type { SimulationOutput } from './output'
import { projectToVerdict, type SimulationVerdict } from './verdict'

export const EVALUATION_BATCH_VERSION = '1.0' as const

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
