/**
 * Semantic criteria evaluation (Phase 3) — grading topology *meaning*.
 *
 * Structural rules grade node presence; the rubric grades runtime metrics.
 * Semantic criteria grade the third, orthogonal axis: whether the architecture
 * is *shaped correctly for the problem* — traffic guarded through a mandatory
 * node, components placed/ordered sensibly, a broker that genuinely fans out,
 * a store that fits the access pattern, and forbidden components either omitted
 * or defended by a justification.
 *
 * Every evaluator is a deterministic graph computation (counts + reachability),
 * mirroring `structural.ts`. The external dependencies — justification outcomes
 * and captured runtime case outputs — are injected via `SemanticContext`, so
 * this module stays pure and unit-testable with no engine/store coupling.
 */
import type { ComponentType, TopologyJSON } from '../core/types'
import type { RequestOutcomeRecord } from '../core/event-stream'
import type { RequestStateTransition } from '../core/simulationSemantics'
import type {
  RuntimeStateTransitionMatcher,
  SemanticCriterion,
  StateSequenceCriterion,
  StateTransitionCriterion
} from './gradingCriteria'
import type { SimulationOutput } from './output'

export const SEMANTIC_CRITERIA_VERSION = '1.0' as const

export type SemanticOutcome = 'passed' | 'partial' | 'failed'

export interface SemanticCriterionResult {
  id: string
  kind: SemanticCriterion['kind']
  description?: string
  outcome: SemanticOutcome
  pointsEarned: number
  pointsPossible: number
  /** A hardFail criterion that did not pass — zeroes the whole question. */
  hardFailed: boolean
  detail?: string
}

export interface SemanticEvaluation {
  version: typeof SEMANTIC_CRITERIA_VERSION
  results: SemanticCriterionResult[]
  pointsEarned: number
  pointsPossible: number
  /** Every criterion passed outright. */
  passed: boolean
  /** At least one hardFail criterion failed (question should be zeroed). */
  hardFailed: boolean
}

export interface SemanticRuntimeCase {
  caseId: string
  output: SimulationOutput | null
}

export interface SemanticContext {
  /**
   * Whether the justify prompt with this id was satisfied, used by
   * `forbidUnjustified`. `undefined` ⇒ no justification result available (the
   * component is then treated as undefended — a conservative, deterministic
   * default).
   */
  justificationPassed?: (justifyId: string) => boolean | undefined
  /**
   * Raw runtime evidence keyed by suite case id. Runtime semantic criteria
   * consume this directly from `requestOutcomes[].stateTimeline`.
   */
  runtimeCases?: readonly SemanticRuntimeCase[]
}

// ── graph helpers (local, mirroring structural.ts) ───────────────────────────

function nodeIdsOfType(topology: TopologyJSON, type: ComponentType): string[] {
  return topology.nodes.filter((node) => node.type === type).map((node) => node.id)
}

function hasType(topology: TopologyJSON, type: ComponentType): boolean {
  return topology.nodes.some((node) => node.type === type)
}

function nodeTypeById(topology: TopologyJSON): Map<string, ComponentType> {
  return new Map(topology.nodes.map((node) => [node.id, node.type]))
}

function directedAdjacency(
  topology: TopologyJSON,
  excluded: ReadonlySet<string> = new Set()
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const node of topology.nodes) {
    if (!excluded.has(node.id)) {
      adjacency.set(node.id, [])
    }
  }
  for (const edge of topology.edges) {
    if (excluded.has(edge.source) || excluded.has(edge.target)) {
      continue
    }
    adjacency.get(edge.source)?.push(edge.target)
  }
  return adjacency
}

function collectReachable(
  startNodeIds: readonly string[],
  adjacency: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>()
  const queue = startNodeIds.filter((id) => adjacency.has(id))
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]
    if (visited.has(current)) {
      continue
    }
    visited.add(current)
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor)
      }
    }
  }
  return visited
}

/** Whether any `toIds` node is reachable from any `fromIds` node in `adjacency`. */
function anyReachable(
  fromIds: readonly string[],
  toIds: readonly string[],
  adjacency: Map<string, string[]>
): boolean {
  if (fromIds.length === 0 || toIds.length === 0) {
    return false
  }
  const reachable = collectReachable(fromIds, adjacency)
  return toIds.some((id) => reachable.has(id))
}

