#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs'
import packageJson from '../../package.json'
import { dirname, parse, resolve } from 'node:path'
import { SimulationEngine } from '../engine/engine'
import { runSimulation } from '../engine/runSimulation'
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
import { stringifyCliJson } from './json'
import { CliUsageError, enumValue, parseCommandArgs, positiveIntValue } from './args'
import { palette, shouldColor } from './ansi'
import { commandHelp, isCliCommand, mainUsage } from './help'
import { loadTopologyFile } from './topologyInput'
import { runLive } from './live'
import { buildLintReport, formatLintReport, lintExitCode } from './commands/lint'
import { buildCostReport, formatCostReport } from './commands/cost'
import { defaultDesignRunner, formatCompareReport, runCompare } from './commands/compare'
import type { TopologyJSON } from '../engine/core/types'
import {
  CLI_EXIT_CHECK_FAILED,
  CLI_EXIT_EVALUATION_ERROR,
  CLI_EXIT_EVALUATION_FAILED,
  CLI_EXIT_INVALID_SUBMISSION,
  CLI_EXIT_SUCCESS,
  CLI_EXIT_USAGE_ERROR
} from './exitCodes'

// ─── ANSI ─────────────────────────────────────────────────────────────────────
// Status/progress output goes to stderr, so colour follows stderr (off when it
// is piped, or with NO_COLOR; FORCE_COLOR forces it on).
const STDERR_PALETTE = palette(shouldColor(process.stderr))
const BOLD = STDERR_PALETTE.bold
const DIM = STDERR_PALETTE.dim
const RED = STDERR_PALETTE.red
const GREEN = STDERR_PALETTE.green
const YELLOW = STDERR_PALETTE.yellow
const CYAN = STDERR_PALETTE.cyan
const RESET = STDERR_PALETTE.reset

// ─── ENTRY ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const helpPalette = palette(shouldColor(process.stdout))

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(mainUsage(helpPalette, packageJson.version))
    return
  }
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write(`${packageJson.version}\n`)
    return
  }
  if (args[0] === 'help') {
    const topic = args[1]
    if (topic === undefined) {
      process.stdout.write(mainUsage(helpPalette, packageJson.version))
      return
    }
    if (!isCliCommand(topic)) die(`Unknown command '${topic}'. Run 'sim --help' for the list.`)
    process.stdout.write(commandHelp(topic, helpPalette))
    return
  }

  const [command, ...rest] = args
  if (!isCliCommand(command)) {
    // Legacy shorthand: `sim <topology.json> [options]` is `sim run ...`.
    if (command.toLowerCase().endsWith('.json')) {
      await runSingle(args)
      return
    }
    die(`Unknown command '${command}'. Run 'sim --help' for the list.`)
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(commandHelp(command, helpPalette))
    return
  }

  try {
    switch (command) {
      case 'run':
        await runSingle(rest)
        return
      case 'validate':
        runValidate(rest)
        return
      case 'lint':
        runLint(rest)
        return
      case 'cost':
        runCost(rest)
        return
      case 'compare':
        runCompareCommand(rest)
        return
      case 'evaluate':
        runEvaluate(rest)
        return
      case 'grade':
        runGrade(rest)
        return
    }
  } catch (err) {
    if (err instanceof CliUsageError) {
      die(`${err.message} Run 'sim ${command} --help' for usage.`)
    }
    throw err
  }
}

/** Exactly `count` positional arguments, or a usage error naming them. */
function requirePositionals(positionals: string[], names: string[], command: string): string[] {
  if (positionals.length < names.length) {
    throw new CliUsageError(
      `Missing ${names
        .slice(positionals.length)
        .map((name) => `<${name}>`)
        .join(' ')}.`
    )
  }
  if (positionals.length > names.length) {
    throw new CliUsageError(
      `Unexpected argument '${positionals[names.length]}' for 'sim ${command}'.`
    )
  }
  return positionals
}

/** Load + validate a topology for a command that cannot proceed without one (exit 1). */
function loadTopologyOrExit(filePath: string): { topology: TopologyJSON; warnings: string[] } {
  const loaded = loadTopologyFile(filePath)
  if (loaded.status === 'ok') return { topology: loaded.topology, warnings: loaded.warnings }
  if (loaded.status === 'unreadable') die(loaded.message)
  printValidationErrors(loaded.message, loaded.errors)
  process.exit(CLI_EXIT_USAGE_ERROR)
}

function printValidationErrors(
  title: string,
  errors: ReadonlyArray<{ path?: string; message: string }>
): void {
  console.error(`${RED}${BOLD}${title}${RESET}`)
  for (const error of errors) {
    const prefix = error.path ? `${DIM}${error.path}${RESET}: ` : ''
    console.error(`  ${RED}✗${RESET} ${prefix}${error.message}`)
  }
}

function writeJsonOutput(value: unknown): void {
  process.stdout.write(stringifyCliJson(value) + '\n')
}

