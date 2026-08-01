#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import packageJson from '../../package.json'
import { dirname, parse, resolve } from 'node:path'
import { SimulationEngine } from '../engine/engine'
import {
  buildQuestionEvaluationBatch,
  buildQuestionEvaluationErrorContract,
  type QuestionEvaluationContract
} from '../engine/analysis/evaluationContract'
import type { SimulationOutput } from '../engine/analysis/output'
import { projectToVerdict } from '../engine/analysis/verdict'
import { evaluateSuite, type PreparedCase, type ScenarioSpec } from '../engine/analysis/evaluate'
import { gradeBatch, type Rubric } from '../engine/analysis/rubric'
import { parseQuestionPackage, type QuestionPackage } from '../engine/analysis/question'
import { validateTopology } from '../engine/validation/validator'
import process from 'node:process'
import { runQuestionBatchIsolated, type PreparedQuestionEvaluationAttempt } from './questionBatch'
import { evaluateQuestionSubmission } from './questionEvaluate'
import { runScenarioBatchIsolated } from './scenarioBatch'
import {
  CLI_EXIT_EVALUATION_ERROR,
  CLI_EXIT_EVALUATION_FAILED,
  CLI_EXIT_INVALID_SUBMISSION,
  CLI_EXIT_SUCCESS,
  CLI_EXIT_USAGE_ERROR
} from './exitCodes'

// ─── ANSI ─────────────────────────────────────────────────────────────────────
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

// ─── ENTRY ────────────────────────────────────────────────────────────────────
function main(): void {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage()
    process.exit(0)
  }

  // Subcommand dispatch. `evaluate` owns the headless contracts (suite,
  // scenarios, question, question-batch), `grade` remains as a compatibility
  // alias for single-question evaluation, and anything else is the existing
  // single-topology run.
  if (args[0] === 'run') {
    runSingle(args.slice(1))
    return
  }
  if (args[0] === 'evaluate') {
    runEvaluate(args.slice(1))
    return
  }
  if (args[0] === 'grade') {
    runGrade(args.slice(1))
    return
  }

  runSingle(args)
}

function runSingle(args: string[]): void {
  const topologyPath = args[0]
  const outputJson = args.includes('--json')
  const outputVerdict = args.includes('--verdict')
  const outputFlagIndex = args.indexOf('--output')
  const outputPath = outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined

  if (outputJson && outputVerdict) {
    die('Choose either --json or --verdict, not both.')
  }

  // ─── LOAD ──────────────────────────────────────────────────────────────────
  let raw: unknown
  try {
    const content = readFileSync(resolve(topologyPath), 'utf-8')
    raw = JSON.parse(content)
  } catch (err) {
    die(`Could not read topology file: ${(err as Error).message}`)
  }

  // ─── VALIDATE ─────────────────────────────────────────────────────────────
  const validation = validateTopology(raw)

  if (!validation.valid || !validation.data) {
    console.error(`${RED}${BOLD}Topology validation failed${RESET}`)
    for (const error of validation.errors ?? []) {
      const prefix = error.path ? `${DIM}${error.path}${RESET}: ` : ''
      console.error(`  ${RED}✗${RESET} ${prefix}${error.message}`)
    }
    process.exit(1)
  }

  for (const warning of validation.warnings ?? []) {
    console.error(`${YELLOW}⚠  ${warning}${RESET}`)
  }

  const topology = validation.data

  if (!outputJson && !outputVerdict) {
    const dur = topology.global.simulationDuration / 1000
    const warmup = topology.global.warmupDuration / 1000
    console.error(`\n${BOLD}${CYAN}NS Simulator${RESET}`)
    console.error(`${DIM}Topology : ${topology.name} (${topology.id})`)
    console.error(
      `Duration : ${dur}s   Warmup: ${warmup}s   Seed: ${topology.global.seed}${RESET}\n`
    )
  }

  // ─── RUN ──────────────────────────────────────────────────────────────────
  const engine = new SimulationEngine(topology)
  let lastPct = -1

  engine.onProgress = (percent, eventsProcessed) => {
    if (outputJson || outputVerdict) return
    const pct = Math.floor(percent)
    if (pct === lastPct) return
    lastPct = pct
    const filled = Math.floor(pct / 5)
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled)
    process.stderr.write(
      `\r  ${bar} ${String(pct).padStart(3)}%  ${eventsProcessed.toLocaleString()} events`
    )
  }

  const wallStart = Date.now()
  const output = engine.run()
  const wallMs = Date.now() - wallStart

  if (!outputJson && !outputVerdict) {
    const total = output.eventsProcessed.toLocaleString()
    process.stderr.write(`\r  ${'█'.repeat(20)} 100%  ${total} events\n\n`)
  }

  // ─── OUTPUT ───────────────────────────────────────────────────────────────
  const structuredOutput = outputVerdict ? projectToVerdict(output) : output

  if (outputPath) {
    const json = JSON.stringify(structuredOutput, null, 2)
    writeFileSync(resolve(outputPath), json, 'utf-8')
    if (!outputJson && !outputVerdict) {
      console.error(`${GREEN}✓ Results written to ${outputPath}${RESET}\n`)
    }
  } else if (outputJson || outputVerdict) {
    process.stdout.write(JSON.stringify(structuredOutput, null, 2) + '\n')
  } else {
    printResults(output, wallMs)
  }
}

