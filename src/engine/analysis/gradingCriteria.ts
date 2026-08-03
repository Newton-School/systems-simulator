/**
 * Grading criteria — the extended, anti-gaming grading contract (Phase 1).
 *
 * This module adds the *new* grading axes reverse-engineered from the faculty
 * question bank + the SD prep doc (see
 * `specs/question-grading-model-and-anti-gaming.md`): semantic criteria that
 * grade topology *meaning* (placement, guarded paths, fan-out shape,
 * storage-fit), a first-class graph-consistent justification, and a cost/budget
 * cap. The existing `structuralRules` (node presence) and `rubric.checks`
 * (simulation metrics) axes stay as-is; these are additive and optional.
 *
 * Phase 1 is *typed contracts only* — the shapes and their parsers. No grading
 * logic yet; each criterion kind is graded in a later phase. Keeping it a pure,
 * additive, optional surface means existing question packages are unaffected.
 */
import { z } from 'zod'
import type { ComponentType } from '../core/types'

export const GRADING_CRITERIA_VERSION = '1.0' as const

/**
 * The data access pattern a store must fit. Drives `storageFit`: a pattern maps
 * to acceptable node types and to anti-patterns (e.g. relational at 200K w/s).
 */
export type AccessPattern =
  | 'point-lookup' // KV get-by-key (URL shortener)
  | 'time-series' // append + range-by-time (IoT / Lab 4)
  | 'append-only-ledger' // immutable double-entry (payments)
  | 'transactional-relational' // ACID, joins, money (bookings)
  | 'search-index' // full-text (Ticketmaster search)
  | 'blob' // large immutable objects (media)

/** The dominant workload character — the "the workload is [X]" framing. */
export type WorkloadCategory =
  | 'read-heavy'
  | 'write-heavy'
  | 'connection-heavy'
  | 'correctness-heavy'
  | 'batch-heavy'

interface CriterionBase {
  id: string
  description?: string
  points: number
  /** A hard fail zeroes the whole question regardless of other credit. */
  hardFail?: boolean
}

/**
 * Placement / ordering of a component relative to others, including forbidden
 * positions and ordered pipelines (frontier → fetch → process → extract).
 */
export interface PlacementCriterion extends CriterionBase {
  kind: 'placement'
  componentType: ComponentType
  /** Must sit on the path between these two component types (e.g. cache between AppServer & DB). */
  between?: [ComponentType, ComponentType]
  /** Must NOT sit before this component (e.g. cache not before the load balancer). */
  notBefore?: ComponentType
  /** These component types must appear in this order along a directed path. */
  orderedPipeline?: ComponentType[]
}

/**
 * The most reused anti-gaming primitive: all traffic from `from` to `to` must
 * traverse a mandatory `guard` node (rate-limiter → shared cache, booking → lock
 * store, payment write → idempotency store, crawler enqueue → dedup index).
 */
export interface GuardedPathCriterion extends CriterionBase {
  kind: 'guardedPath'
  from: ComponentType
  guard: ComponentType
  to?: ComponentType
}

/**
 * Node-type-aware fan-out: a *broker* must fan out to N independent consumers.
 * A single *queue* feeding N consumers is NOT fan-out (only one gets each
 * message) — that is the hard-fail case.
 */
export interface FanoutCriterion extends CriterionBase {
  kind: 'fanout'
  broker: ComponentType
  minConsumers: number
  /** Component type that, feeding N consumers, is the wrong answer (queue semantics). */
  forbiddenBroker?: ComponentType
}

/** Storage type must fit the access pattern at this scale. */
export interface StorageFitCriterion extends CriterionBase {
  kind: 'storageFit'
  accessPattern: AccessPattern
  /** Component types that earn full credit. */
  accept: ComponentType[]
  /** Component types that earn partial credit (defensible but suboptimal). */
  partial?: ComponentType[]
  /** Component types that are anti-patterns at this scale (hard-fail-worthy). */
  antiPattern?: ComponentType[]
}

/**
 * A component must be ABSENT, or, if present, defended by a bound justification
 * (anti-cargo-cult: "justify omission as much as inclusion" — Lab 5 CDN).
 */
export interface ForbidUnjustifiedCriterion extends CriterionBase {
  kind: 'forbidUnjustified'
  componentType: ComponentType
  /** The justify prompt id whose valid answer defends including this component. */
  justifyId?: string
}

export type SemanticCriterion =
  | PlacementCriterion
  | GuardedPathCriterion
  | FanoutCriterion
  | StorageFitCriterion
  | ForbidUnjustifiedCriterion

