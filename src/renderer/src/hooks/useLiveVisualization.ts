import { useMemo } from 'react'
import type { TimeSeriesSnapshot } from '../../../engine/analysis/output'
import type { TopologyJSON } from '../../../engine/core/types'
import { distributionMean } from '../../../engine/analysis/fluidModel'
import useStore from '@renderer/store/useStore'
import {
  computeLiveVisualization,
  LIVE_WINDOW_MS,
  type EdgeVisualStyle,
  type LiveEdgeInput,
  type LiveVisualization,
  type NodeVisualStyle
} from '@renderer/utils/liveVisualization'

export type { EdgeVisualStyle, LiveVisualization, NodeVisualStyle }

const EMPTY: LiveVisualization = { nodeStyles: new Map(), edgeStyles: new Map(), atMs: 0 }

/**
 * Live node/edge styling for the canvas during a run (#70). Recomputes once per
 * new snapshot (not per edge-flow batch), reading the edge-flow store at that
 * moment. Returns empty maps when there are no snapshots. All values are
 * measured: see utils/liveVisualization.ts for the honesty rules.
 *
 * @param snapshots snapshot history from useSimulation (oldest first)
 * @param topology the topology that is running, for configured edge latencies
 */
export function useLiveVisualization(
  snapshots: TimeSeriesSnapshot[],
  topology?: TopologyJSON | null
): LiveVisualization {
  const latest = snapshots[snapshots.length - 1]

  const sourceNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (topology?.workload?.sourceNodeId) ids.add(topology.workload.sourceNodeId)
    for (const node of topology?.nodes ?? []) {
      if (node.role === 'source') ids.add(node.id)
    }
    return ids
  }, [topology])

  const expectedLatencyByEdge = useMemo(() => {
    const byEdge = new Map<string, number>()
    for (const edge of topology?.edges ?? []) {
      const mean = distributionMean(edge.latency?.distribution)
      if (Number.isFinite(mean) && mean > 0) byEdge.set(edge.id, mean)
    }
    return byEdge
  }, [topology])

  return useMemo(() => {
    if (!latest) return EMPTY
    const edgeFlowById = useStore.getState().edgeFlowById
    const edges: Record<string, LiveEdgeInput> = {}
    for (const [edgeId, flow] of Object.entries(edgeFlowById)) {
      edges[edgeId] = {
        throughputRps: flow.attemptedPerSecond,
        recentLatenciesMs: flow.recent
          .filter((event) => event.status === 'success')
          .map((event) => event.latencyMs),
        expectedLatencyMs: expectedLatencyByEdge.get(edgeId)
      }
    }
    return computeLiveVisualization(snapshots, edges, LIVE_WINDOW_MS, sourceNodeIds)
    // `latest` identifies a new snapshot; recompute only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, expectedLatencyByEdge, sourceNodeIds])
}