// ─── FORMATTED RESULTS ────────────────────────────────────────────────────────
function printResults(output: SimulationOutput, wallMs: number): void {
  const { summary, perNode, sloBreaches, littlesLawCheck } = output

  // Summary
  const speedup = (summary.duration / wallMs).toFixed(0)
  console.log(`${BOLD}Summary${RESET}`)
  console.log(
    `  Requests   ${summary.totalRequests.toLocaleString()} total` +
      `  |  ${GREEN}${summary.successfulRequests.toLocaleString()} ok${RESET}` +
      `  |  ${RED}${summary.failedRequests.toLocaleString()} failed${RESET}` +
      `  |  ${YELLOW}${summary.timedOutRequests.toLocaleString()} timeout${RESET}` +
      `  |  ${summary.rejectedRequests.toLocaleString()} rejected`
  )
  console.log(`  Throughput ${summary.throughput.toFixed(1)} req/s  (post-warmup)`)
  console.log(`  Error rate ${(summary.errorRate * 100).toFixed(2)}%`)
  console.log(
    `  Wall time  ${wallMs}ms for ${(summary.duration / 1000).toFixed(0)}s simulated` +
      `  ${DIM}(${speedup}x real-time)${RESET}`
  )

  // Latency
  const l = summary.latency
  console.log(`\n${BOLD}End-to-end Latency${RESET}`)
  console.log(
    `  p50 ${fmtMs(l.p50).padEnd(10)}` +
      `p90 ${fmtMs(l.p90).padEnd(10)}` +
      `p95 ${fmtMs(l.p95).padEnd(10)}` +
      `p99 ${fmtMs(l.p99).padEnd(10)}` +
      `max ${fmtMs(l.max)}`
  )

  // Where the time goes: mean end-to-end latency decomposed per component.
  if (summary.latencyDecomposition.length > 0) {
    console.log(`\n${BOLD}Latency Decomposition${RESET} ${DIM}(mean per completed request)${RESET}`)
    for (const entry of summary.latencyDecomposition) {
      const share = `${(entry.shareOfEndToEnd * 100).toFixed(0)}%`.padStart(4)
      console.log(
        `  ${share}  ${fmtMs(entry.meanMs).padEnd(10)}${entry.label} ${DIM}(${entry.kind})${RESET}`
      )
    }
  }

  // Where requests die: failures grouped by the component that terminated them.
  if (summary.failuresByLocus.length > 0) {
    console.log(`\n${BOLD}Failure Locus${RESET} ${DIM}(who killed my request)${RESET}`)
    for (const entry of summary.failuresByLocus) {
      const share = `${(entry.shareOfFailures * 100).toFixed(0)}%`.padStart(4)
      const causes = Object.entries(entry.byCause)
        .map(([cause, count]) => `${cause} ${count}`)
        .join(', ')
      console.log(
        `  ${share}  ${String(entry.total).padStart(7)} ${entry.locus} ${DIM}(${entry.locusKind}: ${causes})${RESET}`
      )
    }
  }

  // Per-node table
  console.log(`\n${BOLD}Per-node Metrics${RESET}`)
  const entries = Object.entries(perNode)
  const labelW = Math.max(...entries.map(([id, m]) => (m.nodeLabel ?? id).length), 14)
  const header =
    `  ${'Node'.padEnd(labelW)}` +
    `  ${'Arrived'.padStart(8)}` +
    `  ${'Done'.padStart(8)}` +
    `  ${'Rejected'.padStart(8)}` +
    `  ${'Timed out'.padStart(9)}` +
    `  ${'Util'.padStart(6)}` +
    `  ${'p99'.padStart(9)}`
  console.log(header)
  console.log('  ' + '-'.repeat(header.length - 2))

  for (const [nodeId, m] of entries) {
    const label = (m.nodeLabel ?? nodeId).padEnd(labelW)
    const rawUtil = (m.utilization * 100).toFixed(1) + '%'
    const util =
      m.utilization > 0.9
        ? `${RED}${rawUtil.padStart(6)}${RESET}`
        : m.utilization > 0.7
          ? `${YELLOW}${rawUtil.padStart(6)}${RESET}`
          : rawUtil.padStart(6)
    console.log(
      `  ${label}` +
        `  ${String(m.totalArrived).padStart(8)}` +
        `  ${String(m.totalProcessed).padStart(8)}` +
        `  ${String(m.totalRejected).padStart(8)}` +
        `  ${String(m.totalTimedOut).padStart(9)}` +
        `  ${util}` +
        `  ${fmtMs(m.latencyP99).padStart(9)}`
    )
  }

  // SLO breaches
  if (sloBreaches.length > 0) {
    console.log(`\n${BOLD}SLO Breaches${RESET}`)
    for (const b of sloBreaches) {
      const sev =
        b.severity === 'critical' ? `${RED}${BOLD}CRITICAL${RESET}` : `${YELLOW}WARNING${RESET} `
      const metricStr =
        b.metric === 'latencyP99'
          ? `p99 latency: target ${fmtMs(b.target)}  actual ${fmtMs(b.actual)}`
          : `availability: target ${(b.target * 100).toFixed(2)}%  actual ${(b.actual * 100).toFixed(2)}%`
      console.log(`  [${sev}]  ${b.nodeLabel}  —  ${metricStr}`)
    }
  } else {
    console.log(`\n${GREEN}✓ No SLO breaches${RESET}`)
  }

  // Little's Law
  const llViolations = littlesLawCheck.filter((r) => !r.withinTolerance)
  if (llViolations.length > 0) {
    console.log(`\n${BOLD}Little's Law Violations${RESET} ${DIM}(error > 10%)${RESET}`)
    for (const r of llViolations) {
      console.log(
        `  ${r.nodeId}: L=${r.observedL.toFixed(2)}  expected=${r.expectedL.toFixed(2)}` +
          `  error=${(r.error * 100).toFixed(1)}%`
      )
    }
  }

  console.log(
    `\n${DIM}Seed: ${output.seed}` +
      `  |  Events processed: ${output.eventsProcessed.toLocaleString()}` +
      `  |  Reproducible: ${output.reproducible}${RESET}\n`
  )
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmtMs(ms: number | null): string {
  // `null` means no successful samples — show N/A, never a fabricated 0.
  if (ms === null) return 'N/A'
  if (ms === 0) return '—'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function readJsonFile(filePath: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(filePath), 'utf-8'))
  } catch (err) {
    die(`Could not read ${label}: ${(err as Error).message}`)
  }
}

