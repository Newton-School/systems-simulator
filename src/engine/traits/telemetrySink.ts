import { msToMicro } from '../core/time'
import type { ComponentNode, ComponentType } from '../core/types'
import type { CanvasNodeDataV2 } from '../catalog/nodeSpecTypes'
import type {
  BeforeArrivalDecision,
  NodeBehaviourTrait,
  NodeCapabilityModule,
  TraitStateStore
} from './types'

/** Log / metric / trace collectors: off the request path, they drop when overloaded. */
export const TELEMETRY_SINK_COMPONENT_TYPES = [
  'metrics-store',
  'centralized-logging',
  'distributed-tracing',
  'alerting-hook'
] as const satisfies readonly ComponentType[]

const INGEST_WINDOW_MS = 1000
const INGEST_LOG_KEY = 'telemetrySink.ingestLog'

function readSampleRate(config: Record<string, unknown> | undefined): number | null {
  const value = config?.['telemetrySampleRate']
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
}

function readIngestRps(config: Record<string, unknown> | undefined): number | null {
  const value = config?.['telemetryIngestRps']
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function isTelemetrySinkEnabled(node: Pick<ComponentNode, 'config'>): boolean {
  return node.config?.['telemetryAsyncIngest'] === true
}

function ingestLog(state: TraitStateStore | undefined): bigint[] {
  const existing = state?.get<bigint[]>(INGEST_LOG_KEY)
  if (existing) return existing
  const created: bigint[] = []
  state?.set(INGEST_LOG_KEY, created)
  return created
}

function dropped(counter: string): BeforeArrivalDecision {
  // The event is gone, but the caller never waited on it: complete the
  // fire-and-forget export here instead of failing a user request.
  return {
    action: 'handled',
    latencyUs: 0n,
    payload: {
      telemetryDecision: 'dropped',
      notServed: true,
      metricCounters: { telemetryOffered: 1, telemetryDropped: 1, [counter]: 1 }
    }
  }
}

/**
 * Fire-and-forget telemetry ingest. Exporters (OTel SDKs, log shippers, metric
 * agents) send asynchronously through a bounded buffer; when the collector
 * cannot keep up, events are dropped and the application request is
 * unaffected. With this on:
 *
 *   1. head sampling: only `telemetrySampleRate` of events are exported at all
 *      (the rest never reach the collector's queue);
 *   2. an ingest ceiling: past `telemetryIngestRps` (rolling 1s window), events
 *      are dropped, like a vendor intake limit or a collector's rate limiter;
 *   3. a full buffer: when the collector's queue (its admission K) is full the
 *      event is dropped instead of rejected.
 *
 * Every drop is measured (`telemetryDropped`) and completes the export branch,
 * so dropped telemetry never shows up as a failed user request. Off by default:
 * without it the collector stays a plain queue, as before.
 */
export const telemetrySinkTrait: NodeBehaviourTrait = {
  name: 'observability.telemetry-sink',
  isEnabledFor: isTelemetrySinkEnabled,
  beforeArrival: ({ node, clock, state, random, nodeState }): BeforeArrivalDecision => {
    const sampleRate = readSampleRate(node.config)
    if (sampleRate !== null && sampleRate < 1 && (random?.() ?? 0) >= sampleRate) {
      return {
        action: 'handled',
        latencyUs: 0n,
        payload: {
          telemetryDecision: 'sampled-out',
          notServed: true,
          metricCounters: { telemetrySampledOut: 1 }
        }
      }
    }

    const ingestRps = readIngestRps(node.config)
    if (ingestRps !== null) {
      const log = ingestLog(state)
      const cutoff = clock - msToMicro(INGEST_WINDOW_MS)
      let write = 0
      for (let read = 0; read < log.length; read++) {
        if (log[read] > cutoff) log[write++] = log[read]
      }
      log.length = write
      if (log.length >= ingestRps * (INGEST_WINDOW_MS / 1000)) {
        return dropped('telemetryDroppedOverIngest')
      }
      log.push(clock)
    }

    const capacity = nodeState?.systemCapacity
    if (capacity !== undefined && nodeState && nodeState.totalInSystem >= capacity) {
      return dropped('telemetryDroppedBufferFull')
    }

    return {
      action: 'continue',
      payload: {
        telemetryDecision: 'ingested',
        metricCounters: { telemetryOffered: 1, telemetryIngested: 1 }
      }
    }
  }
}

function enabled(data: CanvasNodeDataV2): boolean {
  return data.sim?.telemetryAsyncIngest === true
}

export const telemetrySinkCapabilityModule: NodeCapabilityModule = {
  name: 'observability.telemetry-sink',
  appliesTo: TELEMETRY_SINK_COMPONENT_TYPES,
  hooks: telemetrySinkTrait,
  config: {
    sections: [
      {
        id: 'telemetry-sink',
        title: 'Telemetry Ingest',
        note: (data) =>
          enabled(data)
            ? 'Fire-and-forget: events past the ingest ceiling or a full buffer are dropped and counted, never returned to the caller as errors. Unsampled events are not exported at all.'
            : 'Off: the collector is a plain queue, so a full collector rejects events as failures. Turn on fire-and-forget ingest to drop them instead, the way telemetry exporters do.',
        noteTone: 'info',
        fields: [
          {
            path: 'sim.telemetryAsyncIngest',
            type: 'boolean',
            label: 'Fire-and-forget ingest',
            altitude: 'primary',
            why: 'Exporters buffer and send asynchronously; when the collector falls behind they drop events rather than slowing or failing the application.'
          },
          {
            path: 'sim.telemetryIngestRps',
            type: 'input',
            inputType: 'number',
            label: 'Ingest ceiling',
            unit: 'events/s',
            min: 0,
            altitude: 'primary',
            optional: true,
            visible: enabled,
            why: 'Most events per second the pipeline accepts (a vendor intake limit or collector rate limit). Events past it are dropped.'
          },
          {
            path: 'sim.telemetrySampleRate',
            type: 'input',
            inputType: 'number',
            label: 'Sample rate',
            unit: 'fraction',
            min: 0,
            max: 1,
            step: 0.01,
            altitude: 'primary',
            optional: true,
            visible: enabled,
            placeholder: '1 (export everything)',
            why: 'Head sampling: the share of events exported at all. Lower cuts collector load and cost, at the price of visibility.'
          }
        ]
      }
    ]
  },
  defaults: [],
  metrics: {
    counters: [
      'telemetryOffered',
      'telemetryIngested',
      'telemetryDropped',
      'telemetryDroppedOverIngest',
      'telemetryDroppedBufferFull',
      'telemetrySampledOut'
    ]
  },
  honesty: {
    simulates: [
      'fire-and-forget ingest: drops past an events/s ceiling or a full collector buffer, measured and never surfaced as caller errors',
      'head sampling that keeps unexported events off the collector'
    ],
    notModeled: [
      'tail-based sampling, batching and compression in the exporter',
      'retention, indexing, cardinality and query cost',
      'unsampled events are still carried across the edge to the collector (the drop happens on arrival)'
    ]
  }
}
