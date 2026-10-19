import { describe, expect, it } from 'vitest'
import {
  ClassroomQuestionIntentSchema,
  compileClassroomQuestionIntent,
  type ClassroomQuestionIntent
} from './questionIntent'
import {
  createQuestionAuthoringProject,
  DEFAULT_QUESTION_AUTHORING_SETUP
} from '../analysis/questionAuthoringProject'
import { compileQuestionAuthoringPreview } from '../analysis/questionAuthoringCompiler'
import { applyClassroomQuestionIntentToProject } from './questionIntentProject'

function validIntent(): ClassroomQuestionIntent {
  return {
    version: '1',
    outcome: 'classroom-structural',
    conceptIds: ['NET-05'],
    peakRps: 1_000,
    allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'],
    settings: {
      givens: { microservice: { capacityRps: 100 } },
      objectives: [
        {
          id: 'load-balance',
          statement: 'The student can place a load balancer on the request path.',
          concept: 'NET-05'
        }
      ],
      controls: [
        {
          id: 'connect-request-path',
          kind: 'connect-components',
          label: 'Connect the request path',
          objectiveId: 'load-balance'
        }
      ],
      checks: [
        {
          id: 'through-load-balancer',
          template: 'traffic-flows-through',
          label: 'Traffic passes through the load balancer',
          via: 'load-balancer',
          component: 'microservice',
          objectiveId: 'load-balance'
        }
      ]
    },
    solution: {
      nodes: [
        { ref: 'users', component: 'api-endpoint' },
        { ref: 'balancer', component: 'load-balancer' },
        { ref: 'service', component: 'microservice', copies: 10 }
      ],
      edges: [
        ['users', 'balancer'],
        ['balancer', 'service']
      ]
    }
  }
}

