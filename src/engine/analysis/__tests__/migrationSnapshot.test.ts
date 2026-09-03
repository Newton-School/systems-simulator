import { describe, expect, it } from 'vitest'
import {
  diffBankSnapshots,
  MIGRATION_SNAPSHOT_VERSION,
  type BankSnapshot,
  type CaseSnapshot,
  type RunMetrics
} from '../migrationSnapshot'

function run(over: Partial<RunMetrics> = {}): RunMetrics {
  return {
    caseId: 'c1',
    throughput: 1000,
    errorRate: 0,
    p99: 50,
    perNode: { db: { utilization: 0.5, p99: 40 } },
    ...over
  }
}

function snap(cases: CaseSnapshot[]): BankSnapshot {
  return { version: MIGRATION_SNAPSHOT_VERSION, generatedAt: 't', cases }
}

function caseSnap(over: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    questionId: 'q1',
    kind: 'reference',
    passed: true,
    tests: [{ id: 't1', name: 'db not saturated', passed: true }],
    runs: [run()],
    ...over
  }
}

describe('diffBankSnapshots', () => {
  it('reports an identical snapshot as fully unchanged', () => {
    const s = snap([caseSnap()])
    const report = diffBankSnapshots(s, s)
    expect(report.unchanged).toBe(1)
    expect(report.flips).toHaveLength(0)
    expect(report.driftOnly).toHaveLength(0)
  })

  it('flags a reference regression (pass → fail) as the dangerous direction', () => {
    const before = snap([caseSnap({ passed: true })])
    const after = snap([caseSnap({ passed: false })])
    const report = diffBankSnapshots(before, after)
    expect(report.flips).toHaveLength(1)
    expect(report.flips[0].verdictChange).toEqual({ from: true, to: false })
    expect(report.summary.referenceRegressions).toBe(1)
    expect(report.summary.gamedNowPassing).toBe(0)
  })

  it('flags a gamed solution that starts passing (fail → pass)', () => {
    const before = snap([caseSnap({ kind: 'gamed', passed: false })])
    const after = snap([caseSnap({ kind: 'gamed', passed: true })])
    const report = diffBankSnapshots(before, after)
    expect(report.summary.gamedNowPassing).toBe(1)
    expect(report.summary.referenceRegressions).toBe(0)
  })

  it('captures per-test flips even when the overall verdict holds', () => {
    const before = snap([
      caseSnap({ passed: false, tests: [{ id: 't1', name: 'x', passed: true }] })
    ])
    const after = snap([
      caseSnap({ passed: false, tests: [{ id: 't1', name: 'x', passed: false }] })
    ])
    const report = diffBankSnapshots(before, after)
    expect(report.flips).toHaveLength(1)
    expect(report.flips[0].testFlips).toEqual([{ id: 't1', name: 'x', from: true, to: false }])
  })

  it('classifies a utilization move (verdict held) as drift-only', () => {
    const before = snap([
      caseSnap({ runs: [run({ perNode: { db: { utilization: 0.5, p99: 40 } } })] })
    ])
    const after = snap([
      caseSnap({ runs: [run({ perNode: { db: { utilization: 0.9, p99: 40 } } })] })
    ])
    const report = diffBankSnapshots(before, after)
    expect(report.flips).toHaveLength(0)
    expect(report.driftOnly).toHaveLength(1)
    expect(report.driftOnly[0].utilizationDeltas[0]).toMatchObject({
      nodeId: 'db',
      from: 0.5,
      to: 0.9
    })
  })

  it('ignores utilization noise below the threshold', () => {
    const before = snap([
      caseSnap({ runs: [run({ perNode: { db: { utilization: 0.5, p99: 40 } } })] })
    ])
    const after = snap([
      caseSnap({ runs: [run({ perNode: { db: { utilization: 0.51, p99: 40 } } })] })
    ])
    const report = diffBankSnapshots(before, after)
    expect(report.unchanged).toBe(1)
    expect(report.driftOnly).toHaveLength(0)
  })

  it('detects a throughput move past the relative threshold', () => {
    const before = snap([caseSnap({ runs: [run({ throughput: 1000 })] })])
    const after = snap([caseSnap({ runs: [run({ throughput: 800 })] })]) // -20%
    const report = diffBankSnapshots(before, after)
    expect(report.driftOnly[0].throughputDelta).toMatchObject({ from: 1000, to: 800, delta: -200 })
  })

  it('reports bank membership changes', () => {
    const before = snap([caseSnap()])
    const after = snap([caseSnap(), caseSnap({ questionId: 'q2' })])
    const report = diffBankSnapshots(before, after)
    expect(report.presenceChanges).toHaveLength(1)
    expect(report.presenceChanges[0]).toMatchObject({ questionId: 'q2', presence: 'only-after' })
  })
})