// ── per-kind evaluators ──────────────────────────────────────────────────────

interface RawOutcome {
  outcome: SemanticOutcome
  detail?: string
}

interface EligibleRuntimeOutcome {
  caseId: string
  outcome: RequestOutcomeRecord
}

function transitionMatches(
  transition: RequestStateTransition,
  matcher: RuntimeStateTransitionMatcher,
  nodeTypes: ReadonlyMap<string, ComponentType>
): boolean {
  if (transition.scope !== matcher.scope || transition.state !== matcher.state) {
    return false
  }
  if (matcher.source && transition.source !== matcher.source) {
    return false
  }
  if (matcher.nodeId && transition.nodeId !== matcher.nodeId) {
    return false
  }
  if (matcher.reasonCode && transition.reasonCode !== matcher.reasonCode) {
    return false
  }
  if (matcher.nodeType) {
    const transitionNodeType = transition.nodeId ? nodeTypes.get(transition.nodeId) : undefined
    if (transitionNodeType !== matcher.nodeType) {
      return false
    }
  }
  return true
}

function outcomeMatchesFilter(
  outcome: RequestOutcomeRecord,
  where: StateTransitionCriterion['where'] | StateSequenceCriterion['where'],
  nodeTypes: ReadonlyMap<string, ComponentType>
): boolean {
  if (!where) {
    return true
  }
  if (where.outcomeStatus && outcome.status !== where.outcomeStatus) {
    return false
  }
  if (where.terminalNodeId && outcome.nodeId !== where.terminalNodeId) {
    return false
  }
  if (where.terminalNodeType) {
    const terminalNodeType = outcome.nodeId ? nodeTypes.get(outcome.nodeId) : undefined
    if (terminalNodeType !== where.terminalNodeType) {
      return false
    }
  }
  return true
}

function eligibleRuntimeOutcomes(
  topology: TopologyJSON,
  ctx: SemanticContext,
  where: StateTransitionCriterion['where'] | StateSequenceCriterion['where']
): EligibleRuntimeOutcome[] | RawOutcome {
  if (!ctx.runtimeCases || ctx.runtimeCases.length === 0) {
    return {
      outcome: 'failed',
      detail: 'No runtime case outputs were provided for transition-aware semantic grading.'
    }
  }

  const selectedCases = where?.caseId
    ? ctx.runtimeCases.filter((entry) => entry.caseId === where.caseId)
    : ctx.runtimeCases.filter((entry) => entry.output !== null)

  if (selectedCases.length === 0) {
    return {
      outcome: 'failed',
      detail: where?.caseId
        ? `Runtime case "${where.caseId}" is not part of this grading run.`
        : 'No grading suite case produced a runtime output for transition-aware semantic grading.'
    }
  }

  if (where?.caseId && selectedCases[0]?.output === null) {
    return {
      outcome: 'failed',
      detail: `Runtime case "${where.caseId}" did not produce an output, so this criterion could not be evaluated.`
    }
  }

  const casesWithOutputs = selectedCases.filter(
    (entry): entry is SemanticRuntimeCase & { output: SimulationOutput } => entry.output !== null
  )

  for (const entry of casesWithOutputs) {
    if (entry.output.requestOutcomesSampled) {
      return {
        outcome: 'failed',
        detail: `Runtime case "${entry.caseId}" only retained sampled request outcomes; transition-aware semantic grading requires the full request ledger.`
      }
    }
  }

  const nodeTypes = nodeTypeById(topology)
  const outcomes: EligibleRuntimeOutcome[] = []
  for (const entry of casesWithOutputs) {
    for (const outcome of entry.output.requestOutcomes) {
      if (outcomeMatchesFilter(outcome, where, nodeTypes)) {
        outcomes.push({ caseId: entry.caseId, outcome })
      }
    }
  }

  if (outcomes.length === 0) {
    return {
      outcome: 'failed',
      detail: 'No request outcomes matched the authored runtime filter for this semantic criterion.'
    }
  }

  return outcomes
}

