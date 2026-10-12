/**
 * Budget evaluation — the anti-kitchen-sink `$` axis.
 *
 * Grades a topology against an authored `Budget` cap. Three units:
 *   - `nodes` / `edges`: pure counts (the primary anti-kitchen-sink lever).
 *   - `cost`: the same USD/hour model used by the live cost readout, including
 *     provisioned instances, consumption/volume pricing, and network egress.
 *
 * Pure and deterministic — mirrors `structural.ts` / `semanticCriteria.ts`.
 */
import type { ComponentNode, TopologyJSON } from '../core/types'
import { getInstanceCount } from '../core/types'
import type { Budget } from './gradingCriteria'
import { topologyCost } from './cost'

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

/**
 * Legacy capacity score retained for callers that display old saved artifacts.
 * New grading uses `topologyCost` and treats a cost cap as USD/hour.
 */
export function estimateNodeCost(node: ComponentNode): number {
  const replicas = getInstanceCount(node.resources)
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
  /** Human-readable derivation of this contribution. */
  formula: string
}

export interface BudgetBreakdown extends BudgetEvaluation {
  /** Per-node + aggregated-edge contributions, only meaningful for the `cost` unit. */
  items: BudgetLineItem[]
}

/**
 * Like `evaluateBudget`, but also returns the per-line contributions so the UI
 * can show *why* the cost is what it is (and which node drives it). For `nodes`
 * / `edges` units the items are the raw contributors; for `cost` they are the
 * exact same USD/hour line items shown by the live cost readout.
 */
export function budgetBreakdown(topology: TopologyJSON, budget: Budget): BudgetBreakdown {
  const base = evaluateBudget(topology, budget)

  let items: BudgetLineItem[]
  if (budget.unit === 'cost') {
    items = topologyCost(topology).items.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      cost: item.costPerHour,
      formula: item.formula
    }))
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
  const cost = budget.unit === 'cost' ? topologyCost(topology) : undefined
  const actual = cost
    ? cost.totalPerHour
    : budget.unit === 'nodes'
      ? topology.nodes.length
      : topology.edges.length
  // Unknown prices must not make a design pass a dollar cap vacuously.
  const withinBudget = actual <= budget.cap && !(cost?.hasUnpricedNodes ?? false)
  return {
    version: BUDGET_VERSION,
    unit: budget.unit,
    cap: budget.cap,
    actual,
    withinBudget,
    ...(withinBudget
      ? {}
      : {
          detail:
            budget.unit === 'cost'
              ? cost?.hasUnpricedNodes
                ? `Cost budget cannot pass: current priced spend is $${actual.toFixed(4)}/hr, but one or more billable nodes have no instance price.`
                : `Cost budget exceeded: $${actual.toFixed(4)}/hr > cap $${budget.cap.toFixed(4)}/hr. Trim over-provisioned components or traffic-dependent spend.`
              : `${budget.unit} budget exceeded: ${actual} > cap ${budget.cap}. Trim over-provisioned components.`
        })
  }
}
