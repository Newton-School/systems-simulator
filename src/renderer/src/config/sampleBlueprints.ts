import type { QuestionPackage } from '../../../engine/analysis/question'
import type { TopologyJSON } from '../../../engine/core/types'
import messageBrokerFanoutRaw from '../../../engine/__samples__/message-broker-fanout.json?raw'
import paymentIdempotencyDedupRaw from '../../../engine/__samples__/payment-idempotency-dedup.json?raw'
import storageProfileReadVsScanRaw from '../../../engine/__samples__/storage-profile-read-vs-scan.json?raw'

export interface SampleBlueprint {
  id: string
  title: string
  summary: string
  focus: string
  question: QuestionPackage
}

/**
 * Local design briefs reuse the question brief surface, but their scaffold is
 * authored as a canvas file because `loadFromData(...)` already accepts either a
 * canvas workspace or a TopologyJSON document. The cast keeps the local brief
 * config ergonomic without creating a second prompt/scaffold pipeline.
 */
function canvasScaffold(raw: string): TopologyJSON {
  return JSON.parse(raw) as unknown as TopologyJSON
}

function makeInvariantOnlyRubric(id: string, description: string): QuestionPackage['rubric'] {
  return {
    id,
    passThreshold: 1,
    checks: [
      {
        id: `${id}-invariants`,
        description,
        metric: 'invariantViolations.count',
        op: '==',
        value: 0
      }
    ]
  }
}

