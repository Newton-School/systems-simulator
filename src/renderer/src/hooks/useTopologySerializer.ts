import { useCallback } from 'react'
import useStore from '../store/useStore'
import { resolveEdgeModel } from '../../../engine/analysis/environmentProfile'
import type { ScenarioState } from '@renderer/types/ui'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'
import type {
  CanvasTopologyOptions,
  SerializerResult
} from '@renderer/utils/canvasTopologySerializer'

export {
  buildContainerLocations,
  pathTypeFromContainers,
  resolveEdgeLatencyDistribution,
  serializeEdgePresentation
} from '@renderer/utils/canvasTopologySerializer'
export type {
  ContainerPathResolution,
  SerializerResult
} from '@renderer/utils/canvasTopologySerializer'

/**
 * Store-bound wrapper around the pure `serializeCanvasToTopology`. The canvas
 * store stays the editor's source of truth; this is its canonical TopologyJSON
 * view (see the design note on `serializeCanvasToTopology`, #86).
 */
export function useTopologySerializer() {
  const nodes = useStore((state) => state.nodes)
  const edges = useStore((state) => state.edges)
  const scenario = useStore((state) => state.scenario)
  const connectorMode = useStore(
    (state) => resolveEdgeModel(state.environmentProfile, state.activeQuestion) === 'connector'
  )

  const serialize = useCallback(
    (
      overrideScenario?: ScenarioState,
      options: Pick<CanvasTopologyOptions, 'lenient'> = {}
    ): SerializerResult =>
      serializeCanvasToTopology(
        { nodes, edges, scenario: overrideScenario ?? scenario },
        { connectorMode, lenient: options.lenient }
      ),
    [edges, nodes, scenario, connectorMode]
  )

  return { serialize }
}