describe('objective-driven Classroom question intent', () => {
  it('compiles author intent into learner-safe runtime settings', () => {
    const compiled = compileClassroomQuestionIntent(validIntent())
    expect(compiled).toMatchObject({
      status: 'ready',
      peakRps: 1_000,
      allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice'],
      conceptIds: ['NET-05'],
      settings: {
        abstractions: ['classroom', 'guided', 'architect'],
        controls: [{ objectiveId: 'load-balance' }]
      }
    })
    expect(compiled).not.toHaveProperty('solution')
    expect(compiled.status === 'ready' && compiled.settings).not.toHaveProperty('solution')
  })

  it('rejects a configurable decision that has no valid teaching objective', () => {
    const intent = validIntent()
    intent.settings.controls![0].objectiveId = 'missing-objective'
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /Unknown Classroom objective 'missing-objective'/
    )
  })

  it('rejects a caching choice whose hit rate the question does not state', () => {
    const intent = validIntent()
    intent.settings.choices = {
      microservice: [
        {
          id: 'caching',
          label: 'Caching',
          explanation: 'Serve repeat reads from memory.',
          objectiveId: 'load-balance',
          target: 'cache-enabled',
          options: [
            { id: 'on', label: 'On', explanation: 'Cache reads.', value: 'on' },
            { id: 'off', label: 'Off', explanation: 'Read every time.', value: 'off' }
          ]
        }
      ]
    }
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /turns caching on for 'microservice' but the question doesn't state its hit rate/
    )
  })

  it('requires every objective to have a student decision and scored evidence', () => {
    const intent = validIntent()
    intent.settings.controls = []
    intent.settings.checks = []
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /Declare what students may configure and why/
    )
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(/has no scored evidence/)
  })

  it('accepts the two-objective QuickCart Classroom contract without unrelated checks', () => {
    const intent = validIntent()
    intent.conceptIds = ['NET-05', 'SC-05']
    intent.settings.objectives!.push({
      id: 'capacity-planning',
      statement: 'The student can choose enough server copies to preserve headroom.',
      concept: 'SC-05'
    })
    intent.settings.controls!.push({
      id: 'server-copies',
      kind: 'copies',
      label: 'Choose server copies',
      component: 'microservice',
      objectiveId: 'capacity-planning'
    })
    intent.settings.checks!.push(
      {
        id: 'serves-all',
        template: 'serves-all-traffic',
        label: 'Every request is served',
        objectiveId: 'capacity-planning'
      },
      {
        id: 'headroom',
        template: 'within-target-utilization',
        label: 'Every server stays within the utilization target',
        component: 'microservice',
        objectiveId: 'capacity-planning'
      }
    )
    expect(ClassroomQuestionIntentSchema.parse(intent)).toMatchObject({
      conceptIds: ['NET-05', 'SC-05'],
      settings: {
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'serves-all' }),
          expect.objectContaining({ id: 'headroom' })
        ])
      }
    })
  })

  it('rejects a concept assigned to a teaching surface it does not support', () => {
    const intent = validIntent()
    intent.conceptIds = ['COORD-07']
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /is not registered for the C teaching surface/
    )
  })

  it('rejects Classroom evidence and decisions unrelated to the selected concept recipe', () => {
    const intent = validIntent()
    intent.settings.controls = [
      {
        id: 'copies',
        kind: 'guided-knob',
        label: 'Tune workers',
        path: 'queue.workers',
        objectiveId: 'load-balance'
      }
    ]
    intent.settings.guidedKnobs = [
      { path: 'queue.workers', label: 'Tune workers', objectiveId: 'load-balance' }
    ]
    intent.settings.checks = [
      {
        id: 'unrelated-utilization',
        template: 'within-target-utilization',
        label: 'Keep servers below the target',
        component: 'microservice',
        objectiveId: 'load-balance'
      }
    ]
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /is not part of the selected concepts' Classroom recipes/
    )
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /is not supported evidence for the selected concepts' Classroom recipes/
    )
  })

  it('rejects duplicate or excessive scored evidence for one objective', () => {
    const intent = validIntent()
    intent.settings.checks = [
      ...intent.settings.checks!,
      { ...intent.settings.checks![0], id: 'duplicate-path' },
      { ...intent.settings.checks![0], id: 'third-path', component: 'load-balancer' }
    ]
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(/duplicates evidence/)
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(/more than two scored checks/)
  })

  it('requires observable student-can objective wording', () => {
    const intent = validIntent()
    intent.settings.objectives![0].statement = 'Understand load balancing.'
    expect(() => ClassroomQuestionIntentSchema.parse(intent)).toThrow(
      /must be an observable “The student can…” statement/
    )
  })

  it('preserves an explicit Architect handoff without manufacturing Classroom evidence', () => {
    const intent: ClassroomQuestionIntent = {
      version: '1',
      outcome: 'architect-handoff',
      conceptIds: ['COORD-07'],
      allowedNodeTypes: [],
      settings: {},
      handoffReason: 'Consensus safety requires a dedicated replicated-log model.'
    }
    expect(compileClassroomQuestionIntent(intent)).toEqual({
      status: 'handoff',
      outcome: 'architect-handoff',
      conceptIds: ['COORD-07'],
      reason: 'Consensus safety requires a dedicated replicated-log model.'
    })
  })

  it('allows an honest external handoff when a Classroom-tagged concept lacks simulator evidence', () => {
    const intent: ClassroomQuestionIntent = {
      version: '1',
      outcome: 'external-lab',
      conceptIds: ['PF-01'],
      allowedNodeTypes: [],
      settings: {},
      handoffReason: 'The current Classroom grader cannot evaluate stakeholder identification.'
    }
    expect(compileClassroomQuestionIntent(intent)).toMatchObject({
      status: 'handoff',
      outcome: 'external-lab',
      conceptIds: ['PF-01']
    })
  })

  it('turns intent into a Studio project without manual scenario or grading rows', () => {
    const project = createQuestionAuthoringProject({
      projectId: 'objective-first',
      updatedAt: '2026-10-16T08:30:00.000Z',
      title: 'Route Through a Load Balancer',
      problemStatement: 'Build a request path that uses a load balancer.'
    })
    const authored = applyClassroomQuestionIntentToProject(
      project,
      validIntent(),
      '2026-10-16T08:31:00.000Z'
    )

    expect(authored.question.scenarios).toEqual([])
    expect(authored.question.metricRules).toEqual([])
    expect(authored.assets.referenceTopology?.nodes).toHaveLength(3)
    const preview = compileQuestionAuthoringPreview(authored)
    expect(preview.status).toBe('ready')
    if (preview.status !== 'ready') return
    expect(preview.questionPackage.suite.cases).toMatchObject([
      { id: 'classroom-baseline', workload: { baseRps: 1_000 } }
    ])
    expect(preview.questionPackage.classroom?.checks).toHaveLength(1)
    expect(preview.packageJson).not.toContain('"solution"')
  })

  it('surfaces adaptive-contract violations as export-blocking Studio diagnostics', () => {
    const project = createQuestionAuthoringProject({
      projectId: 'invalid-adaptive-contract',
      updatedAt: '2026-10-16T08:30:00.000Z',
      title: 'Unrelated Classroom Evidence',
      problemStatement: 'Teach load balancing.'
    })
    project.question.prompt.scale.peakRps = 1_000
    project.question.setup = {
      ...DEFAULT_QUESTION_AUTHORING_SETUP,
      concepts: ['NET-05'],
      constraints: {
        ...DEFAULT_QUESTION_AUTHORING_SETUP.constraints,
        allowedNodeTypes: ['api-endpoint', 'load-balancer', 'microservice']
      },
      classroom: {
        abstractions: ['classroom', 'architect'],
        givens: { microservice: { capacityRps: 100 } },
        objectives: [
          {
            id: 'load-balance',
            statement: 'The student can place a load balancer.',
            concept: 'NET-05'
          }
        ],
        controls: [
          {
            id: 'place-balancer',
            kind: 'place-component',
            label: 'Place the balancer',
            component: 'load-balancer',
            objectiveId: 'load-balance'
          }
        ],
        checks: [
          {
            id: 'unrelated-utilization',
            template: 'within-target-utilization',
            label: 'Keep servers below the target',
            component: 'microservice',
            objectiveId: 'load-balance'
          }
        ]
      }
    }

    const preview = compileQuestionAuthoringPreview(project)
    expect(preview.status).toBe('blocked')
    expect(preview.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'draft.classroomContractIncomplete',
          message: expect.stringContaining('not supported evidence')
        })
      ])
    )
  })
})
