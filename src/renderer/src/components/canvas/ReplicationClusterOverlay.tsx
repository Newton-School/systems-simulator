import { useMemo } from 'react'
import { Minimize2 } from 'lucide-react'
import { useStore as useFlowView, useViewport } from 'reactflow'
import { useReplicationView } from './replicationViewStore'
import { findReplicationGroups, type GroupNodeLike } from './replicationClusterGroups'

/**
 * Draws a dashed boundary around each replication group so the databases read
 * as one cluster. Display-only and click-through.
 */
export function ReplicationClusterOverlay({
  hiddenPaths = 0,
  collapsed = false
}: {
  hiddenPaths?: number
  collapsed?: boolean
}) {
  const { x, y, zoom } = useViewport()
  const nodeInternals = useFlowView((state) => state.nodeInternals)
  const groups = useMemo(
    () => findReplicationGroups(Array.from(nodeInternals.values()) as GroupNodeLike[]),
    [nodeInternals]
  )
  if (groups.length === 0 || collapsed) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      <div
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: '0 0' }}
      >
        {groups.map((group) => (
          <div
            key={group.leaderId}
            data-testid="replication-cluster-boundary"
            className="absolute rounded-2xl border border-dashed border-nss-info/50 bg-nss-info/[0.04]"
            style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
          >
            <button
              type="button"
              title="Collapse into one cluster"
              onClick={() => useReplicationView.getState().toggle('clusterCollapsed')}
              className="pointer-events-auto absolute -top-2.5 left-4 inline-flex items-center gap-1.5 rounded-full border border-nss-info/40 bg-nss-panel px-2 py-0.5 text-[10px] font-semibold tracking-wide text-nss-info hover:bg-nss-info/10"
            >
              Replication group · 1 leader · {group.followerCount} follower
              {group.followerCount === 1 ? '' : 's'}
              {hiddenPaths > 0 ? ` · ${hiddenPaths} paths hidden` : ''}
              <span className="inline-flex items-center gap-0.5 border-l border-nss-info/30 pl-1.5">
                <Minimize2 size={9} aria-hidden="true" /> Collapse
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
