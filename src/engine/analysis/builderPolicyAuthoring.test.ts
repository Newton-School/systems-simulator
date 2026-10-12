import { describe, expect, it } from 'vitest'
import { parseNewtonRowsToQuestionPackage } from './newtonQuestionRows'
import {
  compileQuestionAuthoringExportBundle,
  deserializeQuestionAuthoringExportBundle
} from './questionAuthoringExportBundle'
import {
  createQuestionAuthoringProject,
  DEFAULT_QUESTION_AUTHORING_SETUP,
  deserializeQuestionAuthoringProject,
  serializeQuestionAuthoringProject,
  updateQuestionAuthoringSetup
} from './questionAuthoringProject'
import { createQuestionAuthoringProjectFromPackage } from './questionAuthoringImport'
import type { BuilderPolicy } from './builderPolicy'

const FIXED_TIME = '2026-10-09T12:00:00.000Z'
const POLICY: BuilderPolicy = {
  allowCustomNodeBuilder: false,
  allowedRuntimeTemplates: ['long-running-service'],
  allowedTraitPacks: ['capacity', 'workload-profile'],
  maxDefinitions: 2,
  lockDefinitionsAfterFirstRun: true
}

function project(builderPolicy?: BuilderPolicy) {
  return createQuestionAuthoringProject({
    projectId: 'project-policy',
    updatedAt: FIXED_TIME,
    title: 'Palette Practice',
    problemStatement: 'Build it from the palette.',
    setup: {
      ...structuredClone(DEFAULT_QUESTION_AUTHORING_SETUP),
      ...(builderPolicy ? { builderPolicy } : {})
    },
    scenarios: [
      {
        id: 'baseline',
        description: 'Steady traffic.',
        seed: 'baseline-v1',
        pattern: 'constant',
        durationSeconds: 60,
        warmupSeconds: 5,
        baseRps: 100,
        readPercent: 80,
        requestSizeBytes: 512
      }
    ],
    structuralRules: [{ id: 'single-source', kind: 'requires_single_source' }],
    metricRules: [
      { id: 'metric-target', metric: 'latency_p99', operator: '<', value: 100, unit: 'ms' }
    ],
    activeStage: 'export'
  })
}

describe('builder policy authoring round-trip', () => {
  it('persists through the question project file', () => {
    const saved = serializeQuestionAuthoringProject(project(POLICY))
    expect(deserializeQuestionAuthoringProject(saved).question.setup?.builderPolicy).toEqual(POLICY)
  })

  it('compiles into the package, the export bundle and the Django rows, and back', () => {
    const result = compileQuestionAuthoringExportBundle(project(POLICY))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.bundle.questionPackage.builderPolicy).toEqual(POLICY)

    const parsed = deserializeQuestionAuthoringExportBundle(result.content)
    expect(parsed.authoringProject.question.setup?.builderPolicy).toEqual(POLICY)
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
    expect(reconstructed.questionPackage.builderPolicy).toEqual(POLICY)

    const reimported = createQuestionAuthoringProjectFromPackage(parsed.questionPackage)
    expect(reimported.question.setup?.builderPolicy).toEqual(POLICY)
  })

  it('stores nothing when the policy is all-default (today’s behaviour)', () => {
    const result = compileQuestionAuthoringExportBundle(project())
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect('builderPolicy' in result.bundle.questionPackage).toBe(false)
    expect(result.content).not.toContain('builderPolicy')

    const updated = updateQuestionAuthoringSetup(
      project(),
      {
        ...structuredClone(DEFAULT_QUESTION_AUTHORING_SETUP),
        builderPolicy: { allowServiceBuilder: true }
      },
      FIXED_TIME
    )
    const compiled = compileQuestionAuthoringExportBundle(updated)
    expect(compiled.status).toBe('ready')
    if (compiled.status !== 'ready') return
    expect('builderPolicy' in compiled.bundle.questionPackage).toBe(false)
  })

  it('rejects unknown policy fields in a saved project', () => {
    const raw = JSON.parse(serializeQuestionAuthoringProject(project(POLICY))) as {
      question: { setup: { builderPolicy: Record<string, unknown> } }
    }
    raw.question.setup.builderPolicy.requireContracts = true
    expect(() => deserializeQuestionAuthoringProject(JSON.stringify(raw))).toThrow()
  })
})
