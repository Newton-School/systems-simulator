import type { AnyNodeData } from '@renderer/types/ui'
import { getReplicationRolePresentation } from './replicationRolePresentation'

export function ReplicationRoleBadge({ data }: { data: Pick<AnyNodeData, 'sim'> }) {
  const presentation = getReplicationRolePresentation(data)
  if (!presentation) return null

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-[0.08em] shadow-sm ${presentation.className}`}
      title={presentation.title}
      aria-label={presentation.title}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${presentation.dotClassName}`}
        aria-hidden="true"
      />
      {presentation.label}
    </span>
  )
}