function tryReadJsonFile(
  filePath: string,
  label: string
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(resolve(filePath), 'utf-8')) }
  } catch (err) {
    return { ok: false, message: `Could not read ${label}: ${(err as Error).message}` }
  }
}

function fileToken(filePath: string): string {
  const token = parse(filePath).name.trim()
  return token.length > 0 ? token : 'unknown'
}

function validationErrorDetail(
  errors: readonly { path?: string; message: string }[] | undefined
): string {
  const first = errors?.[0]
  if (!first) {
    return 'invalid topology'
  }

  return `${first.path ? `${first.path}: ` : ''}${first.message}`
}

function resolveQuestionMetadata(questionPath: string, questionRaw?: unknown) {
  return {
    questionId: objectStringField(questionRaw, 'id') ?? fileToken(questionPath),
    questionVersion: objectStringField(questionRaw, 'version') ?? 'unknown'
  }
}

function resolveTopologyMetadata(topologyPath: string, topologyRaw?: unknown) {
  return {
    topologyId: objectStringField(topologyRaw, 'id') ?? fileToken(topologyPath),
    topologySchemaVersion: objectStringField(topologyRaw, 'version') ?? 'unknown'
  }
}

function questionEvaluationExitCode(result: Pick<QuestionEvaluationContract, 'status'>): number {
  switch (result.status) {
    case 'passed':
      return CLI_EXIT_SUCCESS
    case 'failed':
      return CLI_EXIT_EVALUATION_FAILED
    case 'invalid_submission':
      return CLI_EXIT_INVALID_SUBMISSION
    case 'evaluation_error':
      return CLI_EXIT_EVALUATION_ERROR
  }
}

function questionBatchExitCode(
  batch: ReturnType<typeof buildQuestionEvaluationBatch>,
  requirePass: boolean
): number {
  if (batch.summary.evaluationErrors > 0) {
    return CLI_EXIT_EVALUATION_ERROR
  }

  if (batch.summary.invalidSubmissions > 0) {
    return CLI_EXIT_INVALID_SUBMISSION
  }

  if (requirePass && batch.summary.failed > 0) {
    return CLI_EXIT_EVALUATION_FAILED
  }

  return CLI_EXIT_SUCCESS
}

function emitQuestionEvaluationResult(
  result: QuestionEvaluationContract,
  outputPath?: string
): number {
  const json = JSON.stringify(result, null, 2)
  if (outputPath) {
    writeFileSync(resolve(outputPath), json, 'utf-8')
    console.error(`${GREEN}✓ Evaluation written to ${outputPath}${RESET}`)
  } else {
    process.stdout.write(json + '\n')
  }

  if (result.status === 'passed' || result.status === 'failed') {
    const { passedTests, totalTests, allPassed } = result.host
    console.error(
      `${DIM}Question ${result.questionId}: ${RESET}${allPassed ? GREEN : RED}${passedTests}/${totalTests} checks passed${RESET}` +
        `${DIM} — ${allPassed ? 'PASS' : 'FAIL'}${RESET}`
    )
  } else if ('error' in result) {
    const accent = result.status === 'invalid_submission' ? YELLOW : RED
    console.error(
      `${DIM}Question ${result.questionId}: ${RESET}${accent}${result.status.toUpperCase()}${RESET}` +
        `${DIM} — ${result.error.message}${RESET}`
    )
  }

  return questionEvaluationExitCode(result)
}

function parseOptionalFlagValue(args: string[], flagName: string): string | undefined {
  const index = args.indexOf(flagName)
  if (index === -1) {
    return undefined
  }

  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    die(`${flagName} requires a value.`)
  }

  return value
}

function parseOptionalPositiveIntFlag(args: string[], flagName: string): number | undefined {
  const value = parseOptionalFlagValue(args, flagName)
  if (value === undefined) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    die(`${flagName} must be a positive integer.`)
  }

  return parsed
}

function objectStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function loadInlineOrFileJson(value: unknown, baseDir: string, label: string): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(readFileSync(resolve(baseDir, value), 'utf-8'))
    } catch (err) {
      throw new Error(`Could not read ${label} '${value}': ${(err as Error).message}`)
    }
  }

  if (value && typeof value === 'object') {
    return value
  }

  throw new Error(`${label} must be a file path or inline object.`)
}

