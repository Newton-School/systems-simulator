import type { RoutingStrategy } from '../../../engine/catalog/nodeSpecTypes'

export interface RoutingVisualizationTarget {
  id: string
  label: string
  nodeId?: string
  nodeLabel?: string
  edgeId?: string
  edgeLabel?: string
  weight?: number
  inFlight?: number
  healthy?: boolean
  condition?: string
  mode?: 'synchronous' | 'asynchronous' | 'streaming' | 'conditional'
  successRatio?: number
}

export interface RoutingVisualizationRequest {
  id: string
  type?: string
  key?: string | number
}

export interface RoutingVisualizationState {
  roundRobinIndex: number
  conditionalIndex: number
  leastConnectionTieIndex: number
  rngState: number
}

export interface RoutingVisualizationDecision {
  strategy: RoutingStrategy
  selectedTargetIds: string[]
  eligibleTargetIds: string[]
  rejectedTargetIds: string[]
  signature: string
  reason?: 'no-targets' | 'no-eligible-targets'
  nextState: RoutingVisualizationState
}

export interface RoutingVisualizationFrame extends RoutingVisualizationDecision {
  request: RoutingVisualizationRequest
  targetCounts: Record<string, number>
}

export interface RoutingVisualizationResult {
  targets: RoutingVisualizationTarget[]
  frames: RoutingVisualizationFrame[]
  finalCounts: Record<string, number>
}

const DEFAULT_RNG_STATE = 0x9e3779b9

function nextRandom(state: number): { value: number; state: number } {
  const nextState = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return { value: nextState / 0x100000000, state: nextState }
}

function positiveWeight(target: RoutingVisualizationTarget): number {
  const weight = target.weight ?? 1
  return Number.isFinite(weight) && weight > 0 ? weight : 0
}

function modulo(index: number, length: number): number {
  return length === 0 ? 0 : ((index % length) + length) % length
}

function isConditionMatch(condition: string, request: RoutingVisualizationRequest) {
  if (condition.trim().length === 0) return false

  const normalized = condition.replace(/\s+/g, ' ').trim()
  const typeExpr = normalized.match(/^request\.type\s*(===|==|!==|!=)\s*["']([^"']+)["']$/)
  if (!typeExpr) return false

  const operator = typeExpr[1]
  const expected = typeExpr[2]
  const actual = request.type

  if (operator === '===' || operator === '==') return actual === expected
  return actual !== expected
}

function eligibleTargets(
  targets: RoutingVisualizationTarget[],
  request: RoutingVisualizationRequest
): RoutingVisualizationTarget[] {
  const healthyTargets = targets.filter((target) => target.healthy !== false)

  return healthyTargets.filter((target) => {
    const condition = target.condition?.trim()
    if (target.mode === 'conditional' && !condition) return false
    if (!condition) return true
    return isConditionMatch(condition, request)
  })
}

function createNoTargetDecision(
  strategy: RoutingStrategy,
  targets: RoutingVisualizationTarget[],
  state: RoutingVisualizationState,
  reason: RoutingVisualizationDecision['reason']
): RoutingVisualizationDecision {
  return {
    strategy,
    selectedTargetIds: [],
    eligibleTargetIds: [],
    rejectedTargetIds: targets.map((target) => target.id),
    signature: reason === 'no-targets' ? 'No outgoing targets.' : 'No eligible targets.',
    reason,
    nextState: state
  }
}

function selectWeightedTarget(
  targets: RoutingVisualizationTarget[],
  randomValue: number
): RoutingVisualizationTarget {
  const weights = targets.map(positiveWeight)
  const total = weights.reduce((sum, weight) => sum + weight, 0)

  if (total <= 0) {
    const index = Math.min(targets.length - 1, Math.floor(randomValue * targets.length))
    return targets[index]
  }

  const threshold = randomValue * total
  let cumulative = 0

  for (let index = 0; index < targets.length; index++) {
    cumulative += weights[index]
    if (threshold < cumulative) return targets[index]
  }

  return targets[targets.length - 1]
}

