import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import {
  createQuestionAuthoringProject,
  deserializeQuestionAuthoringProject,
  parseQuestionAuthoringProject,
  questionAuthoringProjectFileName,
  serializeQuestionAuthoringProject,
  updateQuestionAuthoringFunctionalRequirements,
  updateQuestionAuthoringMetricRules,
  updateQuestionAuthoringNonFunctionalRequirements,
  updateQuestionAuthoringProblemStatement,
  updateQuestionAuthoringScaffoldTopology,
  updateQuestionAuthoringScenarios,
  updateQuestionAuthoringStage,
  updateQuestionAuthoringStructuralRules,
  updateQuestionAuthoringTitle
} from './questionAuthoringProject'

const FIXED_TIME = '2026-09-18T12:00:00.000Z'

function scaffoldTopology(): TopologyJSON {
  return {
    id: 'question-scaffold',
    name: 'Question scaffold',
    version: '2.1.0',
    global: {
      simulationDuration: 60_000,
      warmupDuration: 5_000,
      seed: 'scaffold-v1',
      defaultTimeout: 5_000,
      timeResolution: 'millisecond'
    },
    nodes: [
      {
        id: 'traffic',
        type: 'api-endpoint',
        category: 'compute',
        role: 'source',
        label: 'Traffic source',
        position: { x: 80, y: 100 }
      }
    ],
    edges: [],
    workload: {
      sourceNodeId: 'traffic',
      pattern: 'constant',
      baseRps: 100,
      requestDistribution: [{ type: 'default', weight: 1, sizeBytes: 1024 }]
    }
  }
}

