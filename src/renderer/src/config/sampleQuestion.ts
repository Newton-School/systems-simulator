import type { QuestionPackage } from '../../../engine/analysis/question'

export const SAMPLE_QUESTION: QuestionPackage = {
  version: '1.0',
  id: 'order-platform-open-build',
  title: 'Design an order-processing platform',
  difficulty: 'intermediate',
  type: 'open-build',
  prompt: {
    text: 'Design the backend for an e-commerce order platform. It must stay responsive and low-error under both steady and peak load. Build your topology on the canvas, then Submit.',
    functionalRequirements: [
      'Accept order-create requests',
      'Look up catalog and inventory',
      'Persist orders durably'
    ],
    nonFunctionalRequirements: [
      {
        metric: 'error_rate',
        operator: '<',
        value: 10,
        unit: 'percent',
        description: 'Error rate under 10%'
      },
      {
        metric: 'throughput',
        operator: '>=',
        value: 100,
        unit: 'req_per_sec',
        description: 'Sustains at least 100 req/s'
      }
    ],
    scale: { peakRps: 1000, readWriteRatio: 80 }
  },
  scaffold: { type: 'empty' },
  constraints: { canModifyScaffold: true, canRemoveScaffoldNodes: true },
  suite: {
    name: 'order-platform-grading',
    visibleToStudent: false,
    cases: [
      { id: 'baseline', description: 'Steady-state load.' },
      {
        id: 'peak-load',
        description: 'Peak surge on a fresh seed.',
        global: { seed: 'order-platform-peak-1' },
        workload: { baseRps: 1000 }
      }
    ],
    dryRunCase: { id: 'dry-run', description: 'Quick learner-side dry run.', workload: { baseRps: 200 } }
  },
  rubric: {
    id: 'order-platform-slo',
    passThreshold: 1,
    checks: [
      {
        id: 'error-rate',
        description: 'Error rate under 10%',
        metric: 'summary.errorRate',
        op: '<',
        value: 0.1,
        points: 2
      },
      {
        id: 'throughput',
        description: 'Sustains at least 100 req/s',
        metric: 'summary.throughput',
        op: '>=',
        value: 100
      },
      {
        id: 'no-invariant-violations',
        description: 'No invariant violations',
        metric: 'invariantViolations.count',
        op: '==',
        value: 0
      },
      {
        id: 'node-saturation',
        description: 'No node pinned at full saturation',
        metric: 'perNode.maxUtilization',
        op: '<',
        value: 1
      }
    ]
  }
}
