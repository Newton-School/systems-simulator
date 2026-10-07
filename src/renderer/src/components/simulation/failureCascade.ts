import type { CausalGraph, CausalGraphNode } from '../../../../engine/analysis/output'

/** One row of the Failures tab timeline: a root cause or a propagation step. */
export interface CascadeRow {
  nodeId: string
  /** Node this one was linked to (the failing dependency it calls); null for a root. */
  fromNodeId: string | null
  /** 0 for a root cause, +1 per propagation step below it. */
  depth: number
  timeMs: number
  /** Raw engine label: a fault mode for roots, an effect label for propagation. */
  effect: string
  severity: 'failed' | 'degraded'
  detail: CausalGraphNode | null
}

export interface CascadeTree {
  rootNodeId: string
  rows: CascadeRow[]
}

/**
 * Groups the causal graph into one tree per root cause (depth-first, children
 * in time order), so independent failures render as separate timelines.
 */
export function buildCascadeTrees(graph: CausalGraph): CascadeTree[] {
  const detailById = new Map((graph.nodes ?? []).map((node) => [node.nodeId, node]))
  const children = new Map<string, CausalGraph['propagation']>()
  for (const step of graph.propagation) {
    const list = children.get(step.from) ?? []
    list.push(step)
    children.set(step.from, list)
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.time - b.time || a.to.localeCompare(b.to))
  }

  const severityOf = (nodeId: string, fallback: 'failed' | 'degraded') =>
    detailById.get(nodeId)?.severity ?? fallback

  return [...graph.rootCauses]
    .sort((a, b) => a.time - b.time || a.nodeId.localeCompare(b.nodeId))
    .map((root) => {
      const rows: CascadeRow[] = []
      const visited = new Set<string>()
      const visit = (
        nodeId: string,
        fromNodeId: string | null,
        depth: number,
        timeMs: number,
        effect: string
      ) => {
        if (visited.has(nodeId)) return
        visited.add(nodeId)
        rows.push({
          nodeId,
          fromNodeId,
          depth,
          timeMs,
          effect,
          severity: severityOf(nodeId, depth === 0 ? 'failed' : 'degraded'),
          detail: detailById.get(nodeId) ?? null
        })
        for (const step of children.get(nodeId) ?? []) {
          visit(step.to, nodeId, depth + 1, step.time, step.effect)
        }
      }
      visit(root.nodeId, null, 0, root.time, root.event)
      return { rootNodeId: root.nodeId, rows }
    })
}

const FAULT_MODE_LABELS: Record<string, string> = {
  reject: 'fault: down (rejects requests)',
  blackhole: 'fault: down (drops requests silently)',
  hang: 'fault: hung (accepts, never answers)',
  degraded: 'fault: degraded (slower service)',
  node_failed: 'fault: node failed',
  broker_failed: 'fault: broker failed'
}

const EFFECT_LABELS: Record<string, string> = {
  timeout_cascade: 'timeouts',
  queue_saturation: 'queue saturation',
  circuit_open: 'circuit breaker opened'
}

/** Plain-language label for a root event or propagation effect. */
export function cascadeEffectLabel(effect: string): string {
  return FAULT_MODE_LABELS[effect] ?? EFFECT_LABELS[effect] ?? effect.replace(/_/g, ' ')
}
