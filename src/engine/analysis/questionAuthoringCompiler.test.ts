import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import { parseNewtonRowsToQuestionPackage } from './newtonQuestionRows'
import { compileQuestionAuthoringPreview } from './questionAuthoringCompiler'
import { createQuestionAuthoringProject } from './questionAuthoringProject'

const FIXED_TIME = '2026-09-19T12:00:00.000Z'

const SCAFFOLD_TOPOLOGY: TopologyJSON = {
  id: 'durable-queue-scaffold',
  name: 'Durable queue scaffold',
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

function completeProject() {
  return createQuestionAuthoringProject({
    projectId: 'project-preview',
    updatedAt: FIXED_TIME,
    title: 'Design a Durable Queue',
    problemStatement: 'Keep accepted messages durable during worker restarts.',
    functionalRequirements: [{ id: 'fr-replay', text: 'Replay failed deliveries' }],
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
        kind: 'requires_single_source',
        description: 'Use exactly one traffic source.'
      }
    ],
    metricRules: [
      {
        id: 'metric-target',
        metric: 'latency_p99',
        operator: '<',
        value: 100,
        unit: 'ms'
      }
    ],
    activeStage: 'export'
  })
}

describe('Question Studio generated-output compiler', () => {
  it('blocks incomplete drafts with stable, stage-addressable diagnostics', () => {
    const preview = compileQuestionAuthoringPreview(
      createQuestionAuthoringProject({ projectId: 'blank', updatedAt: FIXED_TIME })
    )

    expect(preview).toMatchInlineSnapshot(`
      {
        "diagnostics": [
          {
            "code": "draft.titleRequired",
            "level": "error",
            "message": "Add a question title.",
            "path": "question.title",
            "stage": "frame",
          },
          {
            "code": "draft.problemRequired",
            "level": "error",
            "message": "Add a learner-facing problem statement.",
            "path": "question.prompt.text",
            "stage": "brief",
          },
          {
            "code": "draft.scenarioRequired",
            "level": "error",
            "message": "Add at least one valid scenario.",
            "path": "question.scenarios",
            "stage": "scenarios",
          },
          {
            "code": "draft.metricRuleRequired",
            "level": "error",
            "message": "Add at least one valid grading check.",
            "path": "question.metricRules",
            "stage": "grading",
          },
        ],
        "status": "blocked",
      }
    `)
  })

  it('compiles a complete draft through the strict package schema and shared row codec', () => {
    const preview = compileQuestionAuthoringPreview(completeProject())
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return

    expect(preview.questionPackage).toMatchObject({
      version: '1.0',
      id: 'design-a-durable-queue',
      title: 'Design a Durable Queue',
      difficulty: 'intermediate',
      type: 'open-build',
      entryFormat: 'blank-canvas',
      scaffold: { type: 'empty' },
      suite: { name: 'design-a-durable-queue-suite', visibleToStudent: false },
      rubric: { id: 'design-a-durable-queue-rubric', passThreshold: 1 }
    })
    expect(preview.compiledRows.rows.map((row) => row.spec.type)).toEqual([
      'SIMULATOR_CONFIG',
      'STRUCTURAL_RULE',
      'RUBRIC_CHECK'
    ])
    expect(preview.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['domains.missing'])
    expect(parseNewtonRowsToQuestionPackage(preview.newtonSeed).questionPackage).toEqual(
      preview.questionPackage
    )
  })

  it('emits deterministic package and Newton payload snapshots', () => {
    const first = compileQuestionAuthoringPreview(completeProject())
    const second = compileQuestionAuthoringPreview(completeProject())
    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    if (first.status !== 'ready' || second.status !== 'ready') return

    expect(first.packageJson).toBe(second.packageJson)
    expect(first.newtonRowsJson).toBe(second.newtonRowsJson)
    expect(first.packageJson).toContain('"id": "design-a-durable-queue"')
    expect(first.newtonRowsJson).toContain('"type": "SIMULATOR_CONFIG"')
    expect(first.newtonRowsJson).toContain('"type": "RUBRIC_CHECK"')
  })

  it('compiles a stored canvas snapshot as the learner partial scaffold', () => {
    const project = completeProject()
    project.assets.scaffoldTopology = SCAFFOLD_TOPOLOGY

    const preview = compileQuestionAuthoringPreview(project)
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return

    expect(preview.questionPackage.entryFormat).toBe('partial-scaffold')
    expect(preview.questionPackage.scaffold).toEqual({
      type: 'partial',
      topology: SCAFFOLD_TOPOLOGY
    })
    expect(parseNewtonRowsToQuestionPackage(preview.newtonSeed).questionPackage.scaffold).toEqual(
      preview.questionPackage.scaffold
    )
  })

  it('blocks invalid cards without emitting plausible partial JSON', () => {
    const project = completeProject()
    project.question.scenarios[0].seed = ''
    project.question.metricRules[0].value = null

    const preview = compileQuestionAuthoringPreview(project)

    expect(preview.status).toBe('blocked')
    expect(preview.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'draft.scenarioIncomplete',
      'draft.metricRuleIncomplete'
    ])
    expect('packageJson' in preview).toBe(false)
    expect('newtonRowsJson' in preview).toBe(false)
  })
})