// ─── EVALUATE (batch) ───────────────────────────────────────────────────────
// Runs a suite of cases headlessly and emits an EvaluationBatch of
// SimulationVerdicts. Grading/rubrics are a separate layer; this only runs the
// suite deterministically and projects each result to the stable verdict.
function runEvaluate(args: string[]): void {
  if (args[0] === 'question') {
    runQuestionEvaluate(args.slice(1))
    return
  }

  if (args[0] === 'question-batch') {
    runQuestionBatchEvaluate(args.slice(1))
    return
  }

  const scenariosFlagIndex = args.indexOf('--scenarios')
  if (scenariosFlagIndex !== -1) {
    runScenarioEvaluate(args)
    return
  }

  runSuiteEvaluate(args)
}

function runSuiteEvaluate(args: string[]): void {
  const suitePath = args.find((arg) => !arg.startsWith('--'))
  if (!suitePath) {
    die('Usage: evaluate <suite.json> [--output <file>]')
  }
  const outputFlagIndex = args.indexOf('--output')
  const outputPath = outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined
  const rubricFlagIndex = args.indexOf('--rubric')
  const rubricPath = rubricFlagIndex !== -1 ? args[rubricFlagIndex + 1] : undefined

  let suiteRaw: unknown
  try {
    suiteRaw = JSON.parse(readFileSync(resolve(suitePath), 'utf-8'))
  } catch (err) {
    die(`Could not read suite file: ${(err as Error).message}`)
  }

  const suite = (suiteRaw ?? {}) as { name?: unknown; cases?: unknown }
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    die('Suite must contain a non-empty "cases" array.')
  }

  let rubric: Rubric | undefined
  if (rubricPath) {
    try {
      rubric = JSON.parse(readFileSync(resolve(rubricPath), 'utf-8')) as Rubric
    } catch (err) {
      die(`Could not read rubric file: ${(err as Error).message}`)
    }
    if (!Array.isArray(rubric.checks) || rubric.checks.length === 0) {
      die('Rubric must contain a non-empty "checks" array.')
    }
  }

  const suiteDir = dirname(resolve(suitePath))
  const prepared: PreparedCase[] = suite.cases.map((rawCase, index) =>
    prepareCase(rawCase, index, suiteDir)
  )

  const batch = evaluateSuite(
    prepared,
    (topology) => new SimulationEngine(topology).run(),
    typeof suite.name === 'string' ? suite.name : undefined
  )

  // Without a rubric, emit the raw verdict batch; with one, emit the graded batch.
  const payload = rubric ? gradeBatch(rubric, batch) : batch
  const json = JSON.stringify(payload, null, 2)
  if (outputPath) {
    writeFileSync(resolve(outputPath), json, 'utf-8')
    console.error(`${GREEN}✓ Evaluation written to ${outputPath}${RESET}`)
  } else {
    process.stdout.write(json + '\n')
  }

  if (rubric) {
    const graded = payload as ReturnType<typeof gradeBatch>
    const { total, ran, errored, passed, failed } = graded.summary
    console.error(
      `${DIM}Graded: ${total} cases — ${RESET}${GREEN}${passed} passed${RESET}` +
        `${DIM}, ${RESET}${failed > 0 ? RED : DIM}${failed} failed${RESET}` +
        `${DIM} (${errored} could not run)${RESET}`
    )
    // Non-zero when any case failed to run OR did not pass the rubric.
    if (errored > 0 || passed < ran) {
      process.exit(1)
    }
    return
  }

  const { total, succeeded, failed } = batch.summary
  console.error(
    `${DIM}Suite: ${total} cases — ${RESET}${GREEN}${succeeded} ok${RESET}` +
      `${DIM}, ${RESET}${failed > 0 ? RED : DIM}${failed} failed${RESET}`
  )

  // Non-zero exit when any case could not run, so batch/CI callers can gate on it.
  if (failed > 0) {
    process.exit(1)
  }
}

