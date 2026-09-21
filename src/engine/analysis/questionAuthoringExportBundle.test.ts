import { describe, expect, it } from 'vitest'
import { parseNewtonRowsToQuestionPackage } from './newtonQuestionRows'
import {
  compileQuestionAuthoringExportBundle,
  deserializeQuestionAuthoringExportBundle,
  parseQuestionAuthoringExportBundle
} from './questionAuthoringExportBundle'
import { createQuestionAuthoringProject } from './questionAuthoringProject'

const FIXED_TIME = '2026-09-19T12:00:00.000Z'

function completeProject() {
  return createQuestionAuthoringProject({
    projectId: 'project-export',
    updatedAt: FIXED_TIME,
    title: 'Design a Durable Queue',
    problemStatement: 'Keep accepted messages durable during worker restarts.',
    functionalRequirements: [{ id: 'fr-replay', text: 'Replay failed deliveries' }],
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
    structuralRules: [{ id: 'single-source', kind: 'requires_single_source' }],
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

describe('Question Studio Django export bundle', () => {
  it('contains the runtime package, Django fields, ordered rows, guide, and honest proof state', () => {
    const result = compileQuestionAuthoringExportBundle(completeProject())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    expect(result.fileName).toBe('design-a-durable-queue.dsds-question-export-bundle.json')
    expect(result.bundle.django.fields).toMatchObject({
      question_type: 'GAME',
      question_title: 'Design a Durable Queue',
      initial_game_state: {}
    })
    expect(result.bundle.django.rows.map((row) => row.input.type)).toEqual([
      'SIMULATOR_CONFIG',
      'STRUCTURAL_RULE',
      'RUBRIC_CHECK'
    ])
    expect(result.bundle.django.adminGuideMarkdown).toContain('## Row 3')
    expect(result.bundle.verification).toEqual({
      status: 'not-run',
      publishReady: false,
      message: 'Draft handoff only. Reference and gamed designs have not been verified.'
    })
  })

  it('round-trips the embedded project and reconstructs the same package from Django rows', () => {
    const result = compileQuestionAuthoringExportBundle(completeProject())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return

    const parsed = deserializeQuestionAuthoringExportBundle(result.content)
    expect(parsed.authoringProject).toEqual(completeProject())

    const reconstructed = parseNewtonRowsToQuestionPackage({
      question_title: parsed.django.fields.question_title,
      question_text: parsed.django.fields.question_text,
      rubric: parsed.django.rows.map((row) => ({
        order: row.order,
        title: row.title,
        hidden: row.hidden,
        output: row.output,
        spec: row.input
      }))
    })
    expect(reconstructed.questionPackage).toEqual(parsed.questionPackage)
  })

  it('is deterministic and rejects derived artifacts that drift from the embedded project', () => {
    const first = compileQuestionAuthoringExportBundle(completeProject())
    const second = compileQuestionAuthoringExportBundle(completeProject())
    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    if (first.status !== 'ready' || second.status !== 'ready') return
    expect(first.content).toBe(second.content)

    const tampered = JSON.parse(first.content) as {
      django: { fields: { question_title: string } }
    }
    tampered.django.fields.question_title = 'Tampered title'
    expect(() => parseQuestionAuthoringExportBundle(tampered)).toThrow(/does not match/)
  })

  it('refuses to emit a bundle for an incomplete draft', () => {
    const result = compileQuestionAuthoringExportBundle(
      createQuestionAuthoringProject({ projectId: 'blank', updatedAt: FIXED_TIME })
    )
    expect(result.status).toBe('blocked')
    if (result.status !== 'blocked') return
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'draft.metricRuleRequired'
    )
  })
})
