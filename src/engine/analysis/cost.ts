/**
 * Real infrastructure cost of a topology, in USD/hour, derived from the instance
 * prices in INSTANCE_CATALOG. This is Slice 0's always-on cost readout: cost is a
 * first-class output shown on EVERY topology regardless of whether a budget cap is
 * set — "unbounded" means no gate, never no number.
 *
 * v1 covers axis 1 only — provisioned compute (`pricePerHour × instanceCount`).
 * Consumption pricing (axis 2) and network egress (axis 3) layer on later. A node
 * with no instance model is unpriced (contributes $0) until it is migrated to an
 * `instanceType`; this is intentionally visible so unmigrated nodes read as $0.
 *
 * Pure — safe to call live on every canvas edit. Distinct from the abstract Budget
 * DSL `cost` unit (`estimateNodeCost`), which is a capacity-cost *score*, not $/hr.
*
 * See ns-simulator-docs/specs/resource-allocation-and-derived-concurrency.md
 * ("Cost model" + "Always show the cost").
 */
import { getInstanceCount, type ComponentNode, type TopologyJSON } from '../core/types'
import { INSTANCE_CATALOG, pricingMultiplier } from '../catalog/instanceCatalog'
import { getResourceDefaults, type CostModel } from '../catalog/resourceDefaults'

export interface NodeCostLineItem {
  id: string
  label: string
  kind: string
  /** Cost in USD/hour (provisioned exact, or volume estimate). */
  costPerHour: number
  /** How this node is billed. */
  basis: CostModel
  /** Whether the figure is priced (vs $0 / unpriced). */
  priced: boolean
  /** True when the figure is a pre-run estimate (volume nodes) rather than exact. */
  isEstimate: boolean
  /** Human-readable derivation, e.g. "3 × c5.xlarge @ $0.170" or "~$0.085/GB egress". */
  formula: string
}

export interface TopologyCost {
  /** Total cost across all nodes, USD/hour (provisioned exact + volume estimates). */
  totalPerHour: number
  /** Per-node contributions, most-expensive first. */
  items: NodeCostLineItem[]
  /** Whether any node is unpriced (no instance model and no cost basis). */
  hasUnpricedNodes: boolean
  /** Whether the total includes a pre-run estimate (traffic-dependent, no run yet). */
  hasEstimates: boolean
}

/**
 * Measured run data that turns traffic-dependent estimates (consumption, egress)
 * into exact figures. Supplied post-run from the simulation output; absent pre-run.
 */
export interface CostRunContext {
  /** Measured throughput (successful req/s) per node id. */
  nodeThroughput: Record<string, number>
  /** Measured post-warmup bytes transited per edge id. */
  edgeBytes: Record<string, number>
  /** Post-warmup duration in seconds (converts byte totals to per-hour rates). */
  durationSec: number
}

/** Provisioned (instance-hours) cost of a single node, USD/hour. No instance → 0. */
export function nodeCostPerHour(node: ComponentNode): number {
  const type = node.resources?.instanceType
  if (!type) return 0
  const spec = INSTANCE_CATALOG[type]
  if (!spec) return 0
  return (
    spec.pricePerHour * pricingMultiplier(node.resources?.pricingModel) * getInstanceCount(node.resources)
  )
}

/**
 * Expected bytes transferred per hour from the configured workload — used to
 * estimate volume (egress) cost pre-run. A rough upper bound: it assumes a volume
 * node sees the full offered throughput (routing is a post-run concern). Returns 0
 * when the topology has no workload configured.
 */
/** Weighted-average request size (bytes) from the workload mix. */
function avgRequestBytes(topology: TopologyJSON): number {
  const dist = topology.workload?.requestDistribution ?? []
  const totalWeight = dist.reduce((s, d) => s + (d.weight ?? 0), 0)
  return totalWeight > 0
    ? dist.reduce((s, d) => s + (d.weight ?? 0) * (d.sizeBytes ?? 0), 0) / totalWeight
    : 0
}

function expectedBytesPerHour(topology: TopologyJSON): number {
  const wl = topology.workload
  if (!wl || !Number.isFinite(wl.baseRps) || wl.baseRps <= 0) return 0
  return wl.baseRps * avgRequestBytes(topology) * 3600
}

/** Expected requests per hour from the configured workload (for consumption pricing). */
function expectedRequestsPerHour(topology: TopologyJSON): number {
  const rps = topology.workload?.baseRps
  return Number.isFinite(rps) && (rps ?? 0) > 0 ? (rps as number) * 3600 : 0
}

