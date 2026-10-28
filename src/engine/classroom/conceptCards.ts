/**
 * Concept cards: how each component family looks and behaves in Classroom mode.
 *
 * A card is defined once for every question. It names the component in lecture
 * language, lists the numbers that describe it (givens), says what a student may
 * decide about it, and compiles givens + decisions into ordinary engine config.
 *
 * The registry is intentionally data-driven: question authoring and the learner
 * palette read the same entries, so adding a question family is a card addition,
 * not another QuickCart-shaped branch in the compiler.
 */
import { componentTypeSatisfies } from '../catalog/componentFamilies'
import { INSTANCE_CATALOG } from '../catalog/instanceCatalog'
import { instantiateTemplate } from '../catalog/paletteTemplates'
import type { ComponentNode, ComponentType } from '../core/types'
import { nodeCapacityRps } from '../analysis/fluidModel'
import type { CardGivens } from './types'

export type ConceptCardId =
  | 'users'
  | 'api-gateway'
  | 'cdn'
  | 'load-balancer'
  | 'server'
  | 'worker'
  | 'cache'
  | 'sql-database'
  | 'nosql-database'
  | 'queue'

export type ConceptCardRole = 'source' | 'passthrough' | 'compute'

export interface ConceptCard {
  id: ConceptCardId
  /** Default lecture name; a question may rename it through its givens. */
  label: string
  /** One line for the palette tooltip and the inspector. */
  summary: string
  role: ConceptCardRole
  /** Engine role retained after Classroom strips the component's hidden config. */
  nodeRole?: ComponentNode['role']
  /** Plain-language fixed fact shown for non-capacity cards. */
  classroomFact?: string
  /** Engine component types (family-aware: 'load-balancer' covers L4 and L7). */
  covers: readonly ComponentType[]
  /** Palette templates that place this card, in palette order. */
  templateIds: readonly string[]
  /** Copy-count bounds for cards that scale by copies. Absent = always one. */
  copies?: { min: number; max: number }
}

export const CONCEPT_CARDS: readonly ConceptCard[] = [
  {
    id: 'users',
    label: 'Users',
    summary: 'Where traffic enters. The peak comes from the problem.',
    role: 'source',
    covers: ['api-endpoint'],
    templateIds: ['input-source', 'client-user']
  },
  {
    id: 'api-gateway',
    label: 'API Gateway',
    summary: 'A single front door that routes API requests to services.',
    classroomFact: 'Routes requests to the right service',
    role: 'passthrough',
    covers: ['api-gateway'],
    templateIds: ['api-gateway']
  },
  {
    id: 'cdn',
    label: 'CDN',
    summary: 'Serves cacheable content close to users before it reaches the origin.',
    classroomFact: 'Serves cacheable content at the edge',
    role: 'passthrough',
    covers: ['cdn'],
    templateIds: ['cdn']
  },
  {
    id: 'load-balancer',
    label: 'Load Balancer',
    summary: 'Spreads requests evenly across everything behind it. No capacity limit.',
    classroomFact: 'Spreads traffic evenly',
    role: 'passthrough',
    covers: ['load-balancer'],
    templateIds: ['load-balancer-l7', 'load-balancer-l4']
  },
  {
    id: 'server',
    label: 'Server',
    summary: 'Serves requests. Each instance handles a fixed number per second.',
    role: 'compute',
    covers: ['microservice'],
    templateIds: ['backend-server', 'generic-service'],
    copies: { min: 1, max: 50 }
  },
  {
    id: 'worker',
    label: 'Worker',
    summary: 'Processes background jobs. Scale it by adding instances.',
    role: 'compute',
    covers: ['batch-worker'],
    templateIds: ['async-worker'],
    copies: { min: 1, max: 50 }
  },
  {
    id: 'cache',
    label: 'Cache',
    summary: 'Keeps frequently used data close to the application.',
    role: 'compute',
    nodeRole: 'storage',
    covers: ['in-memory-cache'],
    templateIds: ['redis-cache'],
    copies: { min: 1, max: 50 }
  },
  {
    id: 'sql-database',
    label: 'SQL Database',
    summary: 'Stores relational application data.',
    role: 'compute',
    nodeRole: 'storage',
    covers: ['relational-db'],
    templateIds: ['primary-db'],
    copies: { min: 1, max: 50 }
  },
  {
    id: 'nosql-database',
    label: 'NoSQL Database',
    summary: 'Stores document, key-value or wide-column data.',
    role: 'compute',
    nodeRole: 'storage',
    covers: ['nosql-db'],
    templateIds: ['nosql-db'],
    copies: { min: 1, max: 50 }
  },
  {
    id: 'queue',
    label: 'Queue',
    summary: 'Buffers work between a producer and its consumers.',
    classroomFact: 'Buffers work for asynchronous processing',
    role: 'passthrough',
    nodeRole: 'storage',
    covers: ['queue'],
    templateIds: ['message-queue']
  }
]

const CARD_BY_ID = new Map(CONCEPT_CARDS.map((card) => [card.id, card]))

export function getConceptCard(id: ConceptCardId): ConceptCard {
  const card = CARD_BY_ID.get(id)
  if (!card) throw new Error(`Unknown concept card: ${id}`)
  return card
}

/** The card a component type belongs to, or undefined when Classroom mode has none for it. */
export function conceptCardForType(type: string): ConceptCard | undefined {
  return CONCEPT_CARDS.find((card) =>
    card.covers.some((covered) => componentTypeSatisfies(type, covered))
  )
}

/** The card a palette template places, or undefined when it isn't a Classroom component. */
export function conceptCardForTemplate(templateId: string | undefined): ConceptCard | undefined {
  if (!templateId) return undefined
  return CONCEPT_CARDS.find((card) => card.templateIds.includes(templateId))
}

/** Two significant figures, so students see "50k req/s", not "49,231 req/s". */
export function roundGiven(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return value
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1)
  return Math.round(value / magnitude) * magnitude
}

const defaultGivensCache = new Map<ConceptCardId, CardGivens>()

/**
 * Givens a card falls back to when the question states none: the capacity and
 * price the card's first palette template derives today, rounded. Computed from a
 * fresh template, never from a submitted node, so a student can't raise it.
 */
export function defaultCardGivens(card: ConceptCard): CardGivens {
  if (card.role !== 'compute') return {}
  const cached = defaultGivensCache.get(card.id)
  if (cached) return cached

  const templateId = card.templateIds[0]
  const sim = instantiateTemplate(templateId).sim
  const node: ComponentNode = {
    id: `default-${card.id}`,
    type: card.covers[0],
    category: 'compute',
    label: card.label,
    position: { x: 0, y: 0 },
    ...(sim?.resources ? { resources: sim.resources } : {}),
    ...(sim?.queue ? { queue: sim.queue } : {}),
    ...(sim?.processing ? { processing: sim.processing } : {})
  }
  const capacity = nodeCapacityRps(node)
  const instanceType = sim?.resources?.instanceType
  const price = instanceType ? INSTANCE_CATALOG[instanceType].pricePerHour : undefined
  const givens: CardGivens = {
    ...(Number.isFinite(capacity) && capacity > 0 ? { capacityRps: roundGiven(capacity) } : {}),
    ...(price !== undefined ? { costPerHour: price } : {})
  }
  defaultGivensCache.set(card.id, givens)
  return givens
}
