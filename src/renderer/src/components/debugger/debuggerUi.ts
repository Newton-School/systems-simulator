import type { LifecycleState, RequestLifecycle } from './requestLifecycle'

export interface DebugViewProps {
  lifecycle: RequestLifecycle
  stepIndex: number
  onStep: (index: number) => void
  labelFor: (id: string) => string
}

export type VisualState = 'default' | 'done' | 'current' | 'failed'

export function phaseVisualState(
  lifecycle: RequestLifecycle,
  phaseIndex: number,
  stepIndex: number
): VisualState {
  const step = lifecycle.steps[stepIndex]
  if (!step) return 'default'
  if (phaseIndex === step.phaseIndex) return step.failed ? 'failed' : 'current'
  return phaseIndex < step.phaseIndex ? 'done' : 'default'
}

export function stepVisualState(
  lifecycle: RequestLifecycle,
  index: number,
  stepIndex: number
): VisualState {
  if (index === stepIndex) return lifecycle.steps[index]?.failed ? 'failed' : 'current'
  return index < stepIndex ? 'done' : 'default'
}

export const VISUAL_CARD_CLASS: Record<VisualState, string> = {
  default: 'border-nss-border bg-nss-surface',
  done: 'border-nss-success/50 bg-nss-success/5',
  current: 'border-nss-primary bg-nss-primary/10 shadow-md -translate-y-0.5',
  failed: 'border-nss-danger bg-nss-danger/10 shadow-md -translate-y-0.5'
}

export const VISUAL_DOT_CLASS: Record<VisualState, string> = {
  default: 'bg-nss-border',
  done: 'bg-nss-success',
  current: 'bg-nss-primary ring-4 ring-nss-primary/25',
  failed: 'bg-nss-danger ring-4 ring-nss-danger/25'
}

export const STATE_LABEL: Record<LifecycleState, string> = {
  generated: 'Generated',
  'in-flight': 'In flight',
  arrived: 'Arrived',
  queued: 'Queued',
  processing: 'Processing',
  routing: 'Routing',
  held: 'Held',
  completed: 'Completed',
  rejected: 'Rejected',
  'timed-out': 'Timed out'
}

/** Engine handler behind each state, for the state machine and stack frames. */
export const STATE_HANDLER: Record<LifecycleState, string> = {
  generated: 'handleRequestGenerated',
  'in-flight': 'enqueueEdgeTransfer',
  arrived: 'handleRequestArrival',
  queued: 'GGcKNode.handleArrival -> queued',
  processing: 'GGcKNode.startProcessing',
  routing: 'handleProcessingComplete -> resolveTarget',
  held: 'GGcKNode.handleArrival -> held',
  completed: 'handleRequestComplete',
  rejected: 'handleRequestRejected',
  'timed-out': 'handleRequestTimeout'
}

export function statusTone(status: RequestLifecycle['status']): string {
  if (status === 'success') return 'text-nss-success bg-nss-success/10 border-nss-success/30'
  if (status === 'timeout') return 'text-nss-warning bg-nss-warning/10 border-nss-warning/30'
  if (status === 'in-flight') return 'text-nss-muted bg-nss-panel border-nss-border'
  return 'text-nss-danger bg-nss-danger/10 border-nss-danger/30'
}