/**
 * Per-GB egress rate for data crossing a network boundary (AWS-proportional). Data
 * that stays same-rack/same-dc is free; leaving a zone, region, or the cloud costs
 * progressively more. Used for inter-region/egress transfer cost on edges.
 */
const EDGE_EGRESS_RATE_PER_GB: Record<string, number> = {
  'cross-zone': 0.01, // inter-AZ
  'cross-region': 0.02, // inter-region
  internet: 0.09 // egress to the public internet
}

/**
 * Full per-node + per-edge cost breakdown. Always computable pre-run (traffic-
 * dependent lines are estimates from the configured workload); pass a `run` context
 * post-run to make consumption + egress **exact** from measured throughput/bytes.
 */
export function topologyCost(topology: TopologyJSON, run?: CostRunContext): TopologyCost {
  let total = 0
  let hasUnpriced = false
  let hasEstimates = false
  const avgBytes = avgRequestBytes(topology)
  const estBytesPerHour = expectedBytesPerHour(topology)
  const estRequestsPerHour = expectedRequestsPerHour(topology)

  const items: NodeCostLineItem[] = topology.nodes.map((node) => {
    const basis: CostModel = getResourceDefaults(node.type).costModel ?? 'provisioned'

    if (basis === 'consumption') {
      // Serverless: billed per request. Exact from measured node throughput
      // post-run; estimated from configured load otherwise.
      const rate = getResourceDefaults(node.type).pricePerMillionRequests ?? 0
      const measuredRps = run?.nodeThroughput[node.id]
      const requestsPerHour = measuredRps !== undefined ? measuredRps * 3600 : estRequestsPerHour
      const costPerHour = (rate * requestsPerHour) / 1e6
      const isEstimate = measuredRps === undefined
      const priced = costPerHour > 0
      if (priced && isEstimate) hasEstimates = true
      total += costPerHour
      return {
        id: node.id,
        label: node.label ?? node.id,
        kind: node.type,
        costPerHour,
        basis,
        priced,
        isEstimate,
        formula: !priced
          ? `$${rate.toFixed(2)}/M req · run to measure`
          : isEstimate
            ? `~$${rate.toFixed(2)}/M req · est. at configured load`
            : `$${rate.toFixed(2)}/M req · ${measuredRps!.toFixed(0)} rps measured`
      }
    }

    if (basis === 'volume') {
      // Egress served by this node — exact from measured node throughput × avg
      // request bytes post-run; estimated from configured load otherwise.
      const rate = getResourceDefaults(node.type).pricePerGb ?? 0
      const measuredRps = run?.nodeThroughput[node.id]
      const bytesPerHour =
        measuredRps !== undefined ? measuredRps * avgBytes * 3600 : estBytesPerHour
      const costPerHour = (rate * bytesPerHour) / 1e9
      const isEstimate = measuredRps === undefined
      const priced = costPerHour > 0
      if (priced && isEstimate) hasEstimates = true
      total += costPerHour
      return {
        id: node.id,
        label: node.label ?? node.id,
        kind: node.type,
        costPerHour,
        basis,
        priced,
        isEstimate,
        formula: !priced
          ? `$${rate.toFixed(3)}/GB egress · run to measure`
          : isEstimate
            ? `~$${rate.toFixed(3)}/GB egress · est. at configured load`
            : `$${rate.toFixed(3)}/GB egress · measured`
      }
    }

    if (basis === 'none') {
      return {
        id: node.id,
        label: node.label ?? node.id,
        kind: node.type,
        costPerHour: 0,
        basis,
        priced: false,
        isEstimate: false,
        formula: 'not billable (traffic source)'
      }
    }

    // provisioned (default)
    const type = node.resources?.instanceType
    const priced = type !== undefined && INSTANCE_CATALOG[type] !== undefined
    const costPerHour = nodeCostPerHour(node)
    total += costPerHour
    if (!priced) hasUnpriced = true
    const count = getInstanceCount(node.resources)

    return {
      id: node.id,
      label: node.label ?? node.id,
      kind: node.type,
      costPerHour,
      basis,
      priced,
      isEstimate: false,
      formula: priced
        ? `${count} × ${type} @ $${INSTANCE_CATALOG[type!].pricePerHour.toFixed(3)}${
            node.resources?.pricingModel && node.resources.pricingModel !== 'on-demand'
              ? ` · ${node.resources.pricingModel}`
              : ''
          }`
        : 'unpriced (no instance type)'
    }
  })

  // Inter-region / egress transfer: data crossing a zone/region/internet boundary
  // costs per GB. Estimated from the configured workload bytes (rough — assumes the
  // edge carries the offered load; exact per-edge egress is a post-run measurement).
  const nodeLabelById = new Map(topology.nodes.map((n) => [n.id, n.label ?? n.id]))
  for (const edge of topology.edges ?? []) {
    const pathType = edge.latency?.pathType
    const rate = pathType ? EDGE_EGRESS_RATE_PER_GB[pathType] : undefined
    if (!rate) continue // same-rack/same-dc (or unknown) → free
    // Exact from measured bytes over this edge post-run; estimated otherwise.
    const measuredBytes = run?.edgeBytes[edge.id]
    const bytesPerHour =
      measuredBytes !== undefined && run && run.durationSec > 0
        ? (measuredBytes / run.durationSec) * 3600
        : estBytesPerHour
    const isEstimate = measuredBytes === undefined
    const costPerHour = (rate * bytesPerHour) / 1e9
    if (costPerHour <= 0) continue
    if (isEstimate) hasEstimates = true
    total += costPerHour
    const src = nodeLabelById.get(edge.source) ?? edge.source
    const tgt = nodeLabelById.get(edge.target) ?? edge.target
    items.push({
      id: `edge:${edge.id}`,
      label: `${src} → ${tgt}`,
      kind: `transfer · ${pathType}`,
      costPerHour,
      basis: 'volume',
      priced: true,
      isEstimate,
      formula: isEstimate
        ? `~$${rate.toFixed(2)}/GB ${pathType} egress · est. at configured load`
        : `$${rate.toFixed(2)}/GB ${pathType} egress · measured`
    })
  }

  items.sort((a, b) => b.costPerHour - a.costPerHour)
  return { totalPerHour: total, items, hasUnpricedNodes: hasUnpriced, hasEstimates }
}

