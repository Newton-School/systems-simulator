/**
 * Whether a question can run in Classroom mode. Classroom never invents the
 * numbers a lecture depends on: a question must state the capacity of every
 * compute component it lets students place, must state its peak traffic, and
 * must be solvable within the cards' copy limits. Otherwise the question stays
 * in Architect mode and the app says why.
 */
import { componentTypeSatisfies } from '../catalog/componentFamilies'
import type { QuestionPackage } from '../analysis/question'
import { classroomRunConditions, minimumClassroomCopies } from './compileClassroom'
import { classroomCardsForQuestion } from './givensTable'
import { conceptCardForType } from './conceptCards'
import { questionAllowsAbstraction, type Abstraction } from './types'

export type ClassroomReadiness = { ready: true } | { ready: false; reason: string }

export type ReadinessQuestion = Pick<
  QuestionPackage,
  'constraints' | 'suite' | 'prompt' | 'classroom'
>

type ConceptFirstAbstraction = Extract<Abstraction, 'classroom' | 'guided'>

const readinessCache = new WeakMap<
  object,
  Partial<Record<ConceptFirstAbstraction, ClassroomReadiness>>
>()

/** `classroomReadiness`, cached per question object (it is read on every render). */
export function cachedClassroomReadiness(
  question: ReadinessQuestion,
  abstraction: ConceptFirstAbstraction = 'classroom'
): ClassroomReadiness {
  const cached = readinessCache.get(question)?.[abstraction]
  if (cached) return cached
  const readiness = classroomReadiness(question, abstraction)
  readinessCache.set(question, { ...readinessCache.get(question), [abstraction]: readiness })
  return readiness
}

/** The givens the question itself states for a component type (family-aware), if any. */
function statedCapacity(
  question: ReadinessQuestion,
  type: string
): { capacityRps?: number; cacheHitRate?: number; label?: string } {
  const givens = question.classroom?.givens ?? {}
  if (givens[type]) return givens[type]
  const key = Object.keys(givens).find(
    (entry) => componentTypeSatisfies(type, entry) || componentTypeSatisfies(entry, type)
  )
  return key ? givens[key] : {}
}

export function classroomReadiness(
  question: ReadinessQuestion,
  abstraction: ConceptFirstAbstraction = 'classroom'
): ClassroomReadiness {
  if (!questionAllowsAbstraction(question.classroom, abstraction)) {
    const architectOnly = question.classroom?.abstractions?.every(
      (allowed) => allowed === 'architect'
    )
    return {
      ready: false,
      reason: architectOnly
        ? 'The question is set to Architect mode only.'
        : `The question doesn't allow ${abstraction === 'guided' ? 'Guided' : 'Classroom'} mode.`
    }
  }
  const peak = classroomRunConditions(question).workload?.baseRps
  if (!peak) {
    return { ready: false, reason: "The question doesn't state its peak traffic." }
  }
  const allowed = question.constraints.allowedNodeTypes
  if (!allowed || allowed.length === 0) {
    return {
      ready: false,
      reason: "The question doesn't declare which Classroom components students may use."
    }
  }
  for (const type of allowed) {
    if (!conceptCardForType(type)) {
      return {
        ready: false,
        reason: `The allowed component '${type}' has no Classroom concept card.`
      }
    }
  }
  for (const card of classroomCardsForQuestion(question)) {
    if (card.role !== 'compute') continue
    const type = card.covers[0]
    const stated = statedCapacity(question, type)
    const name = stated.label ?? card.label
    if (stated.capacityRps === undefined) {
      return {
        ready: false,
        reason: `The question doesn't state how many requests per second a ${name} handles.`
      }
    }
    const minimum = minimumClassroomCopies(question, type)
    const max = card.copies?.max
    if (minimum !== null && max !== undefined && minimum > max) {
      return {
        ready: false,
        // Never name the minimum: working it out is the lesson.
        reason: `The question can't be solved with ${max} or fewer ${name} instances, the most Classroom allows.`
      }
    }
  }
  // Turning caching on needs a stated hit rate: it decides how much traffic reaches
  // the next component, and Classroom never invents it.
  for (const [type, choices] of Object.entries(question.classroom?.choices ?? {})) {
    if (!choices.some((choice) => choice.target === 'cache-enabled')) continue
    const stated = statedCapacity(question, type)
    if (stated.cacheHitRate === undefined) {
      const name = stated.label ?? conceptCardForType(type)?.label ?? type
      return {
        ready: false,
        reason: `The question lets students turn caching on but doesn't state the ${name}'s hit rate.`
      }
    }
  }
  return { ready: true }
}
