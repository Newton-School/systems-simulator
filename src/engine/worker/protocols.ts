import type { TopologyJSON } from '../core/types'
import type { EdgeFlowEvent } from '../core/events'
import type { SimulationOutput, TimeSeriesSnapshot } from '../analysis/output'
import type { AttemptCaseRun, AttemptGrade, QuestionPackage } from '../analysis/question'
import type { JustificationAnswer } from '../analysis/justification'
import type { ValidationError } from '../validation/validator'

/*
 * Worker protocol contract
 * ────────────────────────
 * Lifecycle: `run` → (`progress` | `snapshot` | `edge-flow-batch`)* → exactly one
 * terminal message, `complete` or a fatal `error`. The renderer terminates the
 * worker after the terminal message.
 *
 * Playback speed: `'max'` (the default) runs the engine as fast as possible in
 * chunks, exactly as before speed control existed, so results are unchanged. A
 * number is simulated milliseconds per wall-clock millisecond (1 = real time,
 * 2 = twice as fast): the worker paces chunks against simulated time. Speed only
 * changes WHEN events are processed, never which events or their outcome, so a
 * paced run produces the same output as a 'max' run. `set-speed` may be sent at
 * any time during a run (also while paused). The analytic (fluid) tier has no
 * event loop, so speed does not apply to it.
 *
 * Validation: `run` validates the topology with the shared validator before
 * building the engine. An invalid topology is answered with a fatal `error`
 * (`code: 'invalid-topology'`, `validationErrors` populated) and nothing runs.
 *
 * Stop: `stop` ends the run early WITH partial results. The worker finishes the
 * chunk in progress, then posts `complete` with `stopped: true` and the output
 * for every event processed up to that point (the UI shows these as a stopped
 * run). Stop while paused does the same. Stop with no run in progress is a
 * no-op (no message). To discard a run without results, terminate the worker.
 *
 * Saturation halt: when the engine's saturation guard halts the run, the worker
 * stops stepping and posts `complete` with `stopped: false`; the halt is reported
 * in `output.stopReason === 'saturation'` and `output.stoppedAtMs`.
 *
 * Errors: `recoverable: true` errors (a rejected command such as `step` while
 * running, or an invalid speed) leave the current run untouched. Any other
 * `error` is terminal.
 */

/** Simulated ms per wall-clock ms, or 'max' for as fast as possible (default). */
export type PlaybackSpeed = number | 'max'

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 'max'

/** True for 'max' or a finite, positive number. */
export function isValidPlaybackSpeed(speed: unknown): speed is PlaybackSpeed {
  return speed === 'max' || (typeof speed === 'number' && Number.isFinite(speed) && speed > 0)
}

// ─── Inbound (main thread → worker) ──────────────────────────────────────────

export interface RunMessage {
  type: 'run'
  payload: {
    topology: TopologyJSON
    /** Initial playback speed; defaults to 'max'. */
    speed?: PlaybackSpeed
  }
}

/** Change playback speed mid-run. */
export interface SetSpeedMessage {
  type: 'set-speed'
  payload: { speed: PlaybackSpeed }
}

/** Grade a student topology against a question package (runs the whole suite). */
export interface GradeMessage {
  type: 'grade'
  payload: {
    question: QuestionPackage
    topology: TopologyJSON
    justificationAnswers?: JustificationAnswer[]
  }
}

export interface PauseMessage {
  type: 'pause'
}

export interface ResumeMessage {
  type: 'resume'
}

export interface StopMessage {
  type: 'stop'
}

export interface StepMessage {
  type: 'step'
  payload: { count: number }
}

export type WorkerInboundMessage =
  | RunMessage
  | GradeMessage
  | PauseMessage
  | ResumeMessage
  | StopMessage
  | StepMessage
  | SetSpeedMessage

// ─── Outbound (worker → main thread) ─────────────────────────────────────────

export interface ProgressMessage {
  type: 'progress'
  payload: { percent: number; eventsProcessed: number }
}

export interface SnapshotMessage {
  type: 'snapshot'
  payload: { snapshot: TimeSeriesSnapshot }
}

export interface EdgeFlowBatchMessage {
  type: 'edge-flow-batch'
  payload: { events: EdgeFlowEvent[] }
}

export interface CompleteMessage {
  type: 'complete'
  payload: { output: SimulationOutput; stopped?: boolean }
}

export type WorkerErrorCode =
  | 'invalid-topology'
  | 'already-running'
  | 'not-loaded'
  | 'step-while-running'
  | 'invalid-speed'
  | 'engine-error'

export interface ErrorMessage {
  type: 'error'
  payload: {
    message: string
    stack?: string
    code?: WorkerErrorCode
    /** The run (if any) is unaffected; the renderer should not tear down. */
    recoverable?: boolean
    /** Present for `code: 'invalid-topology'`. */
    validationErrors?: ValidationError[]
  }
}

export interface GradeCompleteMessage {
  type: 'grade-complete'
  payload: { grade: AttemptGrade; cases: AttemptCaseRun[] }
}

export type WorkerOutboundMessage =
  | ProgressMessage
  | SnapshotMessage
  | EdgeFlowBatchMessage
  | CompleteMessage
  | GradeCompleteMessage
  | ErrorMessage