function runScenarioEvaluate(args: string[]): void {
  const topologyPath = args.find((arg) => !arg.startsWith('--'))
  if (!topologyPath) {
    die('Usage: evaluate <topology.json> --scenarios <scenarios.json> [--output <file>]')
  }

  const scenariosFlagIndex = args.indexOf('--scenarios')
  const scenariosPath = scenariosFlagIndex !== -1 ? args[scenariosFlagIndex + 1] : undefined
  if (!scenariosPath) {
    die('Scenario evaluation requires --scenarios <scenarios.json>.')
  }
  if (args.includes('--rubric')) {
    die('Scenario evaluation does not accept --rubric; use grade for question scoring.')
  }

  const outputFlagIndex = args.indexOf('--output')
  const outputPath = outputFlagIndex !== -1 ? args[outputFlagIndex + 1] : undefined
  const timeoutFlagIndex = args.indexOf('--timeout-ms')
  const timeoutMsValue = timeoutFlagIndex !== -1 ? args[timeoutFlagIndex + 1] : undefined
  const timeoutMs = timeoutMsValue !== undefined ? Number.parseInt(timeoutMsValue, 10) : undefined
  if (timeoutMsValue !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs! <= 0)) {
    die('--timeout-ms must be a positive integer.')
  }

  let topologyRaw: unknown
  try {
    topologyRaw = JSON.parse(readFileSync(resolve(topologyPath), 'utf-8'))
  } catch (err) {
    die(`Could not read topology file: ${(err as Error).message}`)
  }

  const topologyValidation = validateTopology(topologyRaw)
  if (!topologyValidation.valid || !topologyValidation.data) {
    console.error(`${RED}${BOLD}Topology validation failed${RESET}`)
    for (const error of topologyValidation.errors ?? []) {
      const prefix = error.path ? `${DIM}${error.path}${RESET}: ` : ''
      console.error(`  ${RED}✗${RESET} ${prefix}${error.message}`)
    }
    process.exit(1)
  }

  let scenariosRaw: unknown
  try {
    scenariosRaw = JSON.parse(readFileSync(resolve(scenariosPath), 'utf-8'))
  } catch (err) {
    die(`Could not read scenarios file: ${(err as Error).message}`)
  }

  const batchSpec = (scenariosRaw ?? {}) as {
    submissionId?: unknown
    topologyId?: unknown
    evaluatedAt?: unknown
    timeoutMs?: unknown
    scenarios?: unknown
  }
  if (!Array.isArray(batchSpec.scenarios) || batchSpec.scenarios.length === 0) {
    die('Scenarios file must contain a non-empty "scenarios" array.')
  }

  const scenarios: ScenarioSpec[] = batchSpec.scenarios.map((entry, index) => {
    const scenario = (entry ?? {}) as {
      id?: unknown
      name?: unknown
      overrides?: unknown
    }
    const overrides =
      scenario.overrides && typeof scenario.overrides === 'object'
        ? (scenario.overrides as ScenarioSpec['overrides'])
        : undefined
    return {
      id:
        typeof scenario.id === 'string' && scenario.id.length > 0
          ? scenario.id
          : `scenario-${index + 1}`,
      ...(typeof scenario.name === 'string' && scenario.name.length > 0
        ? { name: scenario.name }
        : {}),
      ...(overrides ? { overrides } : {})
    }
  })

  const batchTimeoutMs =
    timeoutMs ??
    (typeof batchSpec.timeoutMs === 'number' && Number.isFinite(batchSpec.timeoutMs)
      ? batchSpec.timeoutMs
      : undefined)

  const batch = runScenarioBatchIsolated(topologyValidation.data, scenarios, {
    simulatorVersion: packageJson.version,
    ...(typeof batchSpec.submissionId === 'string' && batchSpec.submissionId.length > 0
      ? { submissionId: batchSpec.submissionId }
      : {}),
    ...(typeof batchSpec.topologyId === 'string' && batchSpec.topologyId.length > 0
      ? { topologyId: batchSpec.topologyId }
      : {}),
    ...(typeof batchSpec.evaluatedAt === 'string' && batchSpec.evaluatedAt.length > 0
      ? { evaluatedAt: batchSpec.evaluatedAt }
      : {}),
    ...(batchTimeoutMs !== undefined ? { timeoutMs: batchTimeoutMs } : {})
  })

  const json = JSON.stringify(batch, null, 2)
  if (outputPath) {
    writeFileSync(resolve(outputPath), json, 'utf-8')
    console.error(`${GREEN}✓ Evaluation written to ${outputPath}${RESET}`)
  } else {
    process.stdout.write(json + '\n')
  }

  console.error(
    `${DIM}Scenarios: ${batch.summary.total} total — ${RESET}` +
      `${GREEN}${batch.summary.completed} completed${RESET}` +
      `${DIM}, ${RESET}${batch.summary.errored > 0 ? RED : DIM}${batch.summary.errored} errored${RESET}` +
      `${DIM}, ${RESET}${batch.summary.timedOut > 0 ? YELLOW : DIM}${batch.summary.timedOut} timed out${RESET}`
  )
}

// Resolves one suite case into a runnable topology or a load/validation error,
// applying optional per-case `global` / `workload` overrides. Errors are
// captured per-case so one bad case never aborts the whole suite.
function prepareCase(rawCase: unknown, index: number, suiteDir: string): PreparedCase {
  const spec = (rawCase ?? {}) as {
    id?: unknown
    topology?: unknown
    global?: unknown
    workload?: unknown
  }
  const id = typeof spec.id === 'string' && spec.id.length > 0 ? spec.id : `case-${index + 1}`

  let raw: unknown
  if (typeof spec.topology === 'string') {
    try {
      raw = JSON.parse(readFileSync(resolve(suiteDir, spec.topology), 'utf-8'))
    } catch (err) {
      return { id, error: `Could not read topology '${spec.topology}': ${(err as Error).message}` }
    }
  } else if (spec.topology && typeof spec.topology === 'object') {
    raw = spec.topology
  } else {
    return { id, error: 'Case is missing a "topology" (file path or inline object).' }
  }

  const base = raw as Record<string, unknown>
  const merged: Record<string, unknown> = { ...base }
  if (spec.global && typeof spec.global === 'object') {
    merged.global = { ...((base.global as object | undefined) ?? {}), ...(spec.global as object) }
  }
  if (spec.workload && typeof spec.workload === 'object') {
    merged.workload = {
      ...((base.workload as object | undefined) ?? {}),
      ...(spec.workload as object)
    }
  }

  const validation = validateTopology(merged)
  if (!validation.valid || !validation.data) {
    const first = validation.errors?.[0]
    const detail = first
      ? `${first.path ? `${first.path}: ` : ''}${first.message}`
      : 'invalid topology'
    return { id, error: `Validation failed — ${detail}` }
  }
  return { id, topology: validation.data }
}