async function runSingle(args: string[]): Promise<void> {
  const parsed = parseCommandArgs(args, {
    booleans: ['json', 'verdict', 'live'],
    strings: ['output', 'seed', 'duration-ms']
  })
  const [topologyPath] = requirePositionals(parsed.positionals, ['topology.json'], 'run')
  const outputJson = parsed.flags.json
  const outputVerdict = parsed.flags.verdict
  const live = parsed.flags.live
  const outputPath = parsed.values.output
  const seedOverride = parsed.values.seed
  const durationOverride = positiveIntValue(parsed.values['duration-ms'], 'duration-ms')

  if (outputJson && outputVerdict) {
    die('Choose either --json or --verdict, not both.')
  }
  const quiet = outputJson || outputVerdict

  // ─── LOAD + VALIDATE ───────────────────────────────────────────────────────
  const loaded = loadTopologyOrExit(topologyPath)
  for (const warning of loaded.warnings) {
    console.error(`${YELLOW}⚠  ${warning}${RESET}`)
  }

  const topology: TopologyJSON = {
    ...loaded.topology,
    global: {
      ...loaded.topology.global,
      ...(seedOverride !== undefined ? { seed: seedOverride } : {}),
      ...(durationOverride !== undefined ? { simulationDuration: durationOverride } : {})
    }
  }

  if (!quiet && !live) {
    const dur = topology.global.simulationDuration / 1000
    const warmup = topology.global.warmupDuration / 1000
    console.error(`\n${BOLD}${CYAN}System Design Simulator${RESET}`)
    console.error(`${DIM}Topology : ${topology.name} (${topology.id})`)
    console.error(
      `Duration : ${dur}s   Warmup: ${warmup}s   Seed: ${topology.global.seed}${RESET}\n`
    )
  }

  // ─── RUN ──────────────────────────────────────────────────────────────────
  const engine = new SimulationEngine(topology)
  let output: SimulationOutput
  let wallMs: number

  if (live) {
    const ansi = process.stderr.isTTY === true && process.env.TERM !== 'dumb'
    if (!ansi) {
      console.error(
        `${DIM}--live: stderr is not a terminal, printing plain progress lines instead.${RESET}`
      )
    }
    const result = await runLive(engine, topology, {
      out: process.stderr,
      input: process.stdin,
      ansi,
      palette: palette(ansi && shouldColor(process.stderr)),
      onInterrupt: () => {
        console.error(`${YELLOW}Interrupted.${RESET}`)
        process.exit(130)
      }
    })
    output = result.output
    wallMs = result.wallMs
    if (result.stoppedByUser) {
      console.error(
        `${YELLOW}Stopped early at t=${((result.stoppedAtMs ?? 0) / 1000).toFixed(1)}s ` +
          `of ${(topology.global.simulationDuration / 1000).toFixed(1)}s; ` +
          `results cover the simulated time so far.${RESET}\n`
      )
    }
  } else {
    let lastPct = -1
    engine.onProgress = (percent, eventsProcessed) => {
      if (quiet) return
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
    output = engine.run()
    wallMs = Date.now() - wallStart

    if (!quiet) {
      const total = output.eventsProcessed.toLocaleString()
      process.stderr.write(`\r  ${'█'.repeat(20)} 100%  ${total} events\n\n`)
    }
  }

  // ─── OUTPUT ───────────────────────────────────────────────────────────────
  const structuredOutput = outputVerdict ? projectToVerdict(output) : output

  if (outputPath) {
    const json = stringifyCliJson(structuredOutput)
    writeFileSync(resolve(outputPath), json, 'utf-8')
    if (!quiet) {
      console.error(`${GREEN}✓ Results written to ${outputPath}${RESET}\n`)
    }
  } else if (quiet) {
    writeJsonOutput(structuredOutput)
  } else {
    printResults(output, wallMs)
  }
}

// ─── VALIDATE / LINT / COST / COMPARE ────────────────────────────────────────
function runValidate(args: string[]): void {
  const parsed = parseCommandArgs(args, { booleans: ['json'] })
  const [topologyPath] = requirePositionals(parsed.positionals, ['topology.json'], 'validate')
  const loaded = loadTopologyFile(topologyPath)
  if (loaded.status === 'unreadable') die(loaded.message)

  const valid = loaded.status === 'ok'
  const errors = loaded.status === 'invalid' ? loaded.errors : []
  const warnings = loaded.warnings
  if (parsed.flags.json) {
    writeJsonOutput({
      file: topologyPath,
      valid,
      ...(loaded.status === 'ok' ? { topologyId: loaded.topology.id } : {}),
      errors,
      warnings
    })
  } else {
    const c = palette(shouldColor(process.stdout))
    if (valid) {
      console.log(`${c.green}${c.bold}Valid${c.reset} ${topologyPath}`)
    } else {
      console.log(`${c.red}${c.bold}Invalid${c.reset} ${topologyPath}`)
      for (const error of errors) {
        const prefix = error.path ? `${c.dim}${error.path}${c.reset}: ` : ''
        console.log(`  ${c.red}✗${c.reset} ${prefix}${error.message}`)
      }
    }
    for (const warning of warnings) {
      console.log(`  ${c.yellow}⚠${c.reset} ${warning}`)
    }
    console.log(
      `${errors.length} error${errors.length === 1 ? '' : 's'}, ` +
        `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
    )
  }
  if (!valid) process.exit(CLI_EXIT_CHECK_FAILED)
}

function runLint(args: string[]): void {
  const parsed = parseCommandArgs(args, { booleans: ['json'] })
  const [topologyPath] = requirePositionals(parsed.positionals, ['topology.json'], 'lint')
  const { topology, warnings } = loadTopologyOrExit(topologyPath)
  const report = buildLintReport(topology, warnings)
  if (parsed.flags.json) {
    writeJsonOutput(report)
  } else {
    console.log(formatLintReport(report, topology, palette(shouldColor(process.stdout))))
  }
  const exitCode = lintExitCode(report)
  if (exitCode !== CLI_EXIT_SUCCESS) process.exit(exitCode)
}

const EVALUATION_MODES = ['auto', 'discrete', 'analytic'] as const

function runCost(args: string[]): void {
  const parsed = parseCommandArgs(args, { booleans: ['json', 'run'], strings: ['mode'] })
  const [topologyPath] = requirePositionals(parsed.positionals, ['topology.json'], 'cost')
  const mode = enumValue(parsed.values.mode, 'mode', EVALUATION_MODES)
  if (mode !== undefined && !parsed.flags.run) {
    throw new CliUsageError('--mode only applies together with --run.')
  }
  const { topology } = loadTopologyOrExit(topologyPath)
  const output = parsed.flags.run ? runSimulation(topology, { mode: mode ?? 'auto' }) : undefined
  const report = buildCostReport(topology, output)
  if (parsed.flags.json) {
    writeJsonOutput(report)
  } else {
    console.log(formatCostReport(report, palette(shouldColor(process.stdout))))
  }
}

function runCompareCommand(args: string[]): void {
  const parsed = parseCommandArgs(args, { booleans: ['json'], strings: ['seed', 'mode'] })
  const [pathA, pathB] = requirePositionals(parsed.positionals, ['a.json', 'b.json'], 'compare')
  const mode = enumValue(parsed.values.mode, 'mode', EVALUATION_MODES) ?? 'auto'
  const a = loadTopologyOrExit(pathA)
  const b = loadTopologyOrExit(pathB)
  if (!parsed.flags.json) {
    console.error(`${DIM}Running ${pathA} and ${pathB}...${RESET}`)
  }
  const report = runCompare(
    { file: pathA, topology: a.topology },
    { file: pathB, topology: b.topology },
    {
      ...(parsed.values.seed !== undefined ? { seed: parsed.values.seed } : {}),
      runner: defaultDesignRunner(mode)
    }
  )
  if (parsed.flags.json) {
    writeJsonOutput(report)
  } else {
    console.log(formatCompareReport(report, palette(shouldColor(process.stdout))))
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
      console.log(`  [${sev}]  ${b.nodeLabel}  -  ${metricStr}`)
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
  if (ms === 0) return '-'
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
  const json = stringifyCliJson(result)
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
        `${DIM} - ${allPassed ? 'PASS' : 'FAIL'}${RESET}`
    )
  } else if ('error' in result) {
    const accent = result.status === 'invalid_submission' ? YELLOW : RED
    console.error(
      `${DIM}Question ${result.questionId}: ${RESET}${accent}${result.status.toUpperCase()}${RESET}` +
        `${DIM} - ${result.error.message}${RESET}`
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
    (topology) => runSimulation(topology),
    typeof suite.name === 'string' ? suite.name : undefined
  )

  // Without a rubric, emit the raw verdict batch; with one, emit the graded batch.
  const payload = rubric ? gradeBatch(rubric, batch) : batch
  const json = stringifyCliJson(payload)
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
      `${DIM}Graded: ${total} cases - ${RESET}${GREEN}${passed} passed${RESET}` +
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
    `${DIM}Suite: ${total} cases - ${RESET}${GREEN}${succeeded} ok${RESET}` +
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

  const json = stringifyCliJson(batch)
  if (outputPath) {
    writeFileSync(resolve(outputPath), json, 'utf-8')
    console.error(`${GREEN}✓ Evaluation written to ${outputPath}${RESET}`)
  } else {
    process.stdout.write(json + '\n')
  }

  console.error(
    `${DIM}Scenarios: ${batch.summary.total} total - ${RESET}` +
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
    return { id, error: `Validation failed - ${detail}` }
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
  const json = stringifyCliJson(batch)

  if (outputPath) {
    writeFileSync(resolve(outputPath), json, 'utf-8')
    console.error(`${GREEN}✓ Evaluation written to ${outputPath}${RESET}`)
  } else {
    process.stdout.write(json + '\n')
  }

  console.error(
    `${DIM}Question batch: ${batch.summary.total} total - ${RESET}` +
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

function die(msg: string): never {
  console.error(`${RED}${BOLD}Error:${RESET} ${msg}`)
  process.exit(CLI_EXIT_USAGE_ERROR)
}

main().catch((err: unknown) => {
  console.error(`${RED}${BOLD}Error:${RESET} ${(err as Error)?.stack ?? String(err)}`)
  process.exit(CLI_EXIT_USAGE_ERROR)
})