function selectLeastConnectionTarget(
  targets: RoutingVisualizationTarget[],
  tieIndex: number
): { target: RoutingVisualizationTarget; nextTieIndex: number } {
  const minInFlight = Math.min(...targets.map((target) => target.inFlight ?? 0))
  const tied = targets.filter((target) => (target.inFlight ?? 0) === minInFlight)
  const selected = tied[modulo(tieIndex, tied.length)]
  return { target: selected, nextTieIndex: tieIndex + 1 }
}

function createRequest(index: number, targetCount: number): RoutingVisualizationRequest {
  return {
    id: `request-${index + 1}`,
    type: index % 4 === 0 ? 'write' : 'read',
    key: targetCount > 0 ? index % targetCount : index
  }
}

function decrementLeastConnectionLoad(targets: RoutingVisualizationTarget[], index: number): void {
  for (const [targetIndex, target] of targets.entries()) {
    const completionEvery = Math.max(1, targetIndex + 1)
    if (index > 0 && index % completionEvery === 0) {
      target.inFlight = Math.max(0, (target.inFlight ?? 0) - 1)
    }
  }
}

function normalizeRequestCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function scaleCounts(
  counts: Record<string, number>,
  ids: string[],
  sampleCount: number,
  requestCount: number
): Record<string, number> {
  if (sampleCount <= 0 || requestCount === sampleCount) return counts

  const sampleTotal = ids.reduce((sum, id) => sum + (counts[id] ?? 0), 0)
  if (sampleTotal <= 0) return counts

  const expectedTotal = Math.round((sampleTotal / sampleCount) * requestCount)
  const scaledEntries = ids.map((id) => {
    const raw = ((counts[id] ?? 0) / sampleCount) * requestCount
    const floored = Math.floor(raw)
    return { id, count: floored, remainder: raw - floored }
  })
  let remaining = expectedTotal - scaledEntries.reduce((sum, entry) => sum + entry.count, 0)

  for (const entry of [...scaledEntries].sort((a, b) => b.remainder - a.remainder)) {
    if (remaining <= 0) break
    entry.count += 1
    remaining -= 1
  }

  return Object.fromEntries(scaledEntries.map((entry) => [entry.id, entry.count]))
}

export function createRoutingVisualizationState(
  seed = DEFAULT_RNG_STATE
): RoutingVisualizationState {
  return {
    roundRobinIndex: 0,
    conditionalIndex: 0,
    leastConnectionTieIndex: 0,
    rngState: seed >>> 0
  }
}

