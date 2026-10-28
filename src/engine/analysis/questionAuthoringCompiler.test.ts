import { describe, expect, it } from 'vitest'
import type { TopologyJSON } from '../core/types'
import { resolveEffectiveProfile, resolveEnvironmentProfile } from './environmentProfile'
import { parseNewtonRowsToQuestionPackage } from './newtonQuestionRows'
import { compileQuestionAuthoringPreview } from './questionAuthoringCompiler'
import { importQuestionAuthoringArtifact } from './questionAuthoringImport'
import {
  createQuestionAuthoringProject,
  resolveQuestionAuthoringSetup
} from './questionAuthoringProject'

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

  it('compiles objective-first Classroom intent without exporting the private solution', () => {
    const project = completeProject()
    project.question.setup = {
      ...resolveQuestionAuthoringSetup(project.question.setup),
      classroomIntent: {
        version: '1',
        outcome: 'classroom-structural',
        conceptIds: ['NET-05'],
        peakRps: 2_000,
        allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'],
        settings: {
          givens: { microservice: { capacityRps: 200 } },
          objectives: [
            {
              id: 'request-path',
              statement: 'The student can place a load balancer on the request path.',
              concept: 'NET-05'
            }
          ],
          controls: [
            {
              id: 'connect-path',
              kind: 'connect-components',
              label: 'Connect the request path',
              objectiveId: 'request-path'
            }
          ],
          checks: [
            {
              id: 'through-load-balancer',
              template: 'traffic-flows-through',
              label: 'Traffic passes through the load balancer',
              via: 'load-balancer',
              component: 'microservice',
              objectiveId: 'request-path'
            }
          ]
        },
        solution: {
          nodes: [
            { ref: 'users', component: 'api-endpoint' },
            { ref: 'balancer', component: 'load-balancer' },
            { ref: 'service', component: 'microservice' }
          ],
          edges: [
            ['users', 'balancer'],
            ['balancer', 'service']
          ]
        }
      }
    }

    const preview = compileQuestionAuthoringPreview(project)
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return
    expect(preview.questionPackage).toMatchObject({
      constraints: {
        allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice']
      },
      concepts: ['NET-05'],
      prompt: { scale: { peakRps: 2_000 } },
      classroom: {
        abstractions: ['classroom', 'guided', 'architect'],
        controls: [{ objectiveId: 'request-path' }]
      }
    })
    expect(preview.compiledRows.rows[0].spec).toMatchObject({
      type: 'SIMULATOR_CONFIG',
      environmentProfile: { mode: 'ASSIGNMENT', abstraction: 'classroom' }
    })
    const published = parseNewtonRowsToQuestionPackage(preview.newtonSeed)
    expect(published.environmentProfile).toEqual({
      mode: 'ASSIGNMENT',
      abstraction: 'classroom'
    })
    const effectiveProfile = resolveEffectiveProfile(
      resolveEnvironmentProfile(published.environmentProfile),
      published.questionPackage
    )
    expect(effectiveProfile).toMatchObject({
      mode: 'ASSIGNMENT',
      abstraction: 'classroom',
      capabilities: {
        canEditResources: false,
        canEditExecutionProfile: false,
        canEditEdges: false
      }
    })
    expect(preview.packageJson).not.toContain('"solution"')
    expect(preview.packageJson).not.toContain('"balancer"')
  })

  it('turns complete visual Classroom fields into scenario and grading without duplicate rows', () => {
    const project = createQuestionAuthoringProject({
      projectId: 'visual-classroom',
      updatedAt: FIXED_TIME,
      title: 'Route Requests',
      problemStatement: 'Build a request path through a load balancer.'
    })
    project.question.prompt.scale.peakRps = 1_000
    project.question.setup = {
      ...resolveQuestionAuthoringSetup(project.question.setup),
      concepts: ['NET-05'],
      constraints: {
        ...resolveQuestionAuthoringSetup(project.question.setup).constraints,
        allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice']
      },
      classroom: {
        abstractions: ['classroom', 'architect'],
        givens: { microservice: { capacityRps: 100 } },
        objectives: [
          {
            id: 'request-path',
            statement: 'The student can route traffic through a load balancer.',
            concept: 'NET-05'
          }
        ],
        controls: [
          {
            id: 'connect-path',
            kind: 'connect-components',
            label: 'Connect the request path',
            objectiveId: 'request-path'
          }
        ],
        checks: [
          {
            id: 'through-load-balancer',
            template: 'traffic-flows-through',
            label: 'Traffic passes through the load balancer',
            via: 'load-balancer',
            component: 'microservice',
            objectiveId: 'request-path'
          }
        ]
      }
    }

    const preview = compileQuestionAuthoringPreview(project)
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return
    expect(project.question.scenarios).toEqual([])
    expect(project.question.metricRules).toEqual([])
    expect(preview.questionPackage.suite.cases).toMatchObject([
      { id: 'classroom-baseline', workload: { baseRps: 1_000 } }
    ])
    expect(preview.questionPackage.rubric.checks).toEqual([])
    expect(preview.questionPackage.classroom?.checks).toHaveLength(1)
  })

  it('round-trips learner-facing descriptions through project, package, and Django rows', () => {
    const project = completeProject()
    project.question.structuralRules[0].description = 'Include exactly one Users traffic source.'
    project.question.metricRules[0].description = 'Keep p99 latency below 100 ms at peak.'
    project.question.semanticRules.push({
      id: 'backend-present',
      kind: 'componentPresence',
      componentType: 'microservice',
      points: 1,
      description: 'Include at least one backend server.'
    })
    project.question.rubricChecks.push({
      id: 'headroom',
      metric: 'invariantViolations.count',
      op: '==',
      value: 0,
      points: 2,
      description: 'Stay within the 80% server headroom budget.'
    })

    const preview = compileQuestionAuthoringPreview(project)
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return

    expect(preview.questionPackage.structuralRules?.[0]?.description).toBe(
      'Include exactly one Users traffic source.'
    )
    expect(preview.questionPackage.semanticCriteria?.[0]?.description).toBe(
      'Include at least one backend server.'
    )
    expect(preview.questionPackage.rubric.checks.map((check) => check.description)).toEqual([
      'Keep p99 latency below 100 ms at peak.',
      'Stay within the 80% server headroom budget.'
    ])
    expect(
      preview.compiledRows.rows
        .filter((row) => row.spec.type !== 'SIMULATOR_CONFIG')
        .map((row) => row.spec.description)
    ).toEqual([
      'Include exactly one Users traffic source.',
      'Include at least one backend server.',
      'Keep p99 latency below 100 ms at peak.',
      'Stay within the 80% server headroom budget.'
    ])

    const reopened = importQuestionAuthoringArtifact(preview.questionPackage)
    const recompiled = compileQuestionAuthoringPreview(reopened)
    expect(recompiled.status).toBe('ready')
    if (recompiled.status !== 'ready') return
    expect(recompiled.questionPackage.structuralRules?.[0]?.description).toBe(
      'Include exactly one Users traffic source.'
    )
    expect(recompiled.questionPackage.semanticCriteria?.[0]?.description).toBe(
      'Include at least one backend server.'
    )
    expect(recompiled.questionPackage.rubric.checks.map((check) => check.description)).toEqual([
      'Keep p99 latency below 100 ms at peak.',
      'Stay within the 80% server headroom budget.'
    ])
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

  it('preserves an explicit requirements-first entry format with a scaffold anchor', () => {
    const project = completeProject()
    project.question.setup = {
      ...resolveQuestionAuthoringSetup(project.question.setup),
      entryFormat: 'requirements-first'
    }
    project.assets.scaffoldTopology = SCAFFOLD_TOPOLOGY

    const preview = compileQuestionAuthoringPreview(project)
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return

    expect(preview.questionPackage.entryFormat).toBe('requirements-first')
    expect(preview.questionPackage.scaffold).toEqual({
      type: 'partial',
      topology: SCAFFOLD_TOPOLOGY
    })
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
