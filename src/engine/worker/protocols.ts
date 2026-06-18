import type { TopologyJSON } from '../core/types'
import type { SimulationOutput, TimeSeriesSnapshot } from '../analysis/output'

// ─── Inbound (main thread → worker) ──────────────────────────────────────────

export interface RunMessage {
  type: 'run'
  payload: { topology: TopologyJSON }
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

export interface CompleteMessage {
  type: 'complete'
  payload: { output: SimulationOutput; stopped?: boolean }
}

export interface ErrorMessage {
  type: 'error'
  payload: { message: string; stack?: string }
}

export type WorkerOutboundMessage =
  | ProgressMessage
  | SnapshotMessage
  | CompleteMessage
  | ErrorMessage
