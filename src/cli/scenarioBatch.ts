import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import type { TopologyJSON } from '../engine/core/types'
import {
  buildScenarioEvaluationContract,
  type ScenarioEvaluationContract,
  type ScenarioEvaluationResult
} from '../engine/analysis/evaluationContract'
import { mergeTopologyWithOverrides, type ScenarioSpec } from '../engine/analysis/evaluate'
import type { SimulationVerdict } from '../engine/analysis/verdict'
import { validateTopology } from '../engine/validation/validator'

const DEFAULT_SCENARIO_TIMEOUT_MS = 30_000
const MAX_CHILD_OUTPUT_BYTES = 10 * 1024 * 1024
const CLI_ENTRY_PATH = resolve(__dirname, 'index.ts')

export interface IsolatedScenarioBatchOptions {
  simulatorVersion?: string
  submissionId?: string
  topologyId?: string
  evaluatedAt?: string
  timeoutMs?: number
  executeScenario?: (topology: TopologyJSON, timeoutMs: number) => ScenarioEvaluationResult
}

function describeValidationFailure(raw: unknown): string {
  const validation = validateTopology(raw)
  const first = validation.errors?.[0]
  return first ? `${first.path ? `${first.path}: ` : ''}${first.message}` : 'invalid topology'
}

function runScenarioVerdictIsolated(
  topology: TopologyJSON,
  timeoutMs: number
): ScenarioEvaluationResult {
  const tempDir = mkdtempSync(join(tmpdir(), 'ns-sim-eval-'))
  const topologyPath = resolve(tempDir, 'scenario-topology.json')

  try {
    writeFileSync(topologyPath, JSON.stringify(topology, null, 2), 'utf-8')

    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', CLI_ENTRY_PATH, 'run', topologyPath, '--verdict'],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_CHILD_OUTPUT_BYTES
      }
    )

    if (child.error?.name === 'TimeoutError' || child.error?.message.includes('ETIMEDOUT')) {
      return {
        scenarioId: '',
        status: 'timeout',
        error: `Scenario exceeded timeout of ${timeoutMs}ms`
      }
    }

    if (child.error) {
      return {
        scenarioId: '',
        status: 'error',
        error: child.error.message
      }
    }

    if (child.status !== 0) {
      const detail = (
        child.stderr ||
        child.stdout ||
        `Process exited with code ${child.status}`
      ).trim()
      return {
        scenarioId: '',
        status: 'error',
        error: detail
      }
    }

    try {
      const verdict = JSON.parse(child.stdout) as SimulationVerdict
      return {
        scenarioId: '',
        status: 'completed',
        verdict
      }
    } catch (err) {
      return {
        scenarioId: '',
        status: 'error',
        error: `Could not parse verdict JSON: ${(err as Error).message}`
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function runScenarioBatchIsolated(
  baseTopology: TopologyJSON,
  scenarios: readonly ScenarioSpec[],
  options: IsolatedScenarioBatchOptions = {}
): ScenarioEvaluationContract {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCENARIO_TIMEOUT_MS
  const executeScenario = options.executeScenario ?? runScenarioVerdictIsolated

  const verdicts: ScenarioEvaluationResult[] = scenarios.map((scenario, index) => {
    const scenarioId =
      typeof scenario.id === 'string' && scenario.id.length > 0
        ? scenario.id
        : `scenario-${index + 1}`
    const scenarioName = scenario.name
    const merged = mergeTopologyWithOverrides(baseTopology, scenario.overrides)
    const validation = validateTopology(merged)

    if (!validation.valid || !validation.data) {
      return {
        scenarioId,
        ...(scenarioName ? { scenarioName } : {}),
        status: 'error',
        error: `Validation failed: ${describeValidationFailure(merged)}`
      }
    }

    const isolated = executeScenario(validation.data, timeoutMs)
    return {
      ...isolated,
      scenarioId,
      ...(scenarioName ? { scenarioName } : {})
    }
  })

  return buildScenarioEvaluationContract(baseTopology, verdicts, {
    simulatorVersion: options.simulatorVersion,
    submissionId: options.submissionId,
    topologyId: options.topologyId,
    evaluatedAt: options.evaluatedAt
  })
}
