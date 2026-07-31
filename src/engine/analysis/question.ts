import type {
  FaultSpec,
  GlobalConfig,
  TopologyJSON,
  WorkloadProfile
} from '../core/types'
import type { SimulationOutput } from './output'
import { evaluateSuite, type PreparedCase } from './evaluate'
import { gradeBatch, type GradedEvaluationBatch, type Rubric } from './rubric'
import type { SimulationVerdict } from './verdict'

/**
 * Gap-4 question-platform schemas (frozen decisions):
 *  1. These types live engine-side and are renderer-free — they depend only on
 *     engine/core/types + the grading modules. Django imports them via the CLI.
 *  2. `gradeAttempt` is pure and takes an injected `runTopology`, mirroring
 *     `evaluateSuite`, so it stays testable without spinning the real engine.
 *  3. `scaffold.topology` and `AttemptState.topology` are canonical engine
 *     TopologyJSON. The app bridges to/from canvas via the anti-corruption layer
 *     (topologyCanvasAdapter to open, useTopologySerializer to autosave/grade).
 *  4. A question's suite cases carry CONDITION overrides only (global/workload/
 *     faults) and NO per-case topology — the topology under test is the student's
 *     submission, which `gradeAttempt` injects as the base for every case.
 *  5. A QuestionPackage is self-contained (portable unit handed to the iframe).
 */

export const QUESTION_PACKAGE_VERSION = '1.0' as const

export type QuestionType =
  | 'fix'
  | 'build-budget'
  | 'optimize'
  | 'open-build'
  | 'scaling'
  | 'ha-chaos'
  | 'tradeoff'

export interface NFRTarget {
  metric: 'latency_p99' | 'latency_p50' | 'availability' | 'error_rate' | 'throughput'
  operator: '<' | '<=' | '>' | '>='
  value: number
  unit: 'ms' | 'percent' | 'req_per_sec' | 'nines'
  description: string
}

export interface ScaleParameters {
  dau?: number
  peakRps?: number
  /** Read-to-write ratio, e.g. 90 means 90% reads. */
  readWriteRatio?: number
  storageGb?: number
  retentionDays?: number
  growthRatePercent?: number
}

export interface QuestionPrompt {
  /** Human-readable problem statement (markdown). */
  text: string
  functionalRequirements: string[]
  nonFunctionalRequirements: NFRTarget[]
  scale: ScaleParameters
  additionalContext?: string
}

export interface QuestionScaffold {
  type: 'empty' | 'partial' | 'complete'
  /** Starting engine topology (omitted for empty scaffolds). */
  topology?: TopologyJSON
  lockedNodeIds?: string[]
  lockedEdgeIds?: string[]
  /** For 'optimize': the baseline verdict the student must beat. */
  baselineVerdict?: SimulationVerdict
}

export interface QuestionConstraints {
  allowedNodeTypes?: string[]
  forbiddenNodeTypes?: string[]
  maxNodeCount?: number
  maxBudget?: number
  maxTotalWorkers?: number
  canModifyScaffold: boolean
  canRemoveScaffoldNodes: boolean
}

/**
 * One grading condition. It carries only overrides — never a topology — because
 * the topology under test is the student's submission (see decision 4).
 */
export interface QuestionSuiteCase {
  id: string
  description?: string
  global?: Partial<GlobalConfig>
  workload?: Partial<WorkloadProfile>
  faults?: FaultSpec[]
}

export interface QuestionSuite {
  name: string
  cases: QuestionSuiteCase[]
  /** Whether the student may see the grading scenarios (false = hidden contest suite). */
  visibleToStudent: boolean
  /** Optional representative case the student CAN dry-run against. */
  dryRunCase?: QuestionSuiteCase
}

export interface QuestionPackage {
  version?: typeof QUESTION_PACKAGE_VERSION
  id: string
  title: string
  description?: string
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  tags?: string[]
  estimatedTimeMinutes?: number
  type: QuestionType
  prompt: QuestionPrompt
  scaffold: QuestionScaffold
  constraints: QuestionConstraints
  suite: QuestionSuite
  rubric: Rubric
  author?: string
  createdAt?: string
}

export type AttemptStatus = 'DRAFT' | 'AUTOSAVED' | 'SUBMITTED' | 'GRADING' | 'GRADED' | 'LOCKED'

export interface AttemptState {
  attemptId: string
  questionId: string
  /** The student's current engine topology (autosaved). */
  topology: TopologyJSON
  status: AttemptStatus
  startedAt: string
  lastSavedAt: string
  submittedAt?: string
  testRunCount: number
  lastDryRun?: {
    timestamp: string
    grade: AttemptGrade
  }
  grade?: {
    gradedAt: string
    result: AttemptGrade
  }
}

/** One flat pass/fail row for the Game Playground host — the collapsed boolean contract. */
export interface HostTest {
  id: string
  name: string
  passed: boolean
}

export interface HostContract {
  tests: HostTest[]
  totalTests: number
  passedTests: number
  allPassed: boolean
}

export interface AttemptGrade {
  /** The full graded batch (rich data — stays inside the simulator). */
  graded: GradedEvaluationBatch
  /** The collapsed boolean contract sent across the iframe seam to the host. */
  contract: HostContract
}

/** Applies a suite case's condition overrides on top of the student's topology. */
function applyCaseOverrides(base: TopologyJSON, testCase: QuestionSuiteCase): TopologyJSON {
  return {
    ...base,
    global: { ...base.global, ...(testCase.global ?? {}) },
    ...(testCase.workload
      ? { workload: { ...(base.workload ?? {}), ...testCase.workload } as WorkloadProfile }
      : {}),
    ...(testCase.faults ? { faults: testCase.faults } : {})
  }
}

/**
 * Collapses a graded batch to the boolean host contract. Every rubric check
 * across every ran case becomes one test row; a case that could not run becomes
 * a single failed row. `allPassed` is the question-level gate: all rows green.
 */
export function toHostContract(graded: GradedEvaluationBatch): HostContract {
  const tests: HostTest[] = []
  for (const entry of graded.cases) {
    if (entry.rubric) {
      for (const check of entry.rubric.checks) {
        tests.push({ id: `${entry.id}:${check.id}`, name: check.description, passed: check.passed })
      }
    } else {
      tests.push({ id: `${entry.id}:did-not-run`, name: `Case ${entry.id} could not run`, passed: false })
    }
  }
  const passedTests = tests.filter((test) => test.passed).length
  return {
    tests,
    totalTests: tests.length,
    passedTests,
    allPassed: tests.length > 0 && passedTests === tests.length
  }
}

/**
 * Grades a student's submitted topology against a question package: injects the
 * topology as the base for every suite case, applies each case's condition
 * overrides, runs the batch, grades with the package rubric, and collapses to the
 * host contract. Pure — the engine run is injected as `runTopology`.
 */
export function gradeAttempt(
  pkg: QuestionPackage,
  studentTopology: TopologyJSON,
  runTopology: (topology: TopologyJSON) => SimulationOutput
): AttemptGrade {
  const cases: PreparedCase[] = pkg.suite.cases.map((testCase) => ({
    id: testCase.id,
    topology: applyCaseOverrides(studentTopology, testCase)
  }))

  const batch = evaluateSuite(cases, runTopology, pkg.suite.name)
  const graded = gradeBatch(pkg.rubric, batch)
  return { graded, contract: toHostContract(graded) }
}
