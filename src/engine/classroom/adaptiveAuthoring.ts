import type { QuestionAuthoringSetupDraft } from '../analysis/questionAuthoringProject'
import { conceptCardForType, getConceptCard, type ConceptCardId } from './conceptCards'
import { getSystemDesignConcept } from './systemDesignConceptRegistry'
import type { ClassroomCheck, ClassroomCheckTemplate, ClassroomStudentControl } from './types'

export interface AdaptiveAuthoringResult {
  setup: QuestionAuthoringSetupDraft
  applied: boolean
  reason: string
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

function recommendedTypes(cardIds: readonly string[]): string[] {
  return cardIds.map((id) => getConceptCard(id as ConceptCardId).covers[0])
}

function defaultControls(
  kinds: readonly string[],
  objectiveId: string,
  types: readonly string[]
): ClassroomStudentControl[] {
  const cards = types.map((type) => ({ type, card: conceptCardForType(type) }))
  const compute = cards.find(({ card }) => card?.role === 'compute')?.type ?? 'microservice'
  const controls: ClassroomStudentControl[] = []

  if (kinds.includes('place-component')) {
    for (const { type, card } of cards) {
      controls.push({
        id: `${objectiveId}-place-${type}`,
        kind: 'place-component',
        label: `Place ${card?.label ?? type}`,
        component: type,
        objectiveId
      })
    }
  }
  if (kinds.includes('connect-components')) {
    controls.push({
      id: `${objectiveId}-connections`,
      kind: 'connect-components',
      label: 'Connect the lesson components',
      objectiveId
    })
  }
  if (kinds.includes('copies')) {
    controls.push({
      id: `${objectiveId}-copies`,
      kind: 'copies',
      label: `Choose the number of ${conceptCardForType(compute)?.label ?? 'component'} instances`,
      component: compute,
      objectiveId
    })
  }
  return controls
}

/**
 * Drop starter decisions another objective already declares (two concepts in one
 * lesson both offer "place the Server" and "connect"), keeping at least one so
 * every objective still has a student decision.
 */
function withoutDeclaredDecisions(
  proposed: readonly ClassroomStudentControl[],
  existing: readonly ClassroomStudentControl[]
): ClassroomStudentControl[] {
  const key = (control: ClassroomStudentControl): string =>
    `${control.kind}|${'component' in control ? (control.component ?? '') : ''}`
  const declared = new Set(existing.map(key))
  const fresh = proposed.filter((control) => !declared.has(key(control)))
  return fresh.length > 0 ? fresh : proposed.slice(0, 1)
}

function defaultCheck(
  template: ClassroomCheckTemplate,
  objectiveId: string,
  types: readonly string[]
): ClassroomCheck {
  const cards = types.map((type) => ({ type, card: conceptCardForType(type) }))
  const compute = cards.find(({ card }) => card?.role === 'compute')?.type ?? 'microservice'
  const via = cards.find(({ card }) => card?.role === 'passthrough')?.type ?? compute
  return {
    id: `${objectiveId}-${template}`,
    template,
    label:
      template === 'traffic-flows-through'
        ? `Traffic follows the required path through ${conceptCardForType(via)?.label ?? 'the lesson component'}`
        : template === 'within-target-utilization'
          ? 'The selected instance count stays within the utilization target'
          : 'The design serves all stated traffic',
    objectiveId,
    ...(template === 'traffic-flows-through' ? { via, component: compute } : {}),
    ...(template === 'within-target-utilization' ? { component: compute } : {})
  }
}

/**
 * Apply only the smallest objective-backed starter contract. Author-entered prose,
 * givens, controls and checks are preserved; the recipe never invents capacity or
 * workload numbers that were not stated by the source question.
 */
export function applyAdaptiveAuthoringRecipe(
  setup: QuestionAuthoringSetupDraft,
  conceptId: string
): AdaptiveAuthoringResult {
  const concept = getSystemDesignConcept(conceptId)
  if (!concept) return { setup, applied: false, reason: `Unknown concept '${conceptId}'.` }
  const recipe = concept.authoring
  if (recipe.outcome !== 'classroom-direct' && recipe.outcome !== 'classroom-structural') {
    return {
      setup: { ...setup, concepts: unique([...setup.concepts, concept.id]) },
      applied: false,
      reason: recipe.boundary
    }
  }

  const types = recommendedTypes(recipe.recommendedCards)
  const objectiveId = `objective-${concept.id.toLowerCase()}`
  const existingObjective = setup.classroom?.objectives?.find(
    (objective) => objective.concept === concept.id
  )
  const objective =
    existingObjective ??
    ({
      id: objectiveId,
      statement: `The student can ${recipe.objectiveStem}.`,
      concept: concept.id
    } as const)
  const controls = setup.classroom?.controls ?? []
  const checks = setup.classroom?.checks ?? []
  const scoredTemplate = recipe.compatibleChecks.find((template) => template !== 'right-sized') as
    | ClassroomCheckTemplate
    | undefined

  return {
    applied: true,
    reason: recipe.boundary,
    setup: {
      ...setup,
      type: recipe.activity === 'size' ? 'scaling' : setup.type,
      concepts: unique([...setup.concepts, concept.id]),
      constraints: {
        ...setup.constraints,
        allowedNodeTypes: unique([...(setup.constraints.allowedNodeTypes ?? []), ...types])
      },
      classroom: {
        ...(setup.classroom ?? {}),
        abstractions: unique([
          ...(setup.classroom?.abstractions ?? []),
          'classroom',
          'guided',
          'architect'
        ]),
        objectives: existingObjective
          ? setup.classroom?.objectives
          : [...(setup.classroom?.objectives ?? []), objective],
        controls: controls.some((control) => control.objectiveId === objective.id)
          ? controls
          : [
              ...controls,
              ...withoutDeclaredDecisions(
                defaultControls(recipe.allowedDecisionKinds, objective.id, types),
                controls
              )
            ],
        checks:
          !scoredTemplate ||
          checks.some(
            (check) => check.objectiveId === objective.id && check.severity !== 'feedback'
          )
            ? checks
            : [...checks, defaultCheck(scoredTemplate, objective.id, types)],
        ...((recipe.requiredGivens as readonly string[]).includes('maxUtilization')
          ? {
              targets: {
                ...(setup.classroom?.targets ?? {}),
                maxUtilization: setup.classroom?.targets?.maxUtilization ?? 0.8
              }
            }
          : {})
      }
    }
  }
}