// ─── QUESTION EVALUATION ─────────────────────────────────────────────────────
// Grades a student's submitted topology against a QuestionPackage and emits the
// versioned backend evaluation contract. Exits non-zero unless the submission
// passes every host-visible check.
function runQuestionEvaluate(args: string[], usagePrefix = 'evaluate question'): void {
  const positionals = args.filter((arg) => !arg.startsWith('--'))
  const questionPath = positionals[0]
  const topologyPath = positionals[1]
  if (!questionPath || !topologyPath) {
    die(`Usage: ${usagePrefix} <question.json> <student-topology.json> [--output <file>]`)
  }
  const outputPath = parseOptionalFlagValue(args, '--output')
  const attemptId = parseOptionalFlagValue(args, '--attempt-id')
  const submissionId = parseOptionalFlagValue(args, '--submission-id')
  const evaluatedAt = parseOptionalFlagValue(args, '--evaluated-at')
  const sharedOptions = {
    simulatorVersion: packageJson.version,
    ...(attemptId ? { attemptId } : {}),
    ...(submissionId ? { submissionId } : {}),
    ...(evaluatedAt ? { evaluatedAt } : {})
  }

  const questionFile = tryReadJsonFile(questionPath, 'question package')
  if (questionFile.ok === false) {
    const exitCode = emitQuestionEvaluationResult(
      buildQuestionEvaluationErrorContract({
        ...resolveQuestionMetadata(questionPath),
        ...resolveTopologyMetadata(topologyPath),
        ...sharedOptions,
        status: 'evaluation_error',
        message: questionFile.message
      }),
      outputPath
    )
    process.exit(exitCode)
  }

  const topologyFile = tryReadJsonFile(topologyPath, 'student topology')

  let pkg: QuestionPackage
  try {
    pkg = parseQuestionPackage(questionFile.value)
  } catch (err) {
    const exitCode = emitQuestionEvaluationResult(
      buildQuestionEvaluationErrorContract({
        ...resolveQuestionMetadata(questionPath, questionFile.value),
        ...(topologyFile.ok
          ? resolveTopologyMetadata(topologyPath, topologyFile.value)
          : resolveTopologyMetadata(topologyPath)),
        ...sharedOptions,
        status: 'evaluation_error',
        message: (err as Error).message
      }),
      outputPath
    )
    process.exit(exitCode)
  }

  if (topologyFile.ok === false) {
    const exitCode = emitQuestionEvaluationResult(
      buildQuestionEvaluationErrorContract({
        questionId: pkg.id,
        questionVersion: pkg.version,
        ...resolveTopologyMetadata(topologyPath),
        ...sharedOptions,
        status: 'invalid_submission',
        message: topologyFile.message
      }),
      outputPath
    )
    process.exit(exitCode)
  }

  const topologyValidation = validateTopology(topologyFile.value)
  if (!topologyValidation.valid || !topologyValidation.data) {
    const exitCode = emitQuestionEvaluationResult(
      buildQuestionEvaluationErrorContract({
        questionId: pkg.id,
        questionVersion: pkg.version,
        ...resolveTopologyMetadata(topologyPath, topologyFile.value),
        ...sharedOptions,
        status: 'invalid_submission',
        message: `Student topology validation failed: ${validationErrorDetail(topologyValidation.errors)}`
      }),
      outputPath
    )
    process.exit(exitCode)
  }

  let result: QuestionEvaluationContract
  try {
    result = evaluateQuestionSubmission(pkg, topologyValidation.data, sharedOptions)
  } catch (err) {
    result = buildQuestionEvaluationErrorContract({
      questionId: pkg.id,
      questionVersion: pkg.version,
      topologyId: topologyValidation.data.id,
      topologySchemaVersion: topologyValidation.data.version,
      ...sharedOptions,
      status: 'evaluation_error',
      message: (err as Error).message
    })
  }

  const exitCode = emitQuestionEvaluationResult(result, outputPath)
  if (exitCode !== CLI_EXIT_SUCCESS) {
    process.exit(exitCode)
  }
}

function runGrade(args: string[]): void {
  runQuestionEvaluate(args, 'grade')
}

