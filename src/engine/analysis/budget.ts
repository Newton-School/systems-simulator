/**
 * Budget evaluation — the anti-kitchen-sink `$` axis.
 *
 * Grades a topology against an authored `Budget` cap. Three units:
 *   - `nodes` / `edges`: pure counts (the primary anti-kitchen-sink lever).
 *   - `cost`: a **v1 heuristic** capacity cost — there is no real pricing model
 *     yet, so cost is derived from provisioned capacity (a node's replicas +
 *     workers) so that over-provisioning genuinely costs more. Documented as a
 *     heuristic; swap in a real cost model later without changing the DSL.
 *
 * Pure and deterministic — mirrors `structural.ts` / `semanticCriteria.ts`.
 */
import type { ComponentNode, TopologyJSON } from '../core/types'
import type { Budget } from './gradingCriteria'

export const BUDGET_VERSION = '1.0' as const

export interface BudgetEvaluation {
  version: typeof BUDGET_VERSION
  unit: Budget['unit']
  cap: number
  /** The topology's measured value in the budget's unit. */
  actual: number
  /** Whether `actual <= cap`. */
  withinBudget: boolean
  detail?: string
}

/** Per-edge cost weight in the `cost` heuristic. */
const EDGE_COST = 1

/**
 * v1 capacity-cost heuristic for a single node: a base charge plus its
 * provisioned replicas and a coarse charge per pool of workers. Penalizes
 * over-provisioning (the anti-kitchen-sink intent) without a real price sheet.
 */
export function estimateNodeCost(node: ComponentNode): number {
  const replicas = node.resources?.replicas ?? 1
  const workers = node.queue?.workers ?? 0
  return 1 + replicas + Math.ceil(workers / 50)
}

/** One line item in a cost breakdown — a node's or the edges' contribution. */
export interface BudgetLineItem {
  /** Node id, or 'edges' for the aggregated edge charge. */
  id: string
  label: string
  /** The node's component type, or 'edges' for the aggregate row. */
  kind: string
  cost: number
  /** Human-readable derivation, e.g. "1 base + 1 replica + ⌈80/50⌉". */
  formula: string
}

export interface BudgetBreakdown extends BudgetEvaluation {
  /** Per-node + aggregated-edge contributions, only meaningful for the `cost` unit. */
  items: BudgetLineItem[]
}

/**
 * Like `evaluateBudget`, but also returns the per-line contributions so the UI
 * can show *why* the cost is what it is (and which node drives it). For `nodes`
 * / `edges` units the items are the raw contributors; for `cost` they carry the
 * capacity-cost derivation. Pure — safe to call live on every canvas edit.
 */
export function budgetBreakdown(topology: TopologyJSON, budget: Budget): BudgetBreakdown {
  const base = evaluateBudget(topology, budget)

  let items: BudgetLineItem[]
  if (budget.unit === 'cost') {
    const nodeItems = topology.nodes.map((node) => {
      const replicas = node.resources?.replicas ?? 1
      const workers = node.queue?.workers ?? 0
      const workerCharge = Math.ceil(workers / 50)
      return {
        id: node.id,
        label: node.label ?? node.id,
        kind: node.type,
        cost: estimateNodeCost(node),
        formula: `1 base + ${replicas} replica${replicas === 1 ? '' : 's'}${
          workers > 0 ? ` + ⌈${workers}/50⌉=${workerCharge}` : ''
        }`
      }
    })
    const edgeCost = topology.edges.length * EDGE_COST
    items = [
      ...nodeItems.sort((a, b) => b.cost - a.cost),
      {
        id: 'edges',
        label: 'Edges',
        kind: 'edges',
        cost: edgeCost,
        formula: `${topology.edges.length} × ${EDGE_COST}`
      }
    ]
  } else if (budget.unit === 'nodes') {
    items = topology.nodes.map((node) => ({
      id: node.id,
      label: node.label ?? node.id,
      kind: node.type,
      cost: 1,
      formula: '1 node'
    }))
  } else {
    items = topology.edges.map((edge) => ({
      id: edge.id,
      label: edge.id,
      kind: 'edges',
      cost: 1,
      formula: '1 edge'
    }))
  }

  return { ...base, items }
}

export function evaluateBudget(topology: TopologyJSON, budget: Budget): BudgetEvaluation {
  const actual =
    budget.unit === 'nodes'
      ? topology.nodes.length
      : budget.unit === 'edges'
        ? topology.edges.length
        : topology.nodes.reduce((sum, node) => sum + estimateNodeCost(node), 0) +
          topology.edges.length * EDGE_COST

  const withinBudget = actual <= budget.cap
  return {
    version: BUDGET_VERSION,
    unit: budget.unit,
    cap: budget.cap,
    actual,
    withinBudget,
    ...(withinBudget
      ? {}
      : {
          detail: `${budget.unit} budget exceeded: ${actual} > cap ${budget.cap}${
            budget.unit === 'cost' ? ' (v1 capacity-cost heuristic)' : ''
          }. Trim over-provisioned components.`
        })
  }
}
