import {
  compileQuestionPackageToNewtonRows,
  toNewtonRowsSeed,
  type CompiledNewtonQuestionRows,
  type NewtonQuestionRowsSeed
} from './newtonQuestionRows'
import { compileAuthoringMetricRule } from './questionAuthoringMetricRules'
import { compileAuthoringNfr } from './questionAuthoringNfr'
import {
  resolveQuestionAuthoringSetup,
  type AuthoringStageId,
  type QuestionAuthoringProject
} from './questionAuthoringProject'
import { compileAuthoringScenario } from './questionAuthoringScenario'
import { compileAuthoringRubricCheck } from './questionAuthoringRubricChecks'
import { compileAuthoringSemanticRule } from './questionAuthoringSemanticRules'
import { compileAuthoringStructuralRule } from './questionAuthoringStructuralRules'
import { parseQuestionPackage, QUESTION_PACKAGE_VERSION, type QuestionPackage } from './question'
import {
  validateAuthoredQuestion,
  type AuthoringDiagnostic,
  type AuthoringLevel
} from './authoringValidator'
import { buildDjangoQuestionExport, type DjangoQuestionExport } from './djangoQuestionExport'

export interface QuestionAuthoringPreviewDiagnostic {
  level: AuthoringLevel
  code: string
  message: string
  path?: string
  stage: AuthoringStageId
}

interface BlockedQuestionAuthoringPreview {
  status: 'blocked'
  diagnostics: QuestionAuthoringPreviewDiagnostic[]
}

export interface ReadyQuestionAuthoringPreview {
  status: 'ready'
  diagnostics: QuestionAuthoringPreviewDiagnostic[]
  questionPackage: QuestionPackage
  compiledRows: CompiledNewtonQuestionRows
  newtonSeed: NewtonQuestionRowsSeed
  packageJson: string
  newtonRowsJson: string
  django: DjangoQuestionExport
  djangoJson: string
}

export type QuestionAuthoringPreview =
  | BlockedQuestionAuthoringPreview
  | ReadyQuestionAuthoringPreview

function draftError(
  code: string,
  message: string,
  path: string,
  stage: AuthoringStageId
): QuestionAuthoringPreviewDiagnostic {
  return { level: 'error', code, message, path, stage }
}

function stageForPath(path?: string): AuthoringStageId {
  if (!path) return 'export'
  if (path.startsWith('prompt')) return 'brief'
  if (path.startsWith('scaffold') || path.startsWith('constraints')) return 'start'
  if (path.startsWith('suite')) return 'scenarios'
  if (
    path.startsWith('rubric') ||
    path.startsWith('structuralRules') ||
    path.startsWith('semanticCriteria')
  ) {
    return 'grading'
  }
  return 'export'
}

function mapAuthoringDiagnostic(
  diagnostic: AuthoringDiagnostic
): QuestionAuthoringPreviewDiagnostic {
  return { ...diagnostic, stage: stageForPath(diagnostic.path) }
}