function sequenceMatchesTimeline(
  timeline: readonly RequestStateTransition[],
  sequence: readonly RuntimeStateTransitionMatcher[],
  nodeTypes: ReadonlyMap<string, ComponentType>
): boolean {
  let nextIndex = 0
  for (const transition of timeline) {
    if (transitionMatches(transition, sequence[nextIndex], nodeTypes)) {
      nextIndex += 1
      if (nextIndex === sequence.length) {
        return true
      }
    }
  }
  return false
}

function resolvedMinCount(criterion: StateTransitionCriterion): number {
  if (criterion.minCount !== undefined) {
    return criterion.minCount
  }
  return criterion.maxCount === 0 ? 0 : 1
}

function evalGuardedPath(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'guardedPath' }>
): RawOutcome {
  const fromIds = nodeIdsOfType(topology, c.from)
  const guardIds = nodeIdsOfType(topology, c.guard)

  if (fromIds.length === 0) {
    return { outcome: 'failed', detail: `no ${c.from} node found to originate the guarded path.` }
  }
  if (guardIds.length === 0) {
    return { outcome: 'failed', detail: `the guard ${c.guard} is absent from the design.` }
  }

  // No explicit destination: the guard must simply be reachable from `from`.
  if (!c.to) {
    const guarded = anyReachable(fromIds, guardIds, directedAdjacency(topology))
    return guarded
      ? { outcome: 'passed' }
      : { outcome: 'failed', detail: `no path from ${c.from} reaches the guard ${c.guard}.` }
  }

  const toIds = nodeIdsOfType(topology, c.to)
  if (toIds.length === 0) {
    return { outcome: 'failed', detail: `no ${c.to} node found to terminate the guarded path.` }
  }

  // A guarded path must actually exist (from → to reachable at all)…
  const guardedReachable = anyReachable(fromIds, toIds, directedAdjacency(topology))
  if (!guardedReachable) {
    return { outcome: 'failed', detail: `no path connects ${c.from} to ${c.to}.` }
  }

  // …and NO path may bypass the guard: remove guard nodes and re-check reachability.
  const bypass = anyReachable(fromIds, toIds, directedAdjacency(topology, new Set(guardIds)))
  return bypass
    ? {
        outcome: 'failed',
        detail: `traffic from ${c.from} can reach ${c.to} without passing through ${c.guard}.`
      }
    : { outcome: 'passed' }
}

function evalPlacement(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'placement' }>
): RawOutcome {
  const targetIds = nodeIdsOfType(topology, c.componentType)
  if (targetIds.length === 0) {
    return { outcome: 'failed', detail: `${c.componentType} is absent; nothing to place.` }
  }

  // between [A, B]: the component must sit on a directed path A → component → B.
  if (c.between) {
    const [a, b] = c.between
    const aIds = nodeIdsOfType(topology, a)
    const bIds = nodeIdsOfType(topology, b)
    if (aIds.length === 0 || bIds.length === 0) {
      return {
        outcome: 'failed',
        detail: `cannot place ${c.componentType} between ${a} and ${b}: an endpoint is missing.`
      }
    }
    const adjacency = directedAdjacency(topology)
    const reachableFromA = collectReachable(aIds, adjacency)
    const onPath = targetIds.some(
      (id) => reachableFromA.has(id) && anyReachable([id], bIds, adjacency)
    )
    if (!onPath) {
      return {
        outcome: 'failed',
        detail: `${c.componentType} does not sit on a path from ${a} to ${b}.`
      }
    }
  }

  // notBefore X: the component must NOT be upstream of X (no path component → X).
  if (c.notBefore) {
    const xIds = nodeIdsOfType(topology, c.notBefore)
    if (xIds.length > 0) {
      const adjacency = directedAdjacency(topology)
      if (anyReachable(targetIds, xIds, adjacency)) {
        return {
          outcome: 'failed',
          detail: `${c.componentType} appears before ${c.notBefore}, but must not.`
        }
      }
    }
  }

  // orderedPipeline [T1..Tn]: each type reaches the next along directed edges.
  if (c.orderedPipeline && c.orderedPipeline.length > 1) {
    const adjacency = directedAdjacency(topology)
    let frontier = nodeIdsOfType(topology, c.orderedPipeline[0])
    if (frontier.length === 0) {
      return {
        outcome: 'failed',
        detail: `pipeline stage ${c.orderedPipeline[0]} is missing.`
      }
    }
    for (let stage = 1; stage < c.orderedPipeline.length; stage++) {
      const nextType = c.orderedPipeline[stage]
      const nextIds = nodeIdsOfType(topology, nextType)
      const reachable = collectReachable(frontier, adjacency)
      const advanced = nextIds.filter((id) => reachable.has(id))
      if (advanced.length === 0) {
        return {
          outcome: 'failed',
          detail: `pipeline breaks: ${c.orderedPipeline[stage - 1]} does not reach ${nextType}.`
        }
      }
      frontier = advanced
    }
  }

  return { outcome: 'passed' }
}