function runQuestionBatchEvaluate(args: string[]): void {
  const batchPath = args.find((arg) => !arg.startsWith('--'))
  if (!batchPath) {
    die('Usage: evaluate question-batch <batch.json> [--output <file>]')
  }

  const outputPath = parseOptionalFlagValue(args, '--output')
  const timeoutMsOverride = parseOptionalPositiveIntFlag(args, '--timeout-ms')
  const requirePass = args.includes('--require-pass')
  const batchRaw = readJsonFile(batchPath, 'question batch file')
  const batchSpec = (batchRaw ?? {}) as {
    evaluatedAt?: unknown
    timeoutMs?: unknown
    attempts?: unknown
  }

  if (!Array.isArray(batchSpec.attempts) || batchSpec.attempts.length === 0) {
    die('Question batch file must contain a non-empty "attempts" array.')
  }

  const batchDir = dirname(resolve(batchPath))
  const evaluatedAt =
    parseOptionalFlagValue(args, '--evaluated-at') ??
    (typeof batchSpec.evaluatedAt === 'string' && batchSpec.evaluatedAt.length > 0
      ? batchSpec.evaluatedAt
      : undefined)
  const timeoutMs =
    timeoutMsOverride ??
    (typeof batchSpec.timeoutMs === 'number' && Number.isFinite(batchSpec.timeoutMs)
      ? batchSpec.timeoutMs
      : undefined)

  const stagedAttempts: Array<
    | { kind: 'prepared'; attempt: PreparedQuestionEvaluationAttempt }
    | { kind: 'invalid'; result: QuestionEvaluationContract }
  > = batchSpec.attempts.map((entry, index) => {
    const attemptSpec = (entry ?? {}) as {
      attemptId?: unknown
      submissionId?: unknown
      question?: unknown
      topology?: unknown
      questionId?: unknown
      questionVersion?: unknown
      topologyId?: unknown
      topologySchemaVersion?: unknown
    }

    const metadata = {
      questionId:
        (typeof attemptSpec.questionId === 'string' && attemptSpec.questionId.length > 0
          ? attemptSpec.questionId
          : undefined) ??
        objectStringField(attemptSpec.question, 'id') ??
        `question-${index + 1}`,
      questionVersion:
        (typeof attemptSpec.questionVersion === 'string' && attemptSpec.questionVersion.length > 0
          ? attemptSpec.questionVersion
          : undefined) ?? objectStringField(attemptSpec.question, 'version'),
      topologyId:
        (typeof attemptSpec.topologyId === 'string' && attemptSpec.topologyId.length > 0
          ? attemptSpec.topologyId
          : undefined) ??
        objectStringField(attemptSpec.topology, 'id') ??
        `topology-${index + 1}`,
      topologySchemaVersion:
        (typeof attemptSpec.topologySchemaVersion === 'string' &&
        attemptSpec.topologySchemaVersion.length > 0
          ? attemptSpec.topologySchemaVersion
          : undefined) ?? objectStringField(attemptSpec.topology, 'version'),
      ...(typeof attemptSpec.attemptId === 'string' && attemptSpec.attemptId.length > 0
        ? { attemptId: attemptSpec.attemptId }
        : {}),
      ...(typeof attemptSpec.submissionId === 'string' && attemptSpec.submissionId.length > 0
        ? { submissionId: attemptSpec.submissionId }
        : {})
    }

    let question: QuestionPackage | null = null
    try {
      const questionRaw = loadInlineOrFileJson(
        attemptSpec.question,
        batchDir,
        `question for attempt ${index + 1}`
      )
      question = parseQuestionPackage(questionRaw)
      const topologyRaw = loadInlineOrFileJson(
        attemptSpec.topology,
        batchDir,
        `topology for attempt ${index + 1}`
      )
      const topologyValidation = validateTopology(topologyRaw)
      if (!topologyValidation.valid || !topologyValidation.data) {
        const first = topologyValidation.errors?.[0]
        const detail = first
          ? `${first.path ? `${first.path}: ` : ''}${first.message}`
          : 'invalid topology'
        return {
          kind: 'invalid' as const,
          result: buildQuestionEvaluationErrorContract({
            ...metadata,
            questionId: question.id,
            questionVersion: question.version,
            topologyId: metadata.topologyId,
            topologySchemaVersion: metadata.topologySchemaVersion,
            simulatorVersion: packageJson.version,
            evaluatedAt,
            status: 'invalid_submission',
            message: `Topology validation failed: ${detail}`
          })
        }
      }

      return {
        kind: 'prepared' as const,
        attempt: {
          question,
          topology: topologyValidation.data,
          ...(metadata.attemptId ? { attemptId: metadata.attemptId } : {}),
          ...(metadata.submissionId ? { submissionId: metadata.submissionId } : {})
        }
      }
    } catch (err) {
      return {
        kind: 'invalid' as const,
        result: buildQuestionEvaluationErrorContract({
          ...metadata,
          ...(question
            ? {
                questionId: question.id,
                questionVersion: question.version
              }
            : {}),
          simulatorVersion: packageJson.version,
          evaluatedAt,
          status: 'invalid_submission',
          message: (err as Error).message
        })
      }
    }
  })

  const preparedAttempts = stagedAttempts
    .filter(
      (entry): entry is { kind: 'prepared'; attempt: PreparedQuestionEvaluationAttempt } =>
        entry.kind === 'prepared'
    )
    .map((entry) => entry.attempt)
  const preparedResults = runQuestionBatchIsolated(preparedAttempts, {
    simulatorVersion: packageJson.version,
    evaluatedAt,
    ...(timeoutMs !== undefined ? { timeoutMs } : {})
  }).results

  let preparedIndex = 0
  const results = stagedAttempts.map((entry) => {
    if (entry.kind === 'invalid') {
      return entry.result
    }

    const next = preparedResults[preparedIndex]
    preparedIndex += 1
    return next
  })

  const batch = buildQuestionEvaluationBatch(results, {
    simulatorVersion: packageJson.version,
    evaluatedAt
  })
  const json = JSON.stringify(batch, null, 2)

  if (outputPath) {
    writeFileSync(resolve(outputPath), json, 'utf-8')
    console.error(`${GREEN}✓ Evaluation written to ${outputPath}${RESET}`)
  } else {
    process.stdout.write(json + '\n')
  }

  console.error(
    `${DIM}Question batch: ${batch.summary.total} total — ${RESET}` +
      `${GREEN}${batch.summary.passed} passed${RESET}` +
      `${DIM}, ${RESET}${batch.summary.failed > 0 ? RED : DIM}${batch.summary.failed} failed${RESET}` +
      `${DIM}, ${RESET}${batch.summary.invalidSubmissions > 0 ? YELLOW : DIM}${batch.summary.invalidSubmissions} invalid${RESET}` +
      `${DIM}, ${RESET}${batch.summary.evaluationErrors > 0 ? RED : DIM}${batch.summary.evaluationErrors} errors${RESET}`
  )

  const exitCode = questionBatchExitCode(batch, requirePass)
  if (exitCode !== CLI_EXIT_SUCCESS) {
    process.exit(exitCode)
  }
}