function collectDraftDiagnostics(
  project: QuestionAuthoringProject
): QuestionAuthoringPreviewDiagnostic[] {
  const { question } = project
  const diagnostics: QuestionAuthoringPreviewDiagnostic[] = []

  if (!question.title.trim()) {
    diagnostics.push(
      draftError('draft.titleRequired', 'Add a question title.', 'question.title', 'frame')
    )
  }
  if (!question.prompt.text.trim()) {
    diagnostics.push(
      draftError(
        'draft.problemRequired',
        'Add a learner-facing problem statement.',
        'question.prompt.text',
        'brief'
      )
    )
  }

  question.prompt.functionalRequirements.forEach((requirement, index) => {
    if (!requirement.text.trim()) {
      diagnostics.push(
        draftError(
          'draft.functionalRequirementIncomplete',
          `Complete functional requirement ${index + 1} or remove it.`,
          `question.prompt.functionalRequirements[${index}]`,
          'brief'
        )
      )
    }
  })
  question.prompt.nonFunctionalRequirements.forEach((requirement, index) => {
    if (!compileAuthoringNfr(requirement)) {
      diagnostics.push(
        draftError(
          'draft.nonFunctionalRequirementIncomplete',
          `Complete non-functional requirement ${index + 1} or remove it.`,
          `question.prompt.nonFunctionalRequirements[${index}]`,
          'brief'
        )
      )
    }
  })

  if (question.scenarios.length === 0) {
    diagnostics.push(
      draftError(
        'draft.scenarioRequired',
        'Add at least one valid scenario.',
        'question.scenarios',
        'scenarios'
      )
    )
  }
  question.scenarios.forEach((scenario, index) => {
    if (!compileAuthoringScenario(scenario)) {
      diagnostics.push(
        draftError(
          'draft.scenarioIncomplete',
          `Complete scenario ${index + 1} or remove it.`,
          `question.scenarios[${index}]`,
          'scenarios'
        )
      )
    }
  })

  question.structuralRules.forEach((rule, index) => {
    if (!compileAuthoringStructuralRule(rule)) {
      diagnostics.push(
        draftError(
          'draft.structuralRuleIncomplete',
          `Complete structural rule ${index + 1} or remove it.`,
          `question.structuralRules[${index}]`,
          'grading'
        )
      )
    }
  })

  question.semanticRules.forEach((rule, index) => {
    if (!compileAuthoringSemanticRule(rule)) {
      diagnostics.push(
        draftError(
          'draft.semanticRuleIncomplete',
          `Complete semantic rule ${index + 1} or remove it.`,
          `question.semanticRules[${index}]`,
          'grading'
        )
      )
    }
    if (rule.kind === 'componentProperty') {
      const parent = question.semanticRules.find((candidate) => candidate.id === rule.parentId)
      if (!parent || parent.kind !== 'componentPresence') {
        diagnostics.push(
          draftError(
            'draft.semanticRuleParentMissing',
            `Configuration requirement ${index + 1} must belong to a component requirement.`,
            `question.semanticRules[${index}].parentId`,
            'grading'
          )
        )
      }
    }
  })

  if (
    question.structuralRules.length +
      question.semanticRules.length +
      question.metricRules.length +
      question.rubricChecks.length ===
    0
  ) {
    diagnostics.push(
      draftError(
        'draft.metricRuleRequired',
        'Add at least one valid grading check.',
        'question.metricRules',
        'grading'
      )
    )
  }
  question.metricRules.forEach((rule, index) => {
    if (!compileAuthoringMetricRule(rule)) {
      diagnostics.push(
        draftError(
          'draft.metricRuleIncomplete',
          `Complete metric test ${index + 1} or remove it.`,
          `question.metricRules[${index}]`,
          'grading'
        )
      )
    }
  })

  question.rubricChecks.forEach((check, index) => {
    if (!compileAuthoringRubricCheck(check)) {
      diagnostics.push(
        draftError(
          'draft.rubricCheckIncomplete',
          `Complete rubric check ${index + 1} or remove it.`,
          `question.rubricChecks[${index}]`,
          'grading'
        )
      )
    }
  })

  return diagnostics
}

