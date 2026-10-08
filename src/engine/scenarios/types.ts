/**
 * Chaos experiment vocabulary (#65).
 *
 * An experiment is a plain, serializable description: a steady state, an ordered
 * list of steps, and a final check. It never drives the engine interactively.
 * Instead it is *compiled* into an ordinary topology (scheduled `faults[]` plus a
 * workload spike) that the engine runs once, and the assertions are then
 * evaluated against the run's 1-second `latencyWindows`. That keeps experiments
 * deterministic, headless, and identical in the CLI, tests and the app worker.
 */

import type { NodeFailureMode } from '../nodes/failure'

/** What an assertion measures over its time window. */
export type ExperimentMetric =
  | 'error_rate'
  | 'latency_p50'
  | 'latency_p95'
  | 'latency_p99'
  | 'throughput'

export type ComparisonOperator = '<' | '<=' | '>' | '>='

/**
 * One measured claim. With `operator` + `value` it is an assertion that passes
 * or fails; without them it is an observation that is reported but never fails
 * the experiment (e.g. "origin load during the flush").
 *
 * Scope: system-wide (end-to-end, client-observed) unless `nodeId` is set, in
 * which case the node's own windows are used (its local queue + service latency,
 * successful passes per second, and failures that terminated at that node).
 */
export interface ExperimentAssertion {
  metric: ExperimentMetric
  operator?: ComparisonOperator
  value?: number
  nodeId?: string
  /** Short human label; generated from the fields when omitted. */
  label?: string
}

/** A fault to inject. `node-failure` (default) fails the node; `cache-flush` empties a cache. */
export interface ExperimentFault {
  targetId: string
  kind?: 'node-failure' | 'cache-flush'
  /** node-failure only. Defaults to the engine's chaos default (blackhole). */
  mode?: NodeFailureMode
  inFlightPolicy?: 'reset' | 'hang'
  recoveryPolicy?: 'resume' | 'reset'
  degradation?: { fraction: number; serviceTimeMultiplier: number }
  /**
   * node-failure: recover automatically after this long (otherwise a later
   * `restore` step, or never). cache-flush: how long a declared-rate cache misses
   * every arrival (derived-LRU caches re-warm from traffic instead).
   */
  durationMs?: number
}

export type ExperimentStep =
  | { type: 'wait'; durationMs: number; label?: string }
  | { type: 'inject'; fault: ExperimentFault; label?: string }
  | { type: 'restore'; targetId: string; label?: string }
  /** Multiply the workload's base RPS for a while (the engine's `spike` pattern). */
  | { type: 'traffic'; multiplier: number; durationMs: number; label?: string }
  /**
   * Check assertions over a window that ends at the current step time. The
   * window starts at the previous inject / restore / traffic / verify step,
   * or `windowMs` before now when given.
   */
  | { type: 'verify'; assertions: ExperimentAssertion[]; windowMs?: number; label?: string }

export interface ChaosExperimentDefinition {
  id: string
  name: string
  description?: string
  /** Transient discarded before anything is measured (becomes the run's warmup). */
  warmupMs: number
  /** Window right after warmup where the steady state must hold before any fault. */
  baselineMs: number
  steadyState: ExperimentAssertion[]
  steps: ExperimentStep[]
  /** Trailing window after the last step where the steady state must hold again (0 skips). */
  finalCheckMs: number
  /** Plain statements about what the engine does and does not model for this experiment. */
  notes?: string[]
}

export type CheckPhase = 'steady-state' | 'verify' | 'final'

/** A resolved, absolute-time check produced by compilation. */
export interface PlannedCheck {
  id: string
  phase: CheckPhase
  label: string
  /** Index into `definition.steps`, or null for the steady-state / final checks. */
  stepIndex: number | null
  fromMs: number
  toMs: number
  assertions: ExperimentAssertion[]
}

export interface PlannedTimelineEntry {
  stepIndex: number | null
  type: ExperimentStep['type'] | 'warmup' | 'steady-state' | 'final'
  atMs: number
  label: string
  detail?: string
}

/** The compiled form: what will run and what will be checked, all in absolute sim time. */
export interface ExperimentPlan {
  definition: ChaosExperimentDefinition
  durationMs: number
  warmupMs: number
  /** Time the first step runs (warmup + baseline). */
  stepsStartMs: number
  timeline: PlannedTimelineEntry[]
  checks: PlannedCheck[]
  /** Conflict resolutions and modelling notes, in plain language. */
  notes: string[]
}

export type AssertionStatus = 'pass' | 'fail' | 'no-data' | 'observed' | 'skipped'

export interface AssertionResult {
  assertion: ExperimentAssertion
  label: string
  status: AssertionStatus
  /** Measured value (rates as fractions, latency in ms, throughput in req/s), null when unmeasurable. */
  actual: number | null
  /** How many terminal requests the window held. */
  samples: number
  detail: string
}

export interface CheckResult {
  id: string
  phase: CheckPhase
  label: string
  stepIndex: number | null
  fromMs: number
  toMs: number
  status: 'pass' | 'fail' | 'skipped' | 'observed'
  assertions: AssertionResult[]
}

export interface ExperimentTimelineEntry extends PlannedTimelineEntry {
  result: 'pass' | 'fail' | 'executed' | 'skipped'
}

export interface ExperimentViolation {
  checkId: string
  stepIndex: number | null
  assertion: ExperimentAssertion
  label: string
  actual: number | null
}

export type ExperimentVerdict = 'passed' | 'failed' | 'not-stable' | 'inconclusive'

export interface ExperimentResult {
  experimentId: string
  name: string
  passed: boolean
  verdict: ExperimentVerdict
  /** One calm sentence explaining the verdict. */
  summary: string
  steadyStateHeld: boolean
  checks: CheckResult[]
  timeline: ExperimentTimelineEntry[]
  violations: ExperimentViolation[]
  notes: string[]
  durationMs: number
}
