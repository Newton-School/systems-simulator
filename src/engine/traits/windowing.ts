import type { ComponentNode, ComponentType } from '../core/types'
import type { NodeBehaviourTrait, NodeCapabilityModule, TraitStateStore } from './types'

export const WINDOWING_COMPONENT_TYPES = [
  'streaming-analytics'
] as const satisfies readonly ComponentType[]

const DEFAULT_WINDOW_MS = 1000
const CURRENT_WINDOW_KEY = 'windowing.currentCount'

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function currentCount(state: TraitStateStore | undefined): number {
  return state?.get<number>(CURRENT_WINDOW_KEY) ?? 0
}

/**
 * Processing-time tumbling windows — the first consumer of the `onTick` recurring
 * timer. Each request that arrives is accumulated into the open window
 * (`beforeArrival`); every `windowMs` the timer fires (`onTick`), "closes" the
 * window, emits the aggregate count, and resets — exactly how a windowed stream
 * operator produces one result per window on a schedule rather than per event.
 *
 * This is *processing-time* windowing (windows by arrival time). Event-time
 * windows, watermarks, and out-of-order/late-data handling are deliberately not
 * modeled — see `notModeled`.
 */
export const windowingTrait: NodeBehaviourTrait = {
  name: 'analytics.windowing',
  beforeArrival: ({ state }) => {
    state?.set(CURRENT_WINDOW_KEY, currentCount(state) + 1)
    return { action: 'continue', payload: { metricCounters: { windowedEvents: 1 } } }
  },
  tickIntervalMs: (node: ComponentNode) => asPositiveNumber(node.config?.['windowMs']),
  onTick: ({ state }) => {
    const count = currentCount(state)
    state?.set(CURRENT_WINDOW_KEY, 0)
    return {
      windowClosed: true,
      eventsInWindow: count,
      metricCounters: { windowsEmitted: 1, eventsAggregated: count }
    }
  }
}

export const windowingCapabilityModule: NodeCapabilityModule = {
  name: 'analytics.windowing',
  appliesTo: WINDOWING_COMPONENT_TYPES,
  hooks: windowingTrait,
  config: {
    sections: [
      {
        id: 'windowing',
        title: 'Windowing',
        note: 'Aggregates arriving events into fixed (tumbling) windows. Every window a result is emitted on a timer — one output per window, not per event. Processing-time windows.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.windowMs',
            type: 'input',
            inputType: 'number',
            label: 'Window size',
            unit: 'ms',
            min: 1,
            altitude: 'primary',
            placeholder: `Default ${DEFAULT_WINDOW_MS}ms`,
            why: 'The tumbling-window length; a window-close aggregate is emitted this often via the recurring timer.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: { counters: ['windowedEvents', 'windowsEmitted', 'eventsAggregated'] },
  honesty: {
    simulates: [
      'processing-time tumbling windows: events accumulate and a window-close aggregate emits every windowMs via the recurring timer'
    ],
    notModeled: [
      'event-time windows, watermarks and out-of-order/late-data handling, and sliding/session windows'
    ]
  }
}