function buildQuestionPackage(project: QuestionAuthoringProject): QuestionPackage {
  const { question } = project
  const setup = resolveQuestionAuthoringSetup(question.setup)
  // An empty canvas snapshot is not a learner scaffold. Imported drafts can
  // contain a structurally valid TopologyJSON object with no nodes; treating
  // that object as truthy incorrectly advertises a partial scaffold and leaks
  // an empty topology into the runtime package.
  const scaffoldTopology = project.assets.scaffoldTopology?.nodes.length
    ? project.assets.scaffoldTopology
    : undefined
  const entryFormat = scaffoldTopology
    ? setup.entryFormat === 'broken-scaffold' ||
      setup.entryFormat === 'locked-lab' ||
      setup.entryFormat === 'baseline-optimize'
      ? setup.entryFormat
      : 'partial-scaffold'
    : setup.entryFormat === 'requirements-first'
      ? setup.entryFormat
      : 'blank-canvas'
  const scenarios = question.scenarios.map((scenario) => compileAuthoringScenario(scenario)!)
  const firstScenario = question.scenarios[0]
  const dryRunCase = question.dryRunScenarioId
    ? scenarios.find((scenario) => scenario.id === question.dryRunScenarioId)
    : question.dryRunCase
  const structuralRules = question.structuralRules.map(
    (rule) => compileAuthoringStructuralRule(rule)!
  )
  const semanticCriteria = question.semanticRules.map((rule) => compileAuthoringSemanticRule(rule)!)
  const rubricChecks = [
    ...question.metricRules.map((rule) => compileAuthoringMetricRule(rule)!),
    ...question.rubricChecks.map((check) => compileAuthoringRubricCheck(check)!)
  ]

  return {
    version: QUESTION_PACKAGE_VERSION,
    id: question.id,
    title: question.title.trim(),
    ...(question.description?.trim() ? { description: question.description.trim() } : {}),
    ...(question.tags.length > 0 ? { tags: question.tags } : {}),
    difficulty: setup.difficulty,
    type: setup.type,
    entryFormat,
    ...(setup.estimatedTimeMinutes ? { estimatedTimeMinutes: setup.estimatedTimeMinutes } : {}),
    prompt: {
      text: question.prompt.text.trim(),
      functionalRequirements: question.prompt.functionalRequirements.map((requirement) =>
        requirement.text.trim()
      ),
      nonFunctionalRequirements: question.prompt.nonFunctionalRequirements.map(
        (requirement) => compileAuthoringNfr(requirement)!
      ),
      scale: {
        peakRps: question.prompt.scale.peakRps ?? firstScenario.baseRps!,
        readWriteRatio: question.prompt.scale.readWriteRatio ?? firstScenario.readPercent!,
        ...(question.prompt.scale.dau !== undefined ? { dau: question.prompt.scale.dau } : {}),
        ...(question.prompt.scale.storageGb !== undefined
          ? { storageGb: question.prompt.scale.storageGb }
          : {}),
        ...(question.prompt.scale.retentionDays !== undefined
          ? { retentionDays: question.prompt.scale.retentionDays }
          : {}),
        ...(question.prompt.scale.growthRatePercent !== undefined
          ? { growthRatePercent: question.prompt.scale.growthRatePercent }
          : {})
      },
      ...(question.prompt.additionalContext?.trim()
        ? { additionalContext: question.prompt.additionalContext.trim() }
        : {})
    },
    scaffold: scaffoldTopology
      ? {
          type: entryFormat === 'locked-lab' ? 'complete' : 'partial',
          topology: scaffoldTopology,
          ...(project.assets.lockedNodeIds?.length
            ? { lockedNodeIds: project.assets.lockedNodeIds }
            : {}),
          ...(project.assets.lockedEdgeIds?.length
            ? { lockedEdgeIds: project.assets.lockedEdgeIds }
            : {}),
          ...(project.assets.baselineVerdict
            ? { baselineVerdict: project.assets.baselineVerdict }
            : {})
        }
      : { type: 'empty' },
    constraints: setup.constraints,
    ...(structuralRules.length > 0 ? { structuralRules } : {}),
    ...(semanticCriteria.length > 0 ? { semanticCriteria } : {}),
    ...(question.justify.length > 0 ? { justify: question.justify } : {}),
    suite: {
      name: `${question.id}-suite`,
      cases: scenarios,
      visibleToStudent: setup.suiteVisibleToStudent,
      ...(dryRunCase ? { dryRunCase } : {})
    },
    rubric: {
      version: '1.0',
      id: `${question.id}-rubric`,
      passThreshold: setup.passThreshold,
      checks: rubricChecks
    },
    ...(setup.budget ? { budget: setup.budget } : {}),
    ...(setup.workloadCategory ? { workloadCategory: setup.workloadCategory } : {}),
    ...(setup.domains.length > 0 ? { domains: setup.domains } : {}),
    ...(setup.concepts.length > 0 ? { concepts: setup.concepts } : {}),
    author: question.author?.trim() || 'DSDS Question Studio',
    ...(question.createdAt ? { createdAt: question.createdAt } : {})
  }
}

export function compileQuestionAuthoringPreview(
  project: QuestionAuthoringProject
): QuestionAuthoringPreview {
  const draftDiagnostics = collectDraftDiagnostics(project)
  if (draftDiagnostics.some((diagnostic) => diagnostic.level === 'error')) {
    return { status: 'blocked', diagnostics: draftDiagnostics }
  }

  let questionPackage: QuestionPackage
  try {
    questionPackage = parseQuestionPackage(buildQuestionPackage(project))
  } catch (error) {
    return {
      status: 'blocked',
      diagnostics: [
        draftError(
          'package.schema',
          error instanceof Error ? error.message : 'Question package validation failed.',
          'question',
          'export'
        )
      ]
    }
  }

  const diagnostics = validateAuthoredQuestion(questionPackage).map(mapAuthoringDiagnostic)
  if (diagnostics.some((diagnostic) => diagnostic.level === 'error')) {
    return { status: 'blocked', diagnostics }
  }

  const compiledRows = compileQuestionPackageToNewtonRows(questionPackage)
  const newtonSeed = toNewtonRowsSeed(compiledRows)
  const django = buildDjangoQuestionExport(questionPackage, compiledRows)
  return {
    status: 'ready',
    diagnostics,
    questionPackage,
    compiledRows,
    newtonSeed,
    django,
    packageJson: `${JSON.stringify(questionPackage, null, 2)}\n`,
    newtonRowsJson: `${JSON.stringify(newtonSeed, null, 2)}\n`,
    djangoJson: `${JSON.stringify({ fields: django.fields, rows: django.rows }, null, 2)}\n`
  }
}
