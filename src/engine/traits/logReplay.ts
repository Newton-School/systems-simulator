import type { ComponentType } from '../core/types'
import { SERVICE_TIME_LATENCY_PENALTY_MS_KEY } from './serviceTimeOverride'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const LOG_REPLAY_COMPONENT_TYPES = [
  'event-sourcing-store'
] as const satisfies readonly ComponentType[]

const DEFAULT_REPLAY_COST_PER_EVENT_MS = 0.1
const EVENT_COUNT_STATE_KEY = 'logReplay.eventCount'

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function getEventCount(state: TraitStateStore | undefined): number {
  return state?.get<number>(EVENT_COUNT_STATE_KEY) ?? 0
}

function setEventCount(state: TraitStateStore | undefined, value: number): void {
  state?.set(EVENT_COUNT_STATE_KEY, value)
}

/**
 * Event-sourcing replay cost. An append-only store rebuilds state by replaying
 * the log, so a read gets slower as the log grows — unless a snapshot bounds how
 * far back you replay. Writes append (growing the log); reads pay
 * `replayCostPerEventMs × eventsSinceLastSnapshot`. Makes snapshot strategy a
 * real, gradeable decision instead of a footnote.
 */
export const logReplayTrait: NodeBehaviourTrait = {
  name: 'storage.log-replay',
  beforeArrival: ({ node, request, state }) => {
    const replayCostPerEventMs =
      asPositiveNumber(node.config?.['replayCostPerEventMs']) ?? DEFAULT_REPLAY_COST_PER_EVENT_MS
    const snapshotEvery = asPositiveNumber(node.config?.['snapshotEvery'])

    // A write appends to the log; it does not pay a replay cost.
    if (request.type === 'write') {
      setEventCount(state, getEventCount(state) + 1)
      return {
        action: 'continue',
        payload: { logReplayDecision: 'append', metricCounters: { logAppends: 1 } }
      }
    }

    // A read rebuilds state: replay everything since the last snapshot boundary.
    const total = getEventCount(state)
    const eventsToReplay =
      snapshotEvery !== null && snapshotEvery > 0 ? total % Math.round(snapshotEvery) : total
    const penaltyMs = replayCostPerEventMs * eventsToReplay
    if (penaltyMs > 0) {
      const existing =
        typeof request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] === 'number'
          ? (request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] as number)
          : 0
      request.metadata[SERVICE_TIME_LATENCY_PENALTY_MS_KEY] = existing + penaltyMs
    }
    return {
      action: 'continue',
      payload: {
        logReplayDecision: 'replay',
        eventsReplayed: eventsToReplay,
        replayMs: penaltyMs,
        metricCounters: { logReplays: 1 }
      }
    }
  }
}

export const logReplayCapabilityModule: NodeCapabilityModule = {
  name: 'storage.log-replay',
  appliesTo: LOG_REPLAY_COMPONENT_TYPES,
  hooks: logReplayTrait,
  config: {
    sections: [
      {
        id: 'log-replay',
        title: 'Log Replay',
        note: 'Reads rebuild state by replaying the event log, so they slow as the log grows. A snapshot bounds how many events are replayed. Makes snapshot cadence a real decision.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.replayCostPerEventMs',
            type: 'input',
            inputType: 'number',
            label: 'Replay cost / event',
            unit: 'ms',
            min: 0,
            step: 0.01,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_REPLAY_COST_PER_EVENT_MS}ms`,
            why: 'Time to replay one event when rebuilding state on a read.'
          },
          {
            path: 'sim.snapshotEvery',
            type: 'input',
            inputType: 'number',
            label: 'Snapshot every',
            unit: 'events',
            min: 1,
            altitude: 'primary',
            why: 'Take a snapshot every N events; a read then replays only events since the last snapshot. Leave empty to replay the whole log.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['logAppends', 'logReplays'] },
  honesty: {
    simulates: [
      'read latency proportional to events-since-snapshot, growing with an append-only log'
    ],
    notModeled: ['snapshot creation cost, compaction, or projection-specific replay paths']
  }
}