function evalFanout(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'fanout' }>
): RawOutcome {
  const outDegreeDistinct = (nodeId: string): number => {
    const consumers = new Set<string>()
    for (const edge of topology.edges) {
      if (edge.source === nodeId) {
        consumers.add(edge.target)
      }
    }
    return consumers.size
  }

  const brokerIds = nodeIdsOfType(topology, c.broker)
  const satisfyingBroker = brokerIds.some((id) => outDegreeDistinct(id) >= c.minConsumers)
  if (satisfyingBroker) {
    return { outcome: 'passed' }
  }

  // A forbidden broker (queue semantics) fanning out to N is the wrong primitive.
  if (c.forbiddenBroker) {
    const wrongIds = nodeIdsOfType(topology, c.forbiddenBroker)
    const misused = wrongIds.some((id) => outDegreeDistinct(id) >= c.minConsumers)
    if (misused) {
      return {
        outcome: 'failed',
        detail: `${c.forbiddenBroker} feeding ${c.minConsumers} consumers is not fan-out; use ${c.broker}.`
      }
    }
  }

  if (brokerIds.length === 0) {
    return { outcome: 'failed', detail: `no ${c.broker} present to fan out to consumers.` }
  }
  return {
    outcome: 'failed',
    detail: `${c.broker} fans out to fewer than ${c.minConsumers} independent consumers.`
  }
}

function evalStorageFit(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'storageFit' }>
): RawOutcome {
  const present = (types: readonly ComponentType[] | undefined): ComponentType[] =>
    (types ?? []).filter((type) => hasType(topology, type))

  const antiPresent = present(c.antiPattern)
  if (antiPresent.length > 0) {
    return {
      outcome: 'failed',
      detail: `${antiPresent.join(', ')} is an anti-pattern for a ${c.accessPattern} workload.`
    }
  }
  if (present(c.accept).length > 0) {
    return { outcome: 'passed' }
  }
  if (present(c.partial).length > 0) {
    return {
      outcome: 'partial',
      detail: `a defensible but suboptimal store for a ${c.accessPattern} workload.`
    }
  }
  return {
    outcome: 'failed',
    detail: `no store fitting a ${c.accessPattern} workload is present.`
  }
}

function evalForbidUnjustified(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'forbidUnjustified' }>,
  ctx: SemanticContext
): RawOutcome {
  if (!hasType(topology, c.componentType)) {
    return { outcome: 'passed' }
  }
  // Present ⇒ it must be defended by a valid bound justification.
  if (!c.justifyId) {
    return {
      outcome: 'failed',
      detail: `${c.componentType} is present but this criterion binds no justification to defend it.`
    }
  }
  const defended = ctx.justificationPassed?.(c.justifyId)
  if (defended === true) {
    return { outcome: 'passed' }
  }
  return {
    outcome: 'failed',
    detail:
      defended === undefined
        ? `${c.componentType} is present but its justification (${c.justifyId}) was not evaluated.`
        : `${c.componentType} is present but not defended by a valid justification.`
  }
}