export const SAMPLE_BLUEPRINTS: SampleBlueprint[] = [
  {
    id: 'notifications-fanout',
    title: 'Notifications Fanout',
    summary:
      'Start from the requirements, not the boxes: one published event must reach several downstream consumers without turning the producer path synchronous.',
    focus: 'Delivery semantics: one-to-many fanout, async decoupling, and per-consumer capacity.',
    question: {
      version: '1.0',
      id: 'blueprint-notifications-fanout',
      title: 'Design a notification fanout pipeline',
      difficulty: 'intermediate',
      type: 'open-build',
      entryFormat: 'requirements-first',
      prompt: {
        text: 'A single publish request must trigger email delivery, mobile push, and analytics processing. Start from the scaffold, then refine the topology so one event reaches every downstream consumer without making the producer wait on the slowest worker.',
        functionalRequirements: [
          'Accept a published notification event',
          'Deliver each event to email, push, and analytics consumers',
          'Keep producer-side work decoupled from downstream consumer latency'
        ],
        nonFunctionalRequirements: [
          {
            metric: 'error_rate',
            operator: '<',
            value: 5,
            unit: 'percent',
            description: 'Keep delivery-side errors under 5%'
          },
          {
            metric: 'throughput',
            operator: '>=',
            value: 150,
            unit: 'req_per_sec',
            description: 'Sustain at least 150 published events per second'
          }
        ],
        scale: { peakRps: 2200 }
      },
      scaffold: {
        type: 'partial',
        topology: canvasScaffold(messageBrokerFanoutRaw)
      },
      constraints: {
        canModifyScaffold: true,
        canRemoveScaffoldNodes: true
      },
      suite: {
        name: 'fanout-blueprint-suite',
        visibleToStudent: false,
        dryRunCase: {
          id: 'baseline',
          description: 'Representative publish traffic'
        },
        cases: [
          {
            id: 'baseline',
            description: 'Representative publish traffic'
          }
        ]
      },
      rubric: makeInvariantOnlyRubric(
        'fanout-blueprint-rubric',
        'No invariant violations while refining the fanout topology'
      ),
      domains: ['resilience', 'compute'],
      concepts: ['async-decoupling', 'broadcast-fanout', 'consumer-capacity']
    }
  },
  {
    id: 'store-fit-routing',
    title: 'Store-Fit Routing',
    summary:
      'Use requirements to separate hot point reads from heavy export scans instead of pretending one datastore is equally good at both.',
    focus:
      'State semantics: access-pattern-aware storage, routing by request type, and visible store-fit tradeoffs.',
    question: {
      version: '1.0',
      id: 'blueprint-store-fit-routing',
      title: 'Design a store-fit read and export path',
      difficulty: 'intermediate',
      type: 'tradeoff',
      entryFormat: 'requirements-first',
      prompt: {
        text: 'This service handles two very different access patterns: point reads from a hot dashboard and periodic export scans for analytics. Start from the scaffold and refine the design so those workloads stop fighting over the same storage semantics.',
        functionalRequirements: [
          'Serve point-read requests with low latency',
          'Run periodic export scans without collapsing the hot path',
          'Route the two request classes to storage backends that fit them'
        ],
        nonFunctionalRequirements: [
          {
            metric: 'latency_p99',
            operator: '<',
            value: 80,
            unit: 'ms',
            description: 'Keep point-read p99 latency under 80ms'
          },
          {
            metric: 'error_rate',
            operator: '<',
            value: 5,
            unit: 'percent',
            description: 'Keep end-to-end errors under 5%'
          }
        ],
        scale: { peakRps: 1800, readWriteRatio: 85 }
      },
      scaffold: {
        type: 'partial',
        topology: canvasScaffold(storageProfileReadVsScanRaw)
      },
      constraints: {
        canModifyScaffold: true,
        canRemoveScaffoldNodes: true
      },
      suite: {
        name: 'store-fit-blueprint-suite',
        visibleToStudent: false,
        dryRunCase: {
          id: 'baseline',
          description: 'Representative mixed traffic'
        },
        cases: [
          {
            id: 'baseline',
            description: 'Representative mixed traffic'
          }
        ]
      },
      rubric: makeInvariantOnlyRubric(
        'store-fit-blueprint-rubric',
        'No invariant violations while refining storage-path routing'
      ),
      domains: ['storage', 'compute'],
      concepts: ['store-fit', 'request-class-routing', 'storage-profile']
    }
  },
  {
    id: 'payment-idempotency-guard',
    title: 'Payment Idempotency Guard',
    summary:
      'Treat retried writes as a correctness problem first: every payment attempt must pass through a keyed guard before it can hit the ledger path.',
    focus:
      'Requirements-first correctness: retried writes, guarded paths, and duplicate suppression before downstream side effects.',
    question: {
      version: '1.0',
      id: 'blueprint-payment-idempotency-guard',
      title: 'Design a payment write path with idempotency guarding',
      difficulty: 'advanced',
      type: 'tradeoff',
      entryFormat: 'requirements-first',
      prompt: {
        text: 'This payment path receives retried client requests and must not double-apply downstream writes. Start from the scaffold and refine the guarded path so duplicate keys stop at the idempotency layer before they reach the ledger-facing store.',
        functionalRequirements: [
          'Accept payment write requests from the client path',
          'Ensure duplicate retries do not reach the downstream ledger path twice',
          'Keep the idempotency guard explicitly on the write path instead of hiding it in prose'
        ],
        nonFunctionalRequirements: [
          {
            metric: 'latency_p99',
            operator: '<',
            value: 120,
            unit: 'ms',
            description: 'Keep guarded write p99 latency under 120ms'
          },
          {
            metric: 'error_rate',
            operator: '<',
            value: 5,
            unit: 'percent',
            description: 'Keep end-to-end errors under 5%'
          }
        ],
        scale: { peakRps: 800 }
      },
      scaffold: {
        type: 'partial',
        topology: canvasScaffold(paymentIdempotencyDedupRaw)
      },
      constraints: {
        canModifyScaffold: true,
        canRemoveScaffoldNodes: true
      },
      suite: {
        name: 'payment-idempotency-blueprint-suite',
        visibleToStudent: false,
        dryRunCase: {
          id: 'baseline',
          description: 'Representative retried payment traffic'
        },
        cases: [
          {
            id: 'baseline',
            description: 'Representative retried payment traffic'
          }
        ]
      },
      rubric: makeInvariantOnlyRubric(
        'payment-idempotency-blueprint-rubric',
        'No invariant violations while refining the guarded payment write path'
      ),
      domains: ['storage', 'resilience'],
      concepts: ['idempotency-dedup', 'guarded-write-path', 'retried-writes']
    }
  }
]
