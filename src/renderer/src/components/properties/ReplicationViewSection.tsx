import { Eye } from 'lucide-react'
import type { AnyNodeData } from '@renderer/types/ui'
import { useReplicationView } from '../canvas/replicationViewStore'

const OPTIONS = [
  {
    key: 'routing',
    label: 'Show every read/write path',
    hint: 'Off collapses the callers → followers mesh into the leader connection.'
  },
  { key: 'replication', label: 'Show replication links', hint: 'Leader → follower links.' },
  { key: 'lag', label: 'Show lag and synced status', hint: 'Follower chips after a run.' },
  { key: 'animation', label: 'Animate requests', hint: 'Moving packets on the canvas.' }
] as const

/** Display-only canvas options for this replication group; topology, routing and grading are unchanged. */
export function ReplicationViewSection({ data }: { data: AnyNodeData }) {
  const view = useReplicationView()
  if (data.sim?.replicationEnabled !== true) return null

  return (
    <section
      aria-label="Replication canvas view"
      className="mb-4 overflow-hidden rounded-lg border border-nss-border bg-nss-surface"
    >
      <div className="flex items-center gap-2 border-b border-nss-border px-3 py-2">
        <Eye size={13} className="text-nss-muted" aria-hidden="true" />
        <h3 className="text-xs font-semibold text-nss-text">Canvas view</h3>
        <span className="ml-auto text-[10px] text-nss-muted">Display only</span>
      </div>
      <div className="px-3 py-2">
        {OPTIONS.map(({ key, label, hint }) => (
          <label key={key} className="flex cursor-pointer items-start gap-2.5 py-1.5">
            <input
              type="checkbox"
              checked={view[key]}
              onChange={() => view.toggle(key)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-nss-primary"
            />
            <span className="min-w-0">
              <span className="block text-xs text-nss-text">{label}</span>
              <span className="block text-[10px] leading-relaxed text-nss-muted">{hint}</span>
            </span>
          </label>
        ))}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-nss-border pt-2 text-[10px] text-nss-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-nss-primary" aria-hidden="true" /> Write →
            leader
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-nss-success" aria-hidden="true" /> Read →
            follower
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-nss-info" aria-hidden="true" /> Replication
          </span>
        </div>
      </div>
    </section>
  )
}
