import type { TopologyJSON } from '../core/types'
import type { EdgeFlowEvent } from '../core/events'
import type { SimulationOutput, TimeSeriesSnapshot } from '../analysis/output'
import type { AttemptCaseRun, AttemptGrade, QuestionPackage } from '../analysis/question'

// ─── Inbound (main thread → worker) ──────────────────────────────────────────

export interface RunMessage {
  type: 'run'
  payload: { topology: TopologyJSON }
}

/** Grade a student topology against a question package (runs the whole suite). */
export interface GradeMessage {
  type: 'grade'
  payload: { question: QuestionPackage; topology: TopologyJSON }
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

export interface ErrorMessage {
  type: 'error'
  payload: { message: string; stack?: string }
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
