/**
 * Migration harness for the compute-contention two-tier model (and any future
 * change that could move simulation numbers). It is the MERGE GATE required by
 * ns-simulator-docs/specs/compute-contention-two-tier-model.md §8: before the
 * `GGcKNode` service-time change lands, capture a BASELINE snapshot of every
 * question-bank case (pass/fail + the metrics the change will move); after the
 * change, capture a CANDIDATE snapshot and diff. Every verdict flip must be
 * explainable as "this was passing/failing on a capacity overstatement" — an
 * unexplainable flip blocks the merge.
 *
 * This module is PURE and filesystem-free (unit-testable). The CLI runner
 * `scripts/compute-contention-migration.ts` loads the bank from disk, injects the
 * real `SimulationEngine`, and reads/writes the snapshot JSON. The "before vs
 * after" toggle is temporal (snapshot → change the engine → re-snapshot → diff),
 * not a runtime flag, which is exactly how a migration gate should work.
 */
import type { TopologyJSON } from '../core/types'
import type { SimulationOutput } from './output'
import { gradeAttemptWithArtifacts, type QuestionPackage } from './question'
import type { JustificationAnswer } from './justification'

export const MIGRATION_SNAPSHOT_VERSION = '1' as const

/** The topology flavour graded for a bank question. */
export type TopologyKind = 'reference' | 'gamed'

/** The subset of a verdict's metrics the two-tier model can move, per suite case. */
export interface RunMetrics {
  caseId: string
  throughput: number
  errorRate: number
  p99: number | null
  /** nodeId → the two metrics most sensitive to the CPU-contention change. */
  perNode: Record<string, { utilization: number; p99: number }>
}

/** A single graded (question, topology-flavour) pair frozen for comparison. */
export interface CaseSnapshot {
  questionId: string
  kind: TopologyKind
  /** Collapsed host contract: did every headless-checkable test pass? */
  passed: boolean
  tests: { id: string; name: string; passed: boolean }[]
  /** Metrics per executed suite case (empty if structural gate skipped execution). */
  runs: RunMetrics[]
  /** Set when grading threw or the topology could not be prepared. */
  error?: string
}

export interface BankSnapshot {
  version: typeof MIGRATION_SNAPSHOT_VERSION
  generatedAt: string
  cases: CaseSnapshot[]
}

/** Extract the movement-sensitive metrics from one suite case's verdict. */
function extractRunMetrics(
  caseId: string,
  verdict: {
    summary: { throughput: number; errorRate: number; latency: { p99: number | null } }
    perNode: Record<string, { utilization: number; latencyP99: number }>
  }
): RunMetrics {
  const perNode: RunMetrics['perNode'] = {}
  for (const [nodeId, node] of Object.entries(verdict.perNode)) {
    perNode[nodeId] = { utilization: node.utilization, p99: node.latencyP99 }
  }
  return {
    caseId,
    throughput: verdict.summary.throughput,
    errorRate: verdict.summary.errorRate,
    p99: verdict.summary.latency.p99,
    perNode
  }
}

/**
 * Grade one (question, topology) pair and freeze the result. `runTopology` is
 * injected so this stays engine-agnostic and testable; the CLI passes the real
 * `SimulationEngine`. Grading failures are captured as `error`, never thrown, so
 * one bad case never aborts a bank sweep.
 */
export function snapshotTopology(
  pkg: QuestionPackage,
  topology: TopologyJSON,
  kind: TopologyKind,
  runTopology: (topology: TopologyJSON) => SimulationOutput,
  justificationAnswers: readonly JustificationAnswer[] = []
): CaseSnapshot {
  try {
    const { grade, cases } = gradeAttemptWithArtifacts(
      pkg,
      topology,
      runTopology,
      justificationAnswers
    )
    const runs: RunMetrics[] = cases
      .filter((c) => c.verdict)
      .map((c) => extractRunMetrics(c.caseId, c.verdict!))
    return {
      questionId: pkg.id,
      kind,
      passed: grade.contract.allPassed,
      tests: grade.contract.tests.map((t) => ({ id: t.id, name: t.name, passed: t.passed })),
      runs
    }
  } catch (err) {
    return {
      questionId: pkg.id,
      kind,
      passed: false,
      tests: [],
      runs: [],
      error: (err as Error).message
    }
  }
}

// ── Diff ─────────────────────────────────────────────────────────────────────

/** Notability thresholds — below these a metric move is treated as noise. */
export const UTILIZATION_DELTA_THRESHOLD = 0.02 // 2 percentage points
export const RELATIVE_DELTA_THRESHOLD = 0.05 // 5% relative move on throughput/p99

interface ScalarDelta {
  from: number | null
  to: number | null
  delta: number | null
}

export interface CaseDiff {
  questionId: string
  kind: TopologyKind
  /** Overall pass/fail flip — the primary GATE signal. */
  verdictChange?: { from: boolean; to: boolean }
  /** Individual host-test flips (finer-grained than the overall verdict). */
  testFlips: { id: string; name: string; from: boolean; to: boolean }[]
  /** Per-node utilization moves past the threshold (the metric this change targets). */
  utilizationDeltas: { nodeId: string; from: number; to: number; delta: number }[]
  /** Aggregate summary moves past the relative threshold (first suite case). */
  throughputDelta?: ScalarDelta
  p99Delta?: ScalarDelta
  /** Present when a case exists on only one side (bank membership changed). */
  presence?: 'only-before' | 'only-after'
}