describe('QuestionAuthoringProject', () => {
  it('creates a saveable incomplete draft with an artifact discriminator', () => {
    expect(
      createQuestionAuthoringProject({ projectId: 'project-1', updatedAt: FIXED_TIME })
    ).toEqual({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: {
        id: 'untitled-question',
        title: '',
        tags: [],
        prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [], scale: {} },
        scenarios: [],
        structuralRules: [],
        semanticRules: [],
        metricRules: [],
        rubricChecks: [],
        justify: []
      },
      assets: { gamedTopologies: [] },
      ui: { activeStage: 'frame' }
    })
  })

  it('updates derived identity and UI stage without changing the project ID', () => {
    const blank = createQuestionAuthoringProject({
      projectId: 'project-1',
      updatedAt: FIXED_TIME
    })
    const titled = updateQuestionAuthoringTitle(
      blank,
      'Design a Durable Queue',
      '2026-09-18T12:01:00.000Z'
    )
    const grading = updateQuestionAuthoringStage(titled, 'grading', '2026-09-18T12:02:00.000Z')
    const described = updateQuestionAuthoringProblemStatement(
      grading,
      'Keep messages durable during worker restarts.',
      '2026-09-18T12:03:00.000Z'
    )
    const withRequirement = updateQuestionAuthoringFunctionalRequirements(
      described,
      [{ id: 'fr-durable', text: 'Persist accepted messages' }],
      '2026-09-18T12:04:00.000Z'
    )
    const withNfr = updateQuestionAuthoringNonFunctionalRequirements(
      withRequirement,
      [
        {
          id: 'nfr-latency',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ],
      '2026-09-18T12:05:00.000Z'
    )
    const withScenario = updateQuestionAuthoringScenarios(
      withNfr,
      [
        {
          id: 'baseline',
          description: 'Sustain steady traffic.',
          seed: 'baseline-v1',
          pattern: 'constant',
          durationSeconds: 60,
          warmupSeconds: 5,
          baseRps: 1000,
          readPercent: 80,
          requestSizeBytes: 512
        }
      ],
      '2026-09-18T12:06:00.000Z'
    )
    const withStructuralRule = updateQuestionAuthoringStructuralRules(
      withScenario,
      [
        {
          id: 'single-source',
          kind: 'requires_single_source'
        }
      ],
      '2026-09-18T12:07:00.000Z'
    )
    const withMetricRule = updateQuestionAuthoringMetricRules(
      withStructuralRule,
      [
        {
          id: 'metric-target',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ],
      '2026-09-18T12:08:00.000Z'
    )

    expect(withMetricRule.projectId).toBe('project-1')
    expect(withMetricRule.question).toEqual({
      id: 'design-a-durable-queue',
      title: 'Design a Durable Queue',
      tags: [],
      prompt: {
        text: 'Keep messages durable during worker restarts.',
        functionalRequirements: [{ id: 'fr-durable', text: 'Persist accepted messages' }],
        nonFunctionalRequirements: [
          {
            id: 'nfr-latency',
            metric: 'latency_p99',
            operator: '<',
            value: 100,
            unit: 'ms'
          }
        ],
        scale: {}
      },
      scenarios: [
        {
          id: 'baseline',
          description: 'Sustain steady traffic.',
          seed: 'baseline-v1',
          pattern: 'constant',
          durationSeconds: 60,
          warmupSeconds: 5,
          baseRps: 1000,
          readPercent: 80,
          requestSizeBytes: 512
        }
      ],
      structuralRules: [
        {
          id: 'single-source',
          kind: 'requires_single_source'
        }
      ],
      semanticRules: [],
      metricRules: [
        {
          id: 'metric-target',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ],
      rubricChecks: [],
      justify: []
    })
    expect(withMetricRule.ui.activeStage).toBe('grading')
  })

  it('round-trips the project without normalization loss', () => {
    const project = createQuestionAuthoringProject({
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      title: 'Design a URL Shortener',
      problemStatement: 'Build a low-latency redirect service.',
      functionalRequirements: [{ id: 'fr-redirect', text: 'Redirect a short URL' }],
      nonFunctionalRequirements: [
        {
          id: 'nfr-latency',
          metric: 'latency_p99',
          operator: '<',
          value: 100,
          unit: 'ms'
        }
      ],
      scenarios: [
        {
          id: 'baseline',
          description: 'Exercise the read-heavy peak.',
          seed: 'url-baseline-v1',
          pattern: 'constant',
          durationSeconds: 60,
          warmupSeconds: 5,
          baseRps: 2000,
          readPercent: 99,
          requestSizeBytes: 256
        }
      ],
      structuralRules: [
        {
          id: 'single-source',
          kind: 'requires_single_source'
        }
      ],
      metricRules: [
        {
          id: 'metric-target',
          metric: 'error_rate',
          operator: '<',
          value: 1,
          unit: 'percent'
        }
      ],
      activeStage: 'brief'
    })

    expect(deserializeQuestionAuthoringProject(serializeQuestionAuthoringProject(project))).toEqual(
      project
    )
    expect(questionAuthoringProjectFileName(project.question.title)).toBe(
      'design-a-url-shortener.dsds-question-project.json'
    )
  })

  it('stores and removes one validated scaffold topology snapshot', () => {
    const blank = createQuestionAuthoringProject({
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      title: 'Scaffold question'
    })
    const withScaffold = updateQuestionAuthoringScaffoldTopology(
      blank,
      scaffoldTopology(),
      '2026-09-18T12:01:00.000Z'
    )

    expect(withScaffold.assets.scaffoldTopology).toEqual(scaffoldTopology())
    expect(
      deserializeQuestionAuthoringProject(serializeQuestionAuthoringProject(withScaffold))
    ).toEqual(withScaffold)

    const cleared = updateQuestionAuthoringScaffoldTopology(
      withScaffold,
      undefined,
      '2026-09-18T12:02:00.000Z'
    )
    expect(cleared.assets).toEqual({ gamedTopologies: [] })
  })

  it('keeps an auto-generated scaffold identity aligned when the question is named later', () => {
    const scaffold = {
      ...scaffoldTopology(),
      id: 'untitled-question-scaffold',
      name: 'Untitled question scaffold'
    }
    const blank = createQuestionAuthoringProject({
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      scaffoldTopology: scaffold
    })

    const titled = updateQuestionAuthoringTitle(
      blank,
      'Design a Durable Queue',
      '2026-09-18T12:01:00.000Z'
    )

    expect(titled.assets.scaffoldTopology).toMatchObject({
      id: 'design-a-durable-queue-scaffold',
      name: 'Design a Durable Queue scaffold'
    })
  })

  it('opens checkpoint 1.3 files with an empty problem statement', () => {
    const project = parseQuestionAuthoringProject({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: { id: 'legacy-title', title: 'Legacy title' },
      ui: { activeStage: 'brief' }
    })

    expect(project.question.prompt).toEqual({
      text: '',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    })
    expect(project.question.scenarios).toEqual([])
    expect(project.question.structuralRules).toEqual([])
    expect(project.question.metricRules).toEqual([])
    expect(project.question.semanticRules).toEqual([])
    expect(project.assets).toEqual({ gamedTopologies: [] })
  })

  it('opens checkpoint 1.4 files with an empty functional-requirement list', () => {
    const project = parseQuestionAuthoringProject({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: {
        id: 'brief-title',
        title: 'Brief title',
        prompt: { text: 'Existing problem statement.' }
      },
      ui: { activeStage: 'brief' }
    })

    expect(project.question.prompt.functionalRequirements).toEqual([])
    expect(project.question.prompt.nonFunctionalRequirements).toEqual([])
    expect(project.question.scenarios).toEqual([])
    expect(project.question.structuralRules).toEqual([])
  })

  it('opens checkpoint 1.5 files with an empty non-functional-requirement list', () => {
    const project = parseQuestionAuthoringProject({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: {
        id: 'requirements-title',
        title: 'Requirements title',
        prompt: {
          text: 'Existing problem statement.',
          functionalRequirements: [{ id: 'fr-existing', text: 'Existing requirement' }]
        }
      },
      ui: { activeStage: 'brief' }
    })

    expect(project.question.prompt.nonFunctionalRequirements).toEqual([])
    expect(project.question.scenarios).toEqual([])
    expect(project.question.structuralRules).toEqual([])
  })

  it('opens checkpoint 1.6 files with an empty scenario list', () => {
    const project = parseQuestionAuthoringProject({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: {
        id: 'nfr-title',
        title: 'NFR title',
        prompt: {
          text: 'Existing problem statement.',
          functionalRequirements: [],
          nonFunctionalRequirements: [
            {
              id: 'nfr-existing',
              metric: 'error_rate',
              operator: '<',
              value: 1,
              unit: 'percent'
            }
          ]
        }
      },
      ui: { activeStage: 'brief' }
    })

    expect(project.question.scenarios).toEqual([])
    expect(project.question.structuralRules).toEqual([])
  })

  it('opens checkpoint 1.7 files with an empty structural-rule list', () => {
    const project = parseQuestionAuthoringProject({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: {
        id: 'scenario-title',
        title: 'Scenario title',
        prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [] },
        scenarios: [
          {
            id: 'baseline',
            description: 'Existing baseline.',
            seed: 'baseline-v1',
            pattern: 'constant',
            durationSeconds: 60,
            warmupSeconds: 5,
            baseRps: 1000,
            readPercent: 80,
            requestSizeBytes: 512
          }
        ]
      },
      ui: { activeStage: 'scenarios' }
    })

    expect(project.question.structuralRules).toEqual([])
    expect(project.question.metricRules).toEqual([])
  })

  it('opens checkpoint 1.8 files with an empty metric-rule list', () => {
    const project = parseQuestionAuthoringProject({
      artifact: 'dsds-question-project',
      artifactVersion: '1.0',
      projectId: 'project-1',
      updatedAt: FIXED_TIME,
      question: {
        id: 'grading-title',
        title: 'Grading title',
        prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [] },
        scenarios: [],
        structuralRules: [
          {
            id: 'single-source',
            kind: 'requires_single_source'
          }
        ]
      },
      ui: { activeStage: 'grading' }
    })

    expect(project.question.metricRules).toEqual([])
  })

  it('rejects non-project JSON and edited derived IDs', () => {
    expect(() =>
      parseQuestionAuthoringProject({ version: '1.0', title: 'Runtime package' })
    ).toThrow()
    expect(() =>
      parseQuestionAuthoringProject({
        artifact: 'dsds-question-project',
        artifactVersion: '1.0',
        projectId: 'project-1',
        updatedAt: FIXED_TIME,
        question: {
          id: 'wrong-id',
          title: 'Right ID',
          prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [] }
        },
        ui: { activeStage: 'frame' }
      })
    ).toThrow(/right-id/)

    expect(() =>
      parseQuestionAuthoringProject({
        artifact: 'dsds-question-project',
        artifactVersion: '1.0',
        projectId: 'project-1',
        updatedAt: FIXED_TIME,
        question: {
          id: 'duplicate-requirements',
          title: 'Duplicate requirements',
          prompt: {
            text: '',
            functionalRequirements: [
              { id: 'fr-duplicate', text: 'First' },
              { id: 'fr-duplicate', text: 'Second' }
            ]
          }
        },
        ui: { activeStage: 'brief' }
      })
    ).toThrow(/Duplicate functional requirement ID/)

    expect(() =>
      parseQuestionAuthoringProject({
        artifact: 'dsds-question-project',
        artifactVersion: '1.0',
        projectId: 'project-1',
        updatedAt: FIXED_TIME,
        question: {
          id: 'invalid-target',
          title: 'Invalid target',
          prompt: {
            text: '',
            functionalRequirements: [],
            nonFunctionalRequirements: [
              {
                id: 'nfr-invalid',
                metric: 'throughput',
                operator: '<',
                value: 100,
                unit: 'ms'
              }
            ]
          }
        },
        ui: { activeStage: 'brief' }
      })
    ).toThrow(/supported combination/)

    expect(() =>
      parseQuestionAuthoringProject({
        artifact: 'dsds-question-project',
        artifactVersion: '1.0',
        projectId: 'project-1',
        updatedAt: FIXED_TIME,
        question: {
          id: 'duplicate-scenarios',
          title: 'Duplicate scenarios',
          prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [] },
          scenarios: [
            {
              id: 'baseline',
              description: 'First',
              seed: 'first',
              pattern: 'constant',
              durationSeconds: 60,
              warmupSeconds: 5,
              baseRps: 1000,
              readPercent: 80,
              requestSizeBytes: 512
            },
            {
              id: 'baseline',
              description: 'Second',
              seed: 'second',
              pattern: 'constant',
              durationSeconds: 30,
              warmupSeconds: 2,
              baseRps: 500,
              readPercent: 50,
              requestSizeBytes: 256
            }
          ]
        },
        ui: { activeStage: 'scenarios' }
      })
    ).toThrow(/Duplicate scenario ID/)

    expect(() =>
      parseQuestionAuthoringProject({
        artifact: 'dsds-question-project',
        artifactVersion: '1.0',
        projectId: 'project-1',
        updatedAt: FIXED_TIME,
        question: {
          id: 'duplicate-structural-rules',
          title: 'Duplicate structural rules',
          prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [] },
          scenarios: [],
          structuralRules: [
            { id: 'single-source', kind: 'requires_single_source' },
            { id: 'single-source', kind: 'requires_single_source' }
          ]
        },
        ui: { activeStage: 'grading' }
      })
    ).toThrow(/Duplicate structural rule ID/)

    expect(() =>
      parseQuestionAuthoringProject({
        artifact: 'dsds-question-project',
        artifactVersion: '1.0',
        projectId: 'project-1',
        updatedAt: FIXED_TIME,
        question: {
          id: 'duplicate-metric-rules',
          title: 'Duplicate metric rules',
          prompt: { text: '', functionalRequirements: [], nonFunctionalRequirements: [] },
          scenarios: [],
          structuralRules: [],
          metricRules: [
            {
              id: 'metric-target',
              metric: 'latency_p99',
              operator: '<',
              value: 100,
              unit: 'ms'
            },
            {
              id: 'metric-target',
              metric: 'throughput',
              operator: '>=',
              value: 1000,
              unit: 'req_per_sec'
            }
          ]
        },
        ui: { activeStage: 'grading' }
      })
    ).toThrow(/Duplicate metric rule ID/)
  })
})
