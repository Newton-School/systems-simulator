import type { SemanticCriterion } from './gradingCriteria'
import { hasNewtonQuestionRows, parseNewtonRowsToQuestionPackage } from './newtonQuestionRows'
import { parseQuestionPackage, type QuestionPackage } from './question'
import {
  createQuestionAuthoringProject,
  parseQuestionAuthoringProject,
  QUESTION_AUTHORING_PROJECT_ARTIFACT,
  type QuestionAuthoringProject
} from './questionAuthoringProject'
import { decompileAuthoringScenario } from './questionAuthoringScenario'
import type { AuthoringSemanticRuleDraft } from './questionAuthoringSemanticRules'
import type { AuthoringStructuralRuleDraft } from './questionAuthoringStructuralRules'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function semanticDraft(criterion: SemanticCriterion): AuthoringSemanticRuleDraft {
  const base = {
    id: criterion.id,
    kind: criterion.kind,
    points: criterion.points,
    ...(criterion.hardFail ? { hardFail: true } : {})
  }
  switch (criterion.kind) {
    case 'componentPresence':
      return {
        ...base,
        componentType: criterion.componentType,
        minCount: criterion.minCount ?? 1
      }
    case 'componentProperty':
      return {
        ...base,
        parentId: criterion.parentId,
        property: criterion.property,
        propertyOperator: criterion.operator,
        expected: criterion.expected
      }
    case 'placement':
      return {
        ...base,
        componentType: criterion.componentType,
        betweenFrom: criterion.between?.[0],
        betweenTo: criterion.between?.[1],
        notBefore: criterion.notBefore,
        orderedPipeline: criterion.orderedPipeline ? [...criterion.orderedPipeline] : undefined
      }
    case 'guardedPath':
      return { ...base, from: criterion.from, guard: criterion.guard, to: criterion.to }
    case 'fanout':
      return {
        ...base,
        broker: criterion.broker,
        minConsumers: criterion.minConsumers,
        forbiddenBroker: criterion.forbiddenBroker
      }
    case 'storageFit':
      return {
        ...base,
        accessPattern: criterion.accessPattern,
        accept: [...criterion.accept],
        partial: criterion.partial ? [...criterion.partial] : undefined,
        antiPattern: criterion.antiPattern ? [...criterion.antiPattern] : undefined
      }
    case 'forbidUnjustified':
      return {
        ...base,
        componentType: criterion.componentType,
        justifyId: criterion.justifyId
      }
    case 'stateTransition':
      return {
        ...base,
        runtimeScope: criterion.match.scope,
        runtimeState: criterion.match.state,
        runtimeSource: criterion.match.source,
        runtimeNodeId: criterion.match.nodeId,
        runtimeNodeType: criterion.match.nodeType,
        runtimeReasonCode: criterion.match.reasonCode,
        whereCaseId: criterion.where?.caseId,
        whereOutcomeStatus: criterion.where?.outcomeStatus,
        whereTerminalNodeId: criterion.where?.terminalNodeId,
        whereTerminalNodeType: criterion.where?.terminalNodeType,
        minCount: criterion.minCount,
        maxCount: criterion.maxCount
      }
    case 'stateSequence':
      return {
        ...base,
        sequence: criterion.sequence.map((matcher) => ({ ...matcher })),
        minMatches: criterion.minMatches,
        whereCaseId: criterion.where?.caseId,
        whereOutcomeStatus: criterion.where?.outcomeStatus,
        whereTerminalNodeId: criterion.where?.terminalNodeId,
        whereTerminalNodeType: criterion.where?.terminalNodeType
      }
  }
}

function structuralDraft(
  rule: NonNullable<QuestionPackage['structuralRules']>[number]
): AuthoringStructuralRuleDraft {
  switch (rule.kind) {
    case 'requires_component':
      return {
        id: rule.id,
        kind: rule.kind,
        componentType: rule.componentType,
        minCount: rule.minCount
      }
    case 'requires_category':
      return { id: rule.id, kind: rule.kind, category: rule.category, minCount: rule.minCount }
    case 'requires_edge':
      return {
        id: rule.id,
        kind: rule.kind,
        fromType: rule.fromType,
        toType: rule.toType,
        mode: rule.mode
      }
    case 'requires_path':
      return { id: rule.id, kind: rule.kind, fromType: rule.fromType, toType: rule.toType }
    case 'max_component_count':
      return {
        id: rule.id,
        kind: rule.kind,
        componentType: rule.componentType,
        maxCount: rule.maxCount
      }
    case 'requires_redundancy':
      return {
        id: rule.id,
        kind: rule.kind,
        componentType: rule.componentType,
        minReplicas: rule.minReplicas
      }
    case 'forbids_component':
      return { id: rule.id, kind: rule.kind, componentType: rule.componentType }
    case 'min_node_count':
    case 'max_node_count':
      return { id: rule.id, kind: rule.kind, count: rule.count }
    case 'requires_connected_graph':
    case 'requires_single_source':
      return { id: rule.id, kind: rule.kind }
  }
}

