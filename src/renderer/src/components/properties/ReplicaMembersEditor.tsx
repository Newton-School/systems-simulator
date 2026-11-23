import { useMemo } from 'react'
import useStore from '@renderer/store/useStore'
import type { AnyNodeData } from '@renderer/types/ui'
import { Label } from '../ui/Label'
import {
  findManagingLeader,
  isReplicationLeaderSim,
  parseReplicaMemberIds,
  planReplicaMembershipSync,
  serializeReplicaMemberIds,
  toggleReplicaMember
} from './replicaMembers'

interface ReplicaMembersEditorProps {
  nodeId: string
  data: AnyNodeData
  value: unknown
  onChange: (value: string | undefined) => void
}

export function ReplicaMembersEditor({ nodeId, data, value, onChange }: ReplicaMembersEditorProps) {
  const nodes = useStore((state) => state.nodes)
  const updateNodeData = useStore((state) => state.updateNodeData)
  const managingLeader = findManagingLeader(nodes, nodeId)
  const candidates = useMemo(
    () =>
      nodes.flatMap((node) => {
        const candidate = node.data as Partial<AnyNodeData>
        if (candidate.componentType !== data.componentType) return []
        return [{ id: node.id, label: candidate.label?.trim() || node.id }]
      }),
    [data.componentType, nodes]
  )
  const storedIds = parseReplicaMemberIds(value)
  const selectedIds = new Set([...storedIds, nodeId])
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  const unavailableIds = storedIds.filter((id) => !candidateIds.has(id))

  const commit = (memberId: string, selected: boolean) => {
    const toggled = toggleReplicaMember([...selectedIds], memberId, selected, nodeId)
    const order = new Map(candidates.map((candidate, index) => [candidate.id, index]))
    toggled.sort(
      (left, right) =>
        (order.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right)
    )
    if (isReplicationLeaderSim(data.sim as Record<string, unknown> | undefined)) {
      // Select once on the leader: everyone else in the set is kept in sync.
      for (const patch of planReplicaMembershipSync(nodes, nodeId, toggled)) {
        updateNodeData(patch.nodeId, { sim: patch.sim } as never)
      }
      onChange(serializeReplicaMemberIds([nodeId, ...toggled.filter((id) => id !== nodeId)]))
      return
    }
    onChange(serializeReplicaMemberIds(toggled))
  }

  if (managingLeader) {
    const leaderLabel =
      (managingLeader.data as Partial<AnyNodeData>).label?.trim() || managingLeader.id
    return (
      <div className="mb-5" data-field-path="sim.replicaMembers">
        <Label>Replica members</Label>
        <p className="mt-1 rounded-md border border-nss-border bg-nss-input-bg px-3 py-2 text-[11px] leading-relaxed text-nss-muted">
          Managed by the leader, <span className="font-semibold text-nss-text">{leaderLabel}</span>.
          Change the replica set there; this follower stays in sync automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="mb-5" data-field-path="sim.replicaMembers">
      <div className="flex items-baseline justify-between gap-3">
        <Label>Replica members</Label>
        <span className="text-[10px] font-semibold text-nss-muted">
          {selectedIds.size} selected
        </span>
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-nss-muted">
        Select the databases that share this replica set. Node IDs are saved automatically.
      </p>

      <div className="overflow-hidden rounded-md border border-nss-border bg-nss-input-bg">
        {candidates.map((candidate, index) => {
          const isCurrent = candidate.id === nodeId
          return (
            <label
              key={candidate.id}
              className={[
                'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-nss-surface',
                index > 0 ? 'border-t border-nss-border' : '',
                isCurrent ? 'cursor-default bg-nss-surface/60' : ''
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(candidate.id)}
                disabled={isCurrent}
                onChange={(event) => commit(candidate.id, event.currentTarget.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-nss-primary"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-nss-text">
                  {candidate.label}
                  {isCurrent ? ' (current)' : ''}
                </span>
                <span className="block truncate font-mono text-[10px] text-nss-muted">
                  {candidate.id}
                </span>
              </span>
            </label>
          )
        })}

        {candidates.length === 0 && (
          <p className="px-3 py-3 text-[11px] leading-relaxed text-nss-muted">
            Add another compatible database node to select it as a replica member.
          </p>
        )}
      </div>

      {unavailableIds.length > 0 && (
        <div className="mt-2 rounded-md border border-nss-warning/40 bg-nss-warning/5 p-2.5">
          <p className="mb-1.5 text-[10px] font-semibold text-nss-warning">Unavailable members</p>
          {unavailableIds.map((id) => (
            <label key={id} className="flex cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                checked
                onChange={() => commit(id, false)}
                className="h-3.5 w-3.5 accent-nss-primary"
              />
              <span className="truncate font-mono text-[10px] text-nss-muted">{id}</span>
            </label>
          ))}
          <p className="mt-1 text-[9px] leading-relaxed text-nss-muted">
            These IDs do not match compatible databases on the canvas. Uncheck them to clean up the
            replica set.
          </p>
        </div>
      )}
    </div>
  )
}
