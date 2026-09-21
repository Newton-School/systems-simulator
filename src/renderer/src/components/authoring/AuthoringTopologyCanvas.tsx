import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { TopologyJSON } from '../../../../engine/core/types'
import { useTopologySerializer } from '../../hooks/useTopologySerializer'
import useStore from '../../store/useStore'
import { topologyToCanvasFileData } from '../../utils/topologyCanvasAdapter'
import { convertNestedToFlat } from '../../utils/nodeTransformers'

const FlowCanvas = lazy(async () => {
  const module = await import('../canvas/FlowCanvas')
  return { default: module.FlowCanvas }
})

interface AuthoringTopologyCanvasProps {
  /** A key that changes when the caller switches which design is being edited. */
  designKey: string
  topology: TopologyJSON | undefined
  onTopologyChange: (topology: TopologyJSON | undefined) => void
  defaultId: string
  defaultName: string
}

function topologyFingerprint(topology: TopologyJSON | undefined): string {
  return JSON.stringify(topology ?? null)
}

/**
 * A single global-store-backed canvas that hydrates from `topology` and serialises
 * every valid change back through `onTopologyChange`. It is the same contract the
 * scaffold editor uses; switching `designKey` snapshots the previous design (via the
 * store reset) and loads the next one. Only one authoring canvas is mounted at a time.
 */
export function AuthoringTopologyCanvas({
  designKey,
  topology,
  onTopologyChange,
  defaultId,
  defaultName
}: AuthoringTopologyCanvasProps): React.JSX.Element {
  const nodes = useStore((state) => state.nodes)
  const graphRevision = useStore((state) => state.graphRevision)
  const setGraph = useStore((state) => state.setGraph)
  const setScenario = useStore((state) => state.setScenario)
  const { serialize } = useTopologySerializer()
  const [syncError, setSyncError] = useState<string | null>(null)
  const hydratingRef = useRef(false)
  const hydratedRevisionRef = useRef<number | null>(null)
  const storedFingerprint = useMemo(() => topologyFingerprint(topology), [topology])

  // Re-hydrate whenever the selected design changes or its stored topology changes.
  useEffect(() => {
    hydratingRef.current = true
    if (topology) {
      const canvas = topologyToCanvasFileData(topology)
      setGraph(convertNestedToFlat(canvas.nodes), canvas.edges, {
        history: 'skip',
        resetHistory: true
      })
      if (canvas.scenario) setScenario(canvas.scenario)
    } else {
      setGraph([], [], { history: 'skip', resetHistory: true })
    }
    hydratedRevisionRef.current = useStore.getState().graphRevision
    setSyncError(null)
    queueMicrotask(() => {
      hydratingRef.current = false
    })
    // designKey is intentionally a dependency so switching designs reloads the canvas.
  }, [designKey, setGraph, setScenario, storedFingerprint, topology])

  useEffect(
    () => () => {
      useStore.getState().setGraph([], [], { history: 'skip', resetHistory: true })
    },
    []
  )

  useEffect(() => {
    if (hydratingRef.current || hydratedRevisionRef.current === graphRevision) return
    const result = serialize()
    if (!result.topology) {
      if (nodes.length === 0 && topology) onTopologyChange(undefined)
      setSyncError(nodes.length === 0 ? null : (result.errors[0] ?? 'Canvas is not valid yet.'))
      return
    }
    const snapshot: TopologyJSON = {
      ...result.topology,
      id: topology?.id ?? defaultId,
      name: topology?.name ?? defaultName,
      version: topology?.version ?? result.topology.version
    }
    setSyncError(null)
    if (topologyFingerprint(snapshot) !== storedFingerprint) {
      onTopologyChange(snapshot)
    }
  }, [
    defaultId,
    defaultName,
    graphRevision,
    nodes.length,
    onTopologyChange,
    serialize,
    storedFingerprint,
    topology
  ])

  return (
    <div>
      {syncError && (
        <p
          role="alert"
          className="rounded-t-md border border-nss-warning/25 bg-nss-warning/10 px-4 py-2 text-[11px] text-nss-warning"
        >
          Canvas not stored yet: {syncError}
        </p>
      )}
      <div
        className="relative h-[28rem] min-h-72 overflow-hidden rounded-md bg-nss-bg"
        data-testid="authoring-topology-canvas"
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-nss-muted">
              Loading canvas…
            </div>
          }
        >
          <FlowCanvas />
        </Suspense>
      </div>
    </div>
  )
}
