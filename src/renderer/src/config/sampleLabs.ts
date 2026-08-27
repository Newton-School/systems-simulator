import type { QuestionPackage } from '../../../engine/analysis/question'
import type { TopologyJSON } from '../../../engine/core/types'
import messageBrokerFanoutRaw from '../../../engine/__samples__/message-broker-fanout.json?raw'
import paymentIdempotencyDedupRaw from '../../../engine/__samples__/payment-idempotency-dedup.json?raw'
import storageProfileReadVsScanRaw from '../../../engine/__samples__/storage-profile-read-vs-scan.json?raw'

export interface SampleLab {
  id: string
  title: string
  summary: string
  focus: string
  guide: string
  question: QuestionPackage
}

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

function makeLockedLabQuestion(config: {
  id: string
  title: string
  text: string
  guide: string
  topology: TopologyJSON
  concepts: string[]
  domains: QuestionPackage['domains']
  scale?: QuestionPackage['prompt']['scale']
  nfrs: QuestionPackage['prompt']['nonFunctionalRequirements']
}): QuestionPackage {
  return {
    version: '1.0',
    id: config.id,
    title: config.title,
    difficulty: 'intermediate',
    type: 'tradeoff',
    entryFormat: 'locked-lab',
    tags: ['lab'],
    estimatedTimeMinutes: 15,
    prompt: {
      text: config.text,
      functionalRequirements: [
        'Start from the supplied topology rather than a blank canvas',
        'Change configuration, not the graph structure',
        'Run the simulator and explain the observed tradeoffs'
      ],
      nonFunctionalRequirements: config.nfrs,
      scale: config.scale ?? { peakRps: 1000 },
      additionalContext: config.guide
    },
    scaffold: {
      type: 'complete',
      topology: config.topology
    },
    constraints: {
      allowedNodeTypes: [],
      canModifyScaffold: false,
      canRemoveScaffoldNodes: false
    },
    suite: {
      name: `${config.id}-lab-suite`,
      visibleToStudent: false,
      dryRunCase: {
        id: 'lab-baseline',
        description: 'Representative traffic for the guided lab'
      },
      cases: [
        {
          id: 'lab-baseline',
          description: 'Representative traffic for the guided lab'
        }
      ]
    },
    rubric: makeInvariantOnlyRubric(
      `${config.id}-rubric`,
      'The lab topology should remain structurally valid while you tune its behavior.'
    ),
    domains: config.domains,
    concepts: config.concepts
  }
}

export const SAMPLE_LABS: SampleLab[] = [
  {
    id: 'fanout-delivery-lab',
    title: 'Fanout Delivery Lab',
    summary: 'Explore how one published event fans out to multiple downstream consumers.',
    focus: 'Delivery semantics, async decoupling, and per-consumer saturation.',
    guide:
      '1. Run the lab once and inspect the worker metrics for each downstream consumer.\n2. Change broker and worker settings in the properties panel.\n3. Re-run and compare how delivery throughput and queue pressure shift across the branches.',
    question: makeLockedLabQuestion({
      id: 'lab-fanout-delivery',
      title: 'Fanout Delivery Lab',
      text: 'Use the locked topology to study how asynchronous broadcast fanout changes delivery behavior downstream.',
      guide:
        'Keep the topology fixed. Focus on the broker and consumer properties, then use the bottom tray to compare throughput, saturation, and failures after each run.',
      topology: canvasScaffold(messageBrokerFanoutRaw),
      domains: ['resilience', 'compute'],
      concepts: ['broadcast-fanout', 'async-decoupling', 'consumer-capacity'],
      scale: { peakRps: 2200 },
      nfrs: [
        {
          metric: 'throughput',
          operator: '>=',
          value: 150,
          unit: 'req_per_sec',
          description: 'Keep downstream delivery throughput above 150 req/s'
        }
      ]
    })
  },
  {
    id: 'store-fit-lab',
    title: 'Store-Fit Routing Lab',
    summary: 'Contrast hot point reads with heavy export scans on a fixed topology.',
    focus: 'State semantics, request-class routing, and storage-profile tradeoffs.',
    guide:
      '1. Observe the baseline latency gap between the hot path and the export path.\n2. Tune storage-related properties without changing the topology.\n3. Re-run and use the bottom tray to see which path improved and which tradeoff got worse.',
    question: makeLockedLabQuestion({
      id: 'lab-store-fit-routing',
      title: 'Store-Fit Routing Lab',
      text: 'Use the locked topology to explore how different access patterns prefer different storage semantics.',
      guide:
        'Do not redraw the architecture. Adjust only the storage-path behavior, then inspect latency and error shifts between point reads and export scans.',
      topology: canvasScaffold(storageProfileReadVsScanRaw),
      domains: ['storage', 'compute'],
      concepts: ['store-fit', 'request-class-routing', 'storage-profile'],
      scale: { peakRps: 1800, readWriteRatio: 85 },
      nfrs: [
        {
          metric: 'latency_p99',
          operator: '<',
          value: 80,
          unit: 'ms',
          description: 'Keep point-read p99 latency under 80ms'
        }
      ]
    })
  },
  {
    id: 'idempotency-lab',
    title: 'Idempotency Guard Lab',
    summary: 'Study how retried writes are absorbed before they reach the ledger path.',
    focus: 'Correctness-first write paths, duplicate suppression, and guarded side effects.',
    guide:
      '1. Run the baseline and inspect the guarded write path.\n2. Tune the idempotency layer and downstream store behavior.\n3. Re-run and verify that retries stay suppressed before they hit the ledger path.',
    question: makeLockedLabQuestion({
      id: 'lab-idempotency-guard',
      title: 'Idempotency Guard Lab',
      text: 'Use the locked topology to understand how an explicit idempotency guard protects a write path from duplicate retries.',
      guide:
        'Keep the graph fixed. Change only write-path properties and then inspect whether duplicate suppression still happens before the ledger-facing store.',
      topology: canvasScaffold(paymentIdempotencyDedupRaw),
      domains: ['correctness', 'storage'],
      concepts: ['idempotency', 'duplicate-suppression', 'guarded-write-path'],
      scale: { peakRps: 800 },
      nfrs: [
        {
          metric: 'latency_p99',
          operator: '<',
          value: 120,
          unit: 'ms',
          description: 'Keep guarded write p99 latency under 120ms'
        }
      ]
    })
  }
]