export type SemanticCriterionKind = SemanticCriterion['kind']

/**
 * A required, graph-consistent justification prompt bound to a specific
 * decision. Graded structurally: the answer must reference the actual chosen
 * node/type (graph-consistency — the anti-stuffing core), optionally cite a
 * scale number, and state a tradeoff.
 */
export interface JustifyPrompt {
  id: string
  /** The decision the student must defend, e.g. "Why this database type?". */
  decision: string
  /** Ties the justification to a real graph element. */
  boundTo?: { nodeId?: string; componentType?: ComponentType }
  requires: {
    /** Must reference the actual chosen node/type present in the graph. */
    choice: boolean
    /** Must cite a scale number this question defines. */
    number?: boolean
    /** Must state what is given up. */
    tradeoff: boolean
  }
  /** Author-provided acceptable tradeoff tokens (matched, plus a non-answer guard). */
  acceptTradeoffTokens?: string[]
}

/** Global cost/budget cap — the anti-kitchen-sink axis (nodes and edges). */
export interface Budget {
  unit: 'cost' | 'nodes' | 'edges'
  cap: number
}

// ── Zod schemas ──────────────────────────────────────────────────────────────

const ComponentTypeSchema = z.string() as unknown as z.ZodType<ComponentType>

const AccessPatternSchema = z.enum([
  'point-lookup',
  'time-series',
  'append-only-ledger',
  'transactional-relational',
  'search-index',
  'blob'
])

export const WorkloadCategorySchema = z.enum([
  'read-heavy',
  'write-heavy',
  'connection-heavy',
  'correctness-heavy',
  'batch-heavy'
])

const criterionBase = {
  id: z.string().min(1),
  description: z.string().optional(),
  points: z.number().int().nonnegative(),
  hardFail: z.boolean().optional()
}

export const SemanticCriterionSchema: z.ZodType<SemanticCriterion> = z.discriminatedUnion('kind', [
  z.object({
    ...criterionBase,
    kind: z.literal('placement'),
    componentType: ComponentTypeSchema,
    between: z.tuple([ComponentTypeSchema, ComponentTypeSchema]).optional(),
    notBefore: ComponentTypeSchema.optional(),
    orderedPipeline: z.array(ComponentTypeSchema).optional()
  }),
  z.object({
    ...criterionBase,
    kind: z.literal('guardedPath'),
    from: ComponentTypeSchema,
    guard: ComponentTypeSchema,
    to: ComponentTypeSchema.optional()
  }),
  z.object({
    ...criterionBase,
    kind: z.literal('fanout'),
    broker: ComponentTypeSchema,
    minConsumers: z.number().int().positive(),
    forbiddenBroker: ComponentTypeSchema.optional()
  }),
  z.object({
    ...criterionBase,
    kind: z.literal('storageFit'),
    accessPattern: AccessPatternSchema,
    accept: z.array(ComponentTypeSchema).min(1),
    partial: z.array(ComponentTypeSchema).optional(),
    antiPattern: z.array(ComponentTypeSchema).optional()
  }),
  z.object({
    ...criterionBase,
    kind: z.literal('forbidUnjustified'),
    componentType: ComponentTypeSchema,
    justifyId: z.string().optional()
  })
]) as unknown as z.ZodType<SemanticCriterion>

export const JustifyPromptSchema: z.ZodType<JustifyPrompt> = z
  .object({
    id: z.string().min(1),
    decision: z.string().min(1),
    boundTo: z
      .object({
        nodeId: z.string().optional(),
        componentType: ComponentTypeSchema.optional()
      })
      .optional(),
    requires: z.object({
      choice: z.boolean(),
      number: z.boolean().optional(),
      tradeoff: z.boolean()
    }),
    acceptTradeoffTokens: z.array(z.string()).optional()
  })
  .strict() as unknown as z.ZodType<JustifyPrompt>

export const BudgetSchema: z.ZodType<Budget> = z
  .object({
    unit: z.enum(['cost', 'nodes', 'edges']),
    cap: z.number().positive()
  })
  .strict()

export function parseSemanticCriterion(raw: unknown): SemanticCriterion {
  return SemanticCriterionSchema.parse(raw)
}

export function parseJustifyPrompt(raw: unknown): JustifyPrompt {
  return JustifyPromptSchema.parse(raw)
}

export function parseBudget(raw: unknown): Budget {
  return BudgetSchema.parse(raw)
}
