import { AlertTriangle, GitBranch } from 'lucide-react'
import type { AnyNodeData } from '@renderer/types/ui'
import { ReplicationRoleBadge } from '../nodes/ReplicationRoleBadge'
import { buildReplicationConfigSummary } from './replicationInspector'

export function ReplicationConfigSummary({
  nodeId,
  data,
  nodes
}: {
  nodeId: string
  data: AnyNodeData
  nodes: readonly { id: string; data: unknown }[]
}) {
  const summary = buildReplicationConfigSummary(nodeId, data, nodes)
  if (!summary) return null

  return (
    <section
      aria-label="Replication group summary"
      className="mb-4 overflow-hidden rounded-lg border border-nss-info/25 bg-nss-surface"
    >
      <div className="flex items-start gap-3 border-b border-nss-border px-3 py-3">
        <div className="mt-0.5 rounded-md bg-nss-info/10 p-1.5 text-nss-info">
          <GitBranch size={15} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-nss-text">Replication group</h3>
            <ReplicationRoleBadge data={data} />
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-nss-muted">{summary.behavior}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-nss-border px-3 py-2.5 text-[10px]">
        <div className="pr-3">
          <dt className="font-semibold uppercase tracking-wide text-nss-muted">Members</dt>
          <dd className="mt-1 text-xs font-semibold text-nss-text">
            {summary.memberCount} total
            <span className="ml-1 font-normal text-nss-muted">
              · {summary.leaderCount} leader · {summary.followerCount} follower
              {summary.followerCount === 1 ? '' : 's'}
            </span>
          </dd>
        </div>
        <div className="pl-3">
          <dt className="font-semibold uppercase tracking-wide text-nss-muted">
            {summary.settingLabel}
          </dt>
          <dd className="mt-1 text-xs font-semibold text-nss-text">{summary.settingValue}</dd>
        </div>
      </dl>

      {summary.warning && (
        <div className="flex items-start gap-2 border-t border-nss-warning/25 bg-nss-warning/5 px-3 py-2 text-[10px] leading-relaxed text-nss-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{summary.warning}</span>
        </div>
      )}
    </section>
  )
}
