/**
 * Migration-gate runner for the compute-contention two-tier model (spec §8).
 *
 * Usage:
 *   tsx scripts/compute-contention-migration.ts snapshot <out.json> [bankDir]
 *   tsx scripts/compute-contention-migration.ts diff <before.json> <after.json>
 *
 * Workflow:
 *   1. BEFORE any GGcKNode change:  snapshot baseline.json
 *   2. Land the two-tier engine change.
 *   3. AFTER:                        snapshot candidate.json
 *   4.                               diff baseline.json candidate.json
 *
 * Every entry under "FLIPS" must be explainable as a capacity-overstatement
 * correction. A reference regression (pass→fail) or a gamed pass (fail→pass) is
 * a red flag that blocks the merge until understood.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SimulationEngine } from '../src/engine/engine'
import { parseQuestionPackage } from '../src/engine/analysis/question'
import type { JustificationAnswer } from '../src/engine/analysis/justification'
import type { TopologyJSON } from '../src/engine/core/types'
import {
  snapshotTopology,
  diffBankSnapshots,
  MIGRATION_SNAPSHOT_VERSION,
  type BankSnapshot,
  type CaseSnapshot,
  type MigrationDiffReport
} from '../src/engine/analysis/migrationSnapshot'

const DEFAULT_BANK_DIR = 'ns-simulator-docs/examples/question-bank'
const RUN = (t: TopologyJSON): ReturnType<SimulationEngine['run']> => new SimulationEngine(t).run()

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf-8'))
}

function snapshotBank(bankDir: string): BankSnapshot {
  const root = resolve(bankDir)
  const cases: CaseSnapshot[] = []
  for (const name of readdirSync(root)) {
    const dir = join(root, name)
    if (!statSync(dir).isDirectory()) continue
    const qPath = join(dir, 'question.json')
    if (!existsSync(qPath)) continue

    let pkg: ReturnType<typeof parseQuestionPackage>
    try {
      pkg = parseQuestionPackage(loadJson(qPath))
    } catch (e) {
      console.error(`  ! ${name}: question.json failed to parse — ${(e as Error).message}`)
      continue
    }

    for (const kind of ['reference', 'gamed'] as const) {
      const topoPath = join(dir, `${kind}-topology.json`)
      if (!existsSync(topoPath)) continue
      const answersPath = join(dir, `${kind}-answers.json`)
      const answers: JustificationAnswer[] = existsSync(answersPath)
        ? (loadJson(answersPath) as JustificationAnswer[])
        : []
      cases.push(snapshotTopology(pkg, loadJson(topoPath) as TopologyJSON, kind, RUN, answers))
    }
  }
  return {
    version: MIGRATION_SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    cases
  }
}

function printReport(report: MigrationDiffReport): void {
  const { summary } = report
  console.log(`\n=== Compute-contention migration diff ===`)
  console.log(
    `cases: ${summary.total} | flipped: ${summary.flipped} | drift-only: ${report.driftOnly.length} | unchanged: ${report.unchanged}`
  )
  if (summary.referenceRegressions > 0) {
    console.log(
      `\n🚨 REFERENCE REGRESSIONS: ${summary.referenceRegressions} (correct solutions now FAIL)`
    )
  }
  if (summary.gamedNowPassing > 0) {
    console.log(
      `\n🚨 GAMED NOW PASSING: ${summary.gamedNowPassing} (bad solutions now sneak through)`
    )
  }

  if (report.flips.length > 0) {
    console.log(`\n--- FLIPS (each must be explained as an overstatement correction) ---`)
    for (const f of report.flips) {
      const v = f.verdictChange
        ? ` verdict ${f.verdictChange.from ? 'PASS' : 'FAIL'}→${f.verdictChange.to ? 'PASS' : 'FAIL'}`
        : ''
      console.log(`  • ${f.questionId} [${f.kind}]${v}`)
      for (const t of f.testFlips) {
        console.log(`      test "${t.name}": ${t.from ? 'pass' : 'fail'}→${t.to ? 'pass' : 'fail'}`)
      }
      for (const u of f.utilizationDeltas) {
        console.log(
          `      util ${u.nodeId}: ${(u.from * 100).toFixed(1)}%→${(u.to * 100).toFixed(1)}% (${u.delta >= 0 ? '+' : ''}${(u.delta * 100).toFixed(1)}pp)`
        )
      }
    }
  }

  if (report.driftOnly.length > 0) {
    console.log(`\n--- DRIFT ONLY (verdict held; metrics moved — expected) ---`)
    for (const d of report.driftOnly) {
      const parts: string[] = []
      if (d.utilizationDeltas.length > 0) {
        parts.push(
          d.utilizationDeltas
            .map(
              (u) => `${u.nodeId} ${u.delta * 100 >= 0 ? '+' : ''}${(u.delta * 100).toFixed(1)}pp`
            )
            .join(', ')
        )
      }
      if (d.throughputDelta) parts.push(`tput ${d.throughputDelta.delta?.toFixed(1)}`)
      if (d.p99Delta && d.p99Delta.delta !== null) parts.push(`p99 ${d.p99Delta.delta.toFixed(1)}`)
      console.log(`  • ${d.questionId} [${d.kind}]: ${parts.join(' | ')}`)
    }
  }

  if (report.presenceChanges.length > 0) {
    console.log(`\n--- BANK MEMBERSHIP CHANGED ---`)
    for (const p of report.presenceChanges) {
      console.log(`  • ${p.questionId} [${p.kind}]: ${p.presence}`)
    }
  }
  console.log('')
}

function main(): void {
  const [cmd, a, b] = process.argv.slice(2)
  if (cmd === 'snapshot' && a) {
    const bankDir = b ?? DEFAULT_BANK_DIR
    console.log(`Snapshotting bank at ${bankDir} …`)
    const snap = snapshotBank(bankDir)
    writeFileSync(resolve(a), JSON.stringify(snap, null, 2))
    const passed = snap.cases.filter((c) => c.passed).length
    console.log(
      `Wrote ${a}: ${snap.cases.length} cases (${passed} passed, ${snap.cases.length - passed} failed).`
    )
    return
  }
  if (cmd === 'diff' && a && b) {
    const before = loadJson(a) as BankSnapshot
    const after = loadJson(b) as BankSnapshot
    const report = diffBankSnapshots(before, after)
    printReport(report)
    // Non-zero exit if a dangerous flip occurred, so CI can gate on it.
    if (report.summary.referenceRegressions > 0 || report.summary.gamedNowPassing > 0) {
      process.exitCode = 1
    }
    return
  }
  console.error(
    'Usage:\n  tsx scripts/compute-contention-migration.ts snapshot <out.json> [bankDir]\n  tsx scripts/compute-contention-migration.ts diff <before.json> <after.json>'
  )
  process.exitCode = 2
}

main()