export function createQuestionAuthoringProjectFromPackage(
  question: QuestionPackage
): QuestionAuthoringProject {
  const scenarios = question.suite.cases.map(decompileAuthoringScenario)
  const matchingDryRun = question.suite.dryRunCase
    ? scenarios.find((scenario) => scenario.id === question.suite.dryRunCase?.id)
    : undefined
  const project = createQuestionAuthoringProject({
    title: question.title,
    description: question.description,
    tags: question.tags,
    author: question.author,
    createdAt: question.createdAt,
    setup: {
      difficulty: question.difficulty,
      type: question.type,
      entryFormat: question.entryFormat,
      domains: question.domains ? [...question.domains] : [],
      concepts: question.concepts ? [...question.concepts] : [],
      workloadCategory: question.workloadCategory,
      estimatedTimeMinutes: question.estimatedTimeMinutes,
      passThreshold: question.rubric.passThreshold,
      suiteVisibleToStudent: question.suite.visibleToStudent,
      budget: question.budget ? { ...question.budget } : undefined,
      constraints: { ...question.constraints }
    },
    problemStatement: question.prompt.text,
    additionalContext: question.prompt.additionalContext,
    scale: { ...question.prompt.scale },
    functionalRequirements: question.prompt.functionalRequirements.map((text, index) => ({
      id: `fr-${index + 1}`,
      text
    })),
    nonFunctionalRequirements: question.prompt.nonFunctionalRequirements.map(
      (requirement, index) => ({
        id: `nfr-${index + 1}`,
        metric: requirement.metric,
        operator: requirement.operator,
        value: requirement.value,
        unit: requirement.unit
      })
    ),
    scenarios,
    dryRunScenarioId: matchingDryRun?.id,
    dryRunCase: matchingDryRun ? undefined : question.suite.dryRunCase,
    structuralRules: question.structuralRules?.map(structuralDraft),
    semanticRules: question.semanticCriteria?.map(semanticDraft),
    rubricChecks: question.rubric.checks.map((check) => ({
      id: check.id,
      metric: check.metric,
      op: check.op,
      value: check.value,
      points: check.points ?? 1
    })),
    justify: question.justify,
    scaffoldTopology: question.scaffold.topology
  })
  project.question.id = question.id
  project.assets.lockedNodeIds = question.scaffold.lockedNodeIds
    ? [...question.scaffold.lockedNodeIds]
    : undefined
  project.assets.lockedEdgeIds = question.scaffold.lockedEdgeIds
    ? [...question.scaffold.lockedEdgeIds]
    : undefined
  project.assets.baselineVerdict = question.scaffold.baselineVerdict
    ? structuredClone(question.scaffold.baselineVerdict)
    : undefined
  return parseQuestionAuthoringProject(project)
}

export function importQuestionAuthoringArtifact(input: unknown): QuestionAuthoringProject {
  if (isRecord(input) && input.artifact === QUESTION_AUTHORING_PROJECT_ARTIFACT) {
    return parseQuestionAuthoringProject(input)
  }
  if (isRecord(input) && input.artifact === 'dsds-question-export-bundle') {
    return parseQuestionAuthoringProject(input.authoringProject)
  }
  if (isRecord(input) && hasNewtonQuestionRows(input)) {
    return createQuestionAuthoringProjectFromPackage(
      parseNewtonRowsToQuestionPackage(input).questionPackage
    )
  }
  return createQuestionAuthoringProjectFromPackage(parseQuestionPackage(input))
}

export function deserializeQuestionAuthoringArtifact(content: string): QuestionAuthoringProject {
  return importQuestionAuthoringArtifact(JSON.parse(content) as unknown)
}