export function resolveRoutingVisualizationDecision({
  strategy,
  targets,
  request,
  state
}: {
  strategy: RoutingStrategy
  targets: RoutingVisualizationTarget[]
  request: RoutingVisualizationRequest
  state: RoutingVisualizationState
}): RoutingVisualizationDecision {
  if (targets.length === 0) {
    return createNoTargetDecision(strategy, targets, state, 'no-targets')
  }

  const eligible = eligibleTargets(targets, request)
  if (eligible.length === 0) {
    return createNoTargetDecision(strategy, targets, state, 'no-eligible-targets')
  }

  const nextState = { ...state }
  const asyncTargets = eligible.filter((target) => target.mode === 'asynchronous')
  const syncTargets = eligible.filter((target) => target.mode !== 'asynchronous')
  let selectedSyncTargets: RoutingVisualizationTarget[] = []
  let signature = ''

  switch (strategy) {
    case 'broadcast':
      selectedSyncTargets = syncTargets
      signature = 'Fan-out: one request is duplicated to every eligible target.'
      break

    case 'round-robin': {
      const index = modulo(state.roundRobinIndex, syncTargets.length)
      selectedSyncTargets = syncTargets.length > 0 ? [syncTargets[index]] : []
      nextState.roundRobinIndex = state.roundRobinIndex + 1
      signature = 'Strict rotation: each request advances to the next target.'
      break
    }

    case 'weighted': {
      const random = nextRandom(state.rngState)
      selectedSyncTargets =
        syncTargets.length > 0 ? [selectWeightedTarget(syncTargets, random.value)] : []
      nextState.rngState = random.state
      signature = 'Weighted split: targets with larger weights receive proportionally more traffic.'
      break
    }

    case 'least-conn': {
      if (syncTargets.length > 0) {
        const result = selectLeastConnectionTarget(syncTargets, state.leastConnectionTieIndex)
        selectedSyncTargets = [result.target]
        nextState.leastConnectionTieIndex = result.nextTieIndex
      }
      signature = 'Least connections: pick the eligible target with the smallest in-flight load.'
      break
    }

    case 'conditional': {
      const index = modulo(state.conditionalIndex, syncTargets.length)
      selectedSyncTargets = syncTargets.length > 0 ? [syncTargets[index]] : []
      nextState.conditionalIndex = state.conditionalIndex + 1
      signature = 'Conditional routing: request attributes decide which target set is eligible.'
      break
    }

    case 'passthrough':
      selectedSyncTargets = syncTargets.length > 0 ? [syncTargets[0]] : []
      signature = 'Passthrough: forward to the first eligible target without balancing.'
      break

    case 'random':
    default: {
      const random = nextRandom(state.rngState)
      const index = Math.min(syncTargets.length - 1, Math.floor(random.value * syncTargets.length))
      selectedSyncTargets = syncTargets.length > 0 ? [syncTargets[index]] : []
      nextState.rngState = random.state
      signature = 'Uniform random: each eligible target has the same chance per request.'
      break
    }
  }

  const selected = [...asyncTargets, ...selectedSyncTargets]
  const selectedIds = selected.map((target) => target.id)

  return {
    strategy,
    selectedTargetIds: selectedIds,
    eligibleTargetIds: eligible.map((target) => target.id),
    rejectedTargetIds: targets
      .filter((target) => !eligible.some((candidate) => candidate.id === target.id))
      .map((target) => target.id),
    signature,
    nextState
  }
}

export function createRoutingVisualizationFrames({
  strategy,
  targets,
  requestCount = 0,
  seed,
  decisionSampleLimit
}: {
  strategy: RoutingStrategy
  targets: RoutingVisualizationTarget[]
  requestCount?: number
  seed?: number
  decisionSampleLimit?: number
}): RoutingVisualizationResult {
  const normalizedRequestCount = normalizeRequestCount(requestCount)
  const normalizedSampleLimit =
    decisionSampleLimit === undefined
      ? normalizedRequestCount
      : normalizeRequestCount(decisionSampleLimit)
  const sampledRequestCount = Math.min(normalizedRequestCount, normalizedSampleLimit)
  const mutableTargets = targets.map((target) => ({ ...target }))
  let state = createRoutingVisualizationState(seed)
  const counts: Record<string, number> = Object.fromEntries(targets.map((target) => [target.id, 0]))
  const frames: RoutingVisualizationFrame[] = []

  for (let index = 0; index < sampledRequestCount; index++) {
    if (strategy === 'least-conn') {
      decrementLeastConnectionLoad(mutableTargets, index)
    }

    const request = createRequest(index, targets.length)
    const decision = resolveRoutingVisualizationDecision({
      strategy,
      targets: mutableTargets,
      request,
      state
    })
    state = decision.nextState

    for (const targetId of decision.selectedTargetIds) {
      counts[targetId] = (counts[targetId] ?? 0) + 1
      const target = mutableTargets.find((candidate) => candidate.id === targetId)
      if (target && strategy === 'least-conn') {
        target.inFlight = (target.inFlight ?? 0) + 1
      }
    }

    frames.push({
      ...decision,
      request,
      targetCounts: { ...counts }
    })
  }

  const finalCounts = scaleCounts(
    counts,
    targets.map((target) => target.id),
    sampledRequestCount,
    normalizedRequestCount
  )

  return {
    targets,
    frames,
    finalCounts
  }
}
