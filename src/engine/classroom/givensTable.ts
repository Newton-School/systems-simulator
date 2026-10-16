/**
 * The words Classroom mode uses for givens: the brief's givens table, palette
 * tile chips and node chips all read from here, so the prompt and the canvas can
 * never describe the same component differently.
 */
import { componentTypeSatisfies } from '../catalog/componentFamilies'
import type { QuestionPackage } from '../analysis/question'
import { CONCEPT_CARDS, type ConceptCard } from './conceptCards'
import { classroomRunConditions, resolveClassroomGivens } from './compileClassroom'
import type { ClassroomSettings } from './types'

export interface GivensRow {
  /** Stable key for lists. */
  id: string
  component: string
  given: string
}

export function formatRps(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} req/s`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`
}

export function formatCostPerHour(value: number): string {
  return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}/hr`
}

/** Cards the question lets the student place (family-aware against `allowedNodeTypes`). */
export function classroomCardsForQuestion(
  question: Pick<QuestionPackage, 'constraints'>
): ConceptCard[] {
  const allowed = question.constraints.allowedNodeTypes
  if (!allowed) return [...CONCEPT_CARDS]
  // Either direction: an allowed generic type ('load-balancer') covers the card, and
  // so does an allowed subtype ('load-balancer-l7') of the card's family.
  return CONCEPT_CARDS.filter((card) =>
    card.covers.some((type) =>
      allowed.some(
        (entry) => componentTypeSatisfies(type, entry) || componentTypeSatisfies(entry, type)
      )
    )
  )
}

/** Short chips for a card's givens, e.g. ["100,000 req/s each", "$0.192/hr each"]. */
export function givensChips(
  card: ConceptCard,
  type: string,
  settings: ClassroomSettings | undefined
): string[] {
  const givens = resolveClassroomGivens(card, type, settings)
  return [
    ...(card.classroomFact ? [card.classroomFact] : []),
    ...(givens.capacityRps !== undefined ? [`${formatRps(givens.capacityRps)} each`] : []),
    ...(givens.readCapacityRps !== undefined ? [`${formatRps(givens.readCapacityRps)} reads`] : []),
    ...(givens.writeCapacityRps !== undefined
      ? [`${formatRps(givens.writeCapacityRps)} writes`]
      : []),
    ...(givens.cacheHitRate !== undefined
      ? [`${formatPercent(givens.cacheHitRate)} cache hits`]
      : []),
    ...(givens.latencyMs !== undefined ? [`${givens.latencyMs} ms fixed delay`] : []),
    ...(givens.costPerHour !== undefined ? [`${formatCostPerHour(givens.costPerHour)} each`] : [])
  ]
}

/** The givens table for the brief: traffic, every placeable component, and the targets. */
export function classroomGivensTable(
  question: Pick<QuestionPackage, 'constraints' | 'suite' | 'prompt' | 'classroom'>
): GivensRow[] {
  const settings = question.classroom
  const rows: GivensRow[] = []
  const peak = classroomRunConditions(question).workload?.baseRps
  for (const card of classroomCardsForQuestion(question)) {
    const type = card.covers[0]
    const label = resolveClassroomGivens(card, type, settings).label
    if (card.role === 'source') {
      if (peak !== undefined) {
        rows.push({ id: card.id, component: label, given: `${formatRps(peak)} at peak` })
      }
      continue
    }
    const chips = givensChips(card, type, settings)
    if (chips.length > 0) {
      rows.push({ id: card.id, component: label, given: chips.join(' · ') })
    }
  }
  const targets = settings?.targets
  if (targets?.maxUtilization !== undefined) {
    rows.push({
      id: 'target-utilization',
      component: 'Rule',
      given: `Keep every component at or below ${formatPercent(targets.maxUtilization)} utilization`
    })
  }
  if (targets?.maxErrorRate !== undefined) {
    rows.push({
      id: 'target-errors',
      component: 'Rule',
      given: `Drop fewer than ${formatPercent(targets.maxErrorRate)} of requests`
    })
  }
  return rows
}