/** Round a $/hr figure for display (4 dp — instance prices are ~$0.02–0.83/hr). */
export function formatCostPerHour(costPerHour: number): string {
  return `$${costPerHour.toFixed(4)}/hr`
}

/** Total provisioned hardware footprint of a topology (all instance-backed nodes). */
export interface TopologyResources {
  totalVcpu: number
  totalRamGb: number
}

/** Sum vCPU/RAM across every node that runs on a catalog instance. */
export function topologyResources(topology: TopologyJSON): TopologyResources {
  let totalVcpu = 0
  let totalRamGb = 0
  for (const node of topology.nodes) {
    const type = node.resources?.instanceType
    const spec = type ? INSTANCE_CATALOG[type] : undefined
    if (!spec) continue
    const count = getInstanceCount(node.resources)
    totalVcpu += spec.vcpu * count
    totalRamGb += spec.ramGb * count
  }
  return { totalVcpu, totalRamGb }
}

/** One budget dimension evaluated against a cap. */
export interface BudgetDimension {
  used: number
  cap: number
  within: boolean
  /** used / cap, clamped for display; 0 when cap is 0. */
  ratio: number
}

export interface BudgetCaps {
  resourceBudget?: { totalVcpu: number; totalRamGb: number }
  costBudget?: { maxPerHour: number }
}

/**
 * Evaluate a topology against the environment's quota + cost caps. Each dimension
 * is present only when its cap is set (absent cap = unbounded, no gate). Quota and
 * cost are independent: a design can pass one and fail the other.
 */
export interface BudgetEvaluation {
  vcpu?: BudgetDimension
  ramGb?: BudgetDimension
  cost?: BudgetDimension
  /** True when every *present* dimension is within budget (vacuously true if none). */
  allWithin: boolean
}

function dimension(used: number, cap: number): BudgetDimension {
  return { used, cap, within: used <= cap, ratio: cap > 0 ? used / cap : used > 0 ? Infinity : 0 }
}

export function evaluateBudgets(topology: TopologyJSON, caps: BudgetCaps): BudgetEvaluation {
  const res = topologyResources(topology)
  const cost = topologyCost(topology)

  const vcpu = caps.resourceBudget ? dimension(res.totalVcpu, caps.resourceBudget.totalVcpu) : undefined
  const ramGb = caps.resourceBudget ? dimension(res.totalRamGb, caps.resourceBudget.totalRamGb) : undefined
  const costDim = caps.costBudget ? dimension(cost.totalPerHour, caps.costBudget.maxPerHour) : undefined

  const allWithin = [vcpu, ramGb, costDim].every((d) => d === undefined || d.within)
  return { vcpu, ramGb, cost: costDim, allWithin }
}
