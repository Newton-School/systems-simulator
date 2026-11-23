import { useMemo } from 'react'
import { useStore as useFlowView, useViewport } from 'reactflow'
import { findReplicationGroups, type GroupNodeLike } from './replicationClusterGroups'

/**
 * Draws a dashed boundary around each replication group so the databases read
 * as one cluster. Display-only and click-through.
 */
export function ReplicationClusterOverlay() {
  const { x, y, zoom } = useViewport()
  const nodeInternals = useFlowView((state) => state.nodeInternals)
  const groups = useMemo(
    () => findReplicationGroups(Array.from(nodeInternals.values()) as GroupNodeLike[]),
    [nodeInternals]
  )
  if (groups.length === 0) return null
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
            <span className="absolute -top-2.5 left-4 rounded-full border border-nss-info/40 bg-nss-panel px-2 py-0.5 text-[10px] font-semibold tracking-wide text-nss-info">
              Replication group · 1 leader · {group.followerCount} follower
              {group.followerCount === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