function printUsage(): void {
  console.log(`
${BOLD}ns-simulator CLI${RESET}

${BOLD}Usage${RESET}
  npm run sim -- run <topology.json> [options]
  npm run sim -- <topology.json> [options]
  npm run sim -- evaluate <topology.json> --scenarios <scenarios.json> [--output <file>]
  npm run sim -- evaluate <suite.json> [--rubric <rubric.json>] [--output <file>]
  npm run sim -- evaluate question <question.json> <student-topology.json> [--output <file>]
  npm run sim -- evaluate question-batch <batch.json> [--output <file>]
  npm run sim -- grade <question.json> <student-topology.json> [--output <file>]

${BOLD}Options${RESET}
  --json              Print full SimulationOutput as JSON to stdout
  --verdict           Print SimulationVerdict as JSON to stdout
  --scenarios <file>  (evaluate) Run one base topology under multiple overrides
  --timeout-ms <n>    (evaluate) Per-scenario wall-clock timeout in milliseconds
  --rubric <file>     (evaluate) Grade each case's verdict against a rubric
  --attempt-id <id>   (question) Attach a stable attempt id to the output contract
  --submission-id <id> (question) Attach a stable submission id to the output contract
  --evaluated-at <ts> (question/batch/scenario) Inject an explicit ISO timestamp
  --require-pass      (question-batch) Exit non-zero when any valid result fails
  --output <file>     Write JSON output to a file
  -h, --help          Show this message

${BOLD}Evaluate${RESET} ${DIM}(scenario mode)${RESET}
  Runs one validated base topology under many named scenario overrides and emits
  a ScenarioEvaluationBatch of SimulationVerdicts.
  A scenarios file is:
    {
      "submissionId"?: "...",
      "topologyId"?: "...",
      "evaluatedAt"?: "2026-08-01T00:00:00.000Z",
      "timeoutMs"?: 30000,
      "scenarios": [
        {
          "id": "normal-load",
          "name"?: "Normal traffic",
          "overrides"?: {
            "global"?: { ... },
            "workload"?: { ... },
            "faults"?: [ ... ]
          }
        }
      ]
    }
  Scenario failures are isolated per row in JSON output; the command exits zero
  unless the base topology or the scenarios file itself is invalid.
  Scenarios run in isolated subprocesses with a per-scenario timeout guard.

${BOLD}Evaluate${RESET} ${DIM}(suite mode)${RESET}
  Runs every case in a suite and prints an EvaluationBatch of SimulationVerdicts.
  A suite is { "name"?, "cases": [{ "id", "topology": <path|object>, "global"?, "workload"? }] }.
  With --rubric, prints a GradedEvaluationBatch of pass/fail check rows + scores.
  A rubric is { "id"?, "passThreshold"?, "checks": [{ "id", "description", "metric", "op", "value", "points"? }] }.
  Exits non-zero if any case fails to run, or (with a rubric) does not pass.

${BOLD}Evaluate${RESET} ${DIM}(question mode)${RESET}
  Grades one student's topology against a QuestionPackage and prints a versioned
  QuestionEvaluationContract for backend/host consumption. The question suite
  carries condition overrides (global/workload/faults) applied to the student's
  topology; the rubric scores the resulting verdicts. Invalid student input is
  normalized into an invalid_submission contract instead of a plain CLI crash.

${BOLD}Evaluate${RESET} ${DIM}(question-batch mode)${RESET}
  Runs many question evaluations headlessly for backend jobs or CI.
  A batch file is:
    {
      "evaluatedAt"?: "2026-08-01T00:00:00.000Z",
      "timeoutMs"?: 30000,
      "attempts": [
        {
          "attemptId"?: "...",
          "submissionId"?: "...",
          "question"?: "<path-to-question.json>" | { ...QuestionPackage },
          "topology"?: "<path-to-topology.json>" | { ...TopologyJSON }
        }
      ]
    }
  Each attempt yields an isolated QuestionEvaluationContract row. Invalid input
  rows become invalid_submission results instead of aborting the whole batch.
  By default the command exits non-zero only for invalid/error rows; add
  --require-pass to also gate on failed but valid submissions.

${BOLD}Grade${RESET} ${DIM}(legacy alias)${RESET}
  Alias for: evaluate question <question.json> <student-topology.json>

${BOLD}Question Exit Codes${RESET}
  0  passed / successful batch
  2  valid submission failed grading checks
  3  invalid submission contract
  4  evaluation error contract

${BOLD}Examples${RESET}
  npm run sim -- topology.json
  npm run sim -- run topology.json --verdict
  npm run sim -- evaluate topology.json --scenarios scenarios.json
  npm run sim -- evaluate suite.json
  npm run sim -- evaluate suite.json --rubric rubric.json
  npm run sim -- evaluate suite.json --rubric rubric.json --output graded.json
  npm run sim -- evaluate question question.json student-topology.json --submission-id sub-42
  npm run sim -- evaluate question-batch grading-batch.json --output results.json
  npm run sim -- topology.json --json | jq '.summary'
`)
}

function die(msg: string): never {
  console.error(`${RED}${BOLD}Error:${RESET} ${msg}`)
  process.exit(CLI_EXIT_USAGE_ERROR)
}

main()