export interface MigrationDiffReport {
  /** Cases whose overall verdict or any test flipped — MUST each be explained. */
  flips: CaseDiff[]
  /** Cases whose verdict held but metrics moved past threshold — expected, informational. */
  driftOnly: CaseDiff[]
  /** Cases that appeared or disappeared between snapshots. */
  presenceChanges: CaseDiff[]
  unchanged: number
  summary: {
    total: number
    flipped: number
    referenceRegressions: number // reference topologies that went pass → fail (the danger)
    gamedNowPassing: number // gamed topologies that went fail → pass (also a danger)
  }
}

function keyOf(c: { questionId: string; kind: TopologyKind }): string {
  return `${c.questionId}::${c.kind}`
}

function relative(from: number, to: number): number {
  const denom = Math.abs(from) > 1e-9 ? Math.abs(from) : 1
  return (to - from) / denom
}

/**
 * Diff two bank snapshots. Verdict/test flips land in `flips` (the gate items a
 * human must justify); pure metric movement lands in `driftOnly` (expected — the
 * whole point of the change is to move utilization). The summary calls out the
 * two dangerous directions explicitly: a reference solution that regressed to
 * failing, and a gamed solution that now sneaks through.
 */
export function diffBankSnapshots(before: BankSnapshot, after: BankSnapshot): MigrationDiffReport {
  const beforeMap = new Map(before.cases.map((c) => [keyOf(c), c]))
  const afterMap = new Map(after.cases.map((c) => [keyOf(c), c]))
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()])

  const flips: CaseDiff[] = []
  const driftOnly: CaseDiff[] = []
  const presenceChanges: CaseDiff[] = []
  let unchanged = 0
  let referenceRegressions = 0
  let gamedNowPassing = 0

  for (const key of allKeys) {
    const b = beforeMap.get(key)
    const a = afterMap.get(key)

    if (!b || !a) {
      const present = (a ?? b)!
      presenceChanges.push({
        questionId: present.questionId,
        kind: present.kind,
        testFlips: [],
        utilizationDeltas: [],
        presence: a ? 'only-after' : 'only-before'
      })
      continue
    }

    const diff: CaseDiff = {
      questionId: b.questionId,
      kind: b.kind,
      testFlips: [],
      utilizationDeltas: []
    }

    if (b.passed !== a.passed) {
      diff.verdictChange = { from: b.passed, to: a.passed }
      if (b.kind === 'reference' && b.passed && !a.passed) referenceRegressions++
      if (b.kind === 'gamed' && !b.passed && a.passed) gamedNowPassing++
    }

    // Per-test flips (matched by id).
    const aTests = new Map(a.tests.map((t) => [t.id, t]))
    for (const bt of b.tests) {
      const at = aTests.get(bt.id)
      if (at && at.passed !== bt.passed) {
        diff.testFlips.push({ id: bt.id, name: bt.name, from: bt.passed, to: at.passed })
      }
    }

    // Metric drift — first suite case is representative for the summary scalars;
    // utilization is compared per node across the first case.
    const br = b.runs[0]
    const ar = a.runs[0]
    if (br && ar) {
      if (relativeThroughputMoved(br.throughput, ar.throughput)) {
        diff.throughputDelta = {
          from: br.throughput,
          to: ar.throughput,
          delta: ar.throughput - br.throughput
        }
      }
      if (scalarMoved(br.p99, ar.p99)) {
        diff.p99Delta = { from: br.p99, to: ar.p99, delta: safeDelta(br.p99, ar.p99) }
      }
      for (const [nodeId, bn] of Object.entries(br.perNode)) {
        const an = ar.perNode[nodeId]
        if (an && Math.abs(an.utilization - bn.utilization) >= UTILIZATION_DELTA_THRESHOLD) {
          diff.utilizationDeltas.push({
            nodeId,
            from: bn.utilization,
            to: an.utilization,
            delta: an.utilization - bn.utilization
          })
        }
      }
    }

    const hasFlip = diff.verdictChange !== undefined || diff.testFlips.length > 0
    const hasDrift =
      diff.utilizationDeltas.length > 0 ||
      diff.throughputDelta !== undefined ||
      diff.p99Delta !== undefined
    if (hasFlip) {
      flips.push(diff)
    } else if (hasDrift) {
      driftOnly.push(diff)
    } else {
      unchanged++
    }
  }

  return {
    flips,
    driftOnly,
    presenceChanges,
    unchanged,
    summary: {
      total: allKeys.size,
      flipped: flips.length,
      referenceRegressions,
      gamedNowPassing
    }
  }
}

function relativeThroughputMoved(from: number, to: number): boolean {
  return Math.abs(relative(from, to)) >= RELATIVE_DELTA_THRESHOLD
}

function scalarMoved(from: number | null, to: number | null): boolean {
  if (from === null || to === null) return from !== to
  return Math.abs(relative(from, to)) >= RELATIVE_DELTA_THRESHOLD
}

function safeDelta(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null
  return to - from
}
