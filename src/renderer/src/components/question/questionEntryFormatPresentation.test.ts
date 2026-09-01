import { describe, expect, it } from 'vitest'
import type { QuestionPackage } from '../../../../engine/analysis/question'
import type { SimulationVerdict } from '../../../../engine/analysis/verdict'
import {
  buildQuestionEntryFormatPresentation,
  buildQuestionWorkflowTracker
} from './questionEntryFormatPresentationModel'

function baselineVerdict(): SimulationVerdict {
  return {
    version: '1.0',
    meta: {
      seed: 'seed',
      simulationDurationMs: 60_000,
      warmupDurationMs: 5_000,
      eventsProcessed: 1000,
      reproducible: true
    },
    summary: {
      totalRequests: 1000,
      postWarmupTotalRequests: 900,
      successfulRequests: 850,
      postWarmupSuccessfulRequests: 800,
      failedRequests: 150,
      postWarmupFailedRequests: 100,
      rejectedRequests: 20,
      timedOutRequests: 30,
      connectionResetRequests: 10,
      throughput: 145.4,
      errorRate: 0.072,
      latency: {
        p50: 35,
        p90: 110,
        p95: 140,
        p99: 180,
        min: 10,
        max: 240,
        mean: 52
      }
    },
    perNode: {},
    reservations: { commits: 0, conflicts: 0, oversells: 0 },
    locks: { acquires: 0, contentions: 0, keyless: 0 },
    retries: { attempts: 0, budgetExhausted: 0 },
    rateLimit: { admitted: 0, rejected: 0, breaches: 0, keyless: 0 },
    sloTargetCount: 0,
    sloBreaches: [],
    invariantViolations: [],
    conservation: [],
    littlesLaw: []
  }
}

function baseQuestion(): QuestionPackage {
  return {
    version: '1.0',
    id: 'q-entry-format',
    title: 'Entry format question',
    difficulty: 'intermediate',
    type: 'open-build',
    prompt: {
      text: 'Design the system.',
      functionalRequirements: ['Serve reads', 'Persist writes'],
      nonFunctionalRequirements: [
        {
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms',
          description: 'p99 under 100ms'
        }
      ],
      scale: {
        peakRps: 2200,
        readWriteRatio: 90
      }
    },
    scaffold: {
      type: 'partial',
      topology: {
        id: 'topology',
        name: 'Topology',
        version: '2.0.0',
        global: {
          seed: 'seed',
          simulationDuration: 1000,
          warmupDuration: 0,
          timeResolution: 'millisecond',
          defaultTimeout: 1000
        },
        nodes: [
          {
            id: 'n1',
            type: 'api-endpoint',
            category: 'compute',
            role: 'source',
            label: 'Client',
            position: { x: 0, y: 0 }
          },
          {
            id: 'n2',
            type: 'microservice',
            category: 'compute',
            role: 'processor',
            label: 'API',
            position: { x: 120, y: 0 },
            queue: { workers: 1, capacity: 10, discipline: 'fifo' },
            processing: {
              distribution: { type: 'constant', value: 5 },
              timeout: 1000
            }
          }
        ],
        edges: [
          {
            id: 'e1',
            source: 'n1',
            target: 'n2',
            mode: 'synchronous',
            protocol: 'https',
            latency: {
              distribution: { type: 'constant', value: 1 },
              pathType: 'same-dc'
            },
            bandwidth: 1000,
            maxConcurrentRequests: 100,
            packetLossRate: 0,
            errorRate: 0
          }
        ]
      } as QuestionPackage['scaffold']['topology']
    },
    constraints: {
      canModifyScaffold: true,
      canRemoveScaffoldNodes: true
    },
    suite: {
      name: 'suite',
      visibleToStudent: false,
      cases: [{ id: 'baseline' }]
    },
    rubric: {
      checks: [
        {
          id: 'p99',
          description: 'Keep p99 low',
          metric: 'summary.latency.p99',
          op: '<',
          value: 100
        }
      ]
    }
  }
}

describe('buildQuestionEntryFormatPresentation', () => {
  it('builds requirements-first guidance from FR/NFR/scale context', () => {
    const presentation = buildQuestionEntryFormatPresentation({
      ...baseQuestion(),
      entryFormat: 'requirements-first'
    })

    expect(presentation.title).toBe('Start from the requirements')
    expect(presentation.guideTitle).toBe('Requirements-First Workflow')
    expect(presentation.highlights).toEqual(
      expect.arrayContaining([
        { label: 'FRs', value: '2' },
        { label: 'NFRs', value: '1' },
        { label: 'Peak RPS', value: '2,200 rps' }
      ])
    )
  })

  it('surfaces authored baseline verdict metrics for optimize shells', () => {
    const presentation = buildQuestionEntryFormatPresentation({
      ...baseQuestion(),
      type: 'optimize',
      entryFormat: 'baseline-optimize',
      scaffold: {
        ...baseQuestion().scaffold,
        baselineVerdict: baselineVerdict()
      }
    })

    expect(presentation.title).toBe('Beat the baseline')
    expect(presentation.highlights).toEqual(
      expect.arrayContaining([
        { label: 'Baseline p99', value: '180 ms' },
        { label: 'Baseline throughput', value: '145.4 req/s' },
        { label: 'Baseline error rate', value: '7.2%' }
      ])
    )
  })

  it('marks locked labs as properties-only tuning experiences', () => {
    const presentation = buildQuestionEntryFormatPresentation({
      ...baseQuestion(),
      entryFormat: 'locked-lab',
      scaffold: {
        ...baseQuestion().scaffold,
        type: 'complete'
      },
      constraints: {
        allowedNodeTypes: [],
        canModifyScaffold: false,
        canRemoveScaffoldNodes: false
      }
    })

    expect(presentation.guideTitle).toBe('Lab Workflow')
    expect(presentation.highlights).toEqual(
      expect.arrayContaining([{ label: 'Editing', value: 'Properties only' }])
    )
    expect(presentation.steps[1]?.label).toBe('Adjust properties')
  })

  it('tracks workflow progress from authored brief to evaluated topology', () => {
    const question: QuestionPackage = {
      ...baseQuestion(),
      entryFormat: 'requirements-first'
    }

    const inBrief = buildQuestionWorkflowTracker(question, {
      hasTopologyEdits: false,
      hasCurrentEvaluation: false,
      evaluationPassed: false,
      testRunCount: 0
    })
    const afterEdits = buildQuestionWorkflowTracker(question, {
      hasTopologyEdits: true,
      hasCurrentEvaluation: false,
      evaluationPassed: false,
      testRunCount: 1
    })
    const afterPass = buildQuestionWorkflowTracker(question, {
      hasTopologyEdits: true,
      hasCurrentEvaluation: true,
      evaluationPassed: true,
      testRunCount: 2
    })

    expect(inBrief.progressLabel).toBe('0/3 steps complete')
    expect(inBrief.steps[0]?.status).toBe('current')
    expect(afterEdits.steps[0]?.status).toBe('complete')
    expect(afterEdits.steps[1]?.status).toBe('current')
    expect(afterPass.progressLabel).toBe('3/3 steps complete')
    expect(afterPass.nextAction).toContain('satisfies the authored checks')
  })
})