function evalStateTransition(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'stateTransition' }>,
  ctx: SemanticContext
): RawOutcome {
  const eligible = eligibleRuntimeOutcomes(topology, ctx, c.where)
  if (!Array.isArray(eligible)) {
    return eligible
  }

  const nodeTypes = nodeTypeById(topology)
  let count = 0
  for (const { outcome } of eligible) {
    for (const transition of outcome.stateTimeline) {
      if (transitionMatches(transition, c.match, nodeTypes)) {
        count += 1
      }
    }
  }

  const minCount = resolvedMinCount(c)
  if (c.maxCount !== undefined && count > c.maxCount) {
    return {
      outcome: 'failed',
      detail: `Found ${count} matching transitions; expected at most ${c.maxCount}.`
    }
  }
  if (count >= minCount) {
    return { outcome: 'passed' }
  }
  if (count > 0 && minCount > 1) {
    return {
      outcome: 'partial',
      detail: `Found ${count} matching transitions; expected at least ${minCount}.`
    }
  }
  return {
    outcome: 'failed',
    detail: `Found ${count} matching transitions; expected at least ${minCount}.`
  }
}

function evalStateSequence(
  topology: TopologyJSON,
  c: Extract<SemanticCriterion, { kind: 'stateSequence' }>,
  ctx: SemanticContext
): RawOutcome {
  const eligible = eligibleRuntimeOutcomes(topology, ctx, c.where)
  if (!Array.isArray(eligible)) {
    return eligible
  }

  const minMatches = c.minMatches ?? 1
  const nodeTypes = nodeTypeById(topology)
  let matches = 0
  for (const { outcome } of eligible) {
    if (sequenceMatchesTimeline(outcome.stateTimeline, c.sequence, nodeTypes)) {
      matches += 1
    }
  }

  if (matches >= minMatches) {
    return { outcome: 'passed' }
  }
  if (matches > 0 && minMatches > 1) {
    return {
      outcome: 'partial',
      detail: `Found ${matches} eligible request outcomes with the required transition sequence; expected at least ${minMatches}.`
    }
  }
  return {
    outcome: 'failed',
    detail: `Found ${matches} eligible request outcomes with the required transition sequence; expected at least ${minMatches}.`
  }
}

function evaluateCriterion(
  topology: TopologyJSON,
  criterion: SemanticCriterion,
  ctx: SemanticContext
): RawOutcome {
  switch (criterion.kind) {
    case 'guardedPath':
      return evalGuardedPath(topology, criterion)
    case 'placement':
      return evalPlacement(topology, criterion)
    case 'fanout':
      return evalFanout(topology, criterion)
    case 'storageFit':
      return evalStorageFit(topology, criterion)
    case 'forbidUnjustified':
      return evalForbidUnjustified(topology, criterion, ctx)
    case 'stateTransition':
      return evalStateTransition(topology, criterion, ctx)
    case 'stateSequence':
      return evalStateSequence(topology, criterion, ctx)
  }
}

/** Points awarded for an outcome: full / half (floored) / none. */
function pointsFor(outcome: SemanticOutcome, points: number): number {
  if (outcome === 'passed') return points
  if (outcome === 'partial') return Math.floor(points / 2)
  return 0
}

export function evaluateSemanticCriteria(
  topology: TopologyJSON,
  criteria: readonly SemanticCriterion[],
  ctx: SemanticContext = {}
): SemanticEvaluation {
  let pointsEarned = 0
  let pointsPossible = 0

  const results: SemanticCriterionResult[] = criteria.map((criterion) => {
    const raw = evaluateCriterion(topology, criterion, ctx)
    const pointsEarnedForCriterion = pointsFor(raw.outcome, criterion.points)
    const hardFailed = criterion.hardFail === true && raw.outcome === 'failed'
    pointsEarned += pointsEarnedForCriterion
    pointsPossible += criterion.points

    return {
      id: criterion.id,
      kind: criterion.kind,
      description: criterion.description,
      outcome: raw.outcome,
      pointsEarned: pointsEarnedForCriterion,
      pointsPossible: criterion.points,
      hardFailed,
      detail: raw.detail
    }
  })

  return {
    version: SEMANTIC_CRITERIA_VERSION,
    results,
    pointsEarned,
    pointsPossible,
    passed: results.every((result) => result.outcome === 'passed'),
    hardFailed: results.some((result) => result.hardFailed)
  }
}
