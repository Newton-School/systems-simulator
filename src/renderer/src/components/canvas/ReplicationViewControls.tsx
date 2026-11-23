import { useReplicationView, type ReplicationViewState } from './replicationViewStore'

const OPTIONS: { key: 'routing' | 'replication' | 'lag'; label: string; title: string }[] = [
  { key: 'routing', label: 'Read/write routing', title: 'Show every API → database path' },
  { key: 'replication', label: 'Replication', title: 'Show leader → follower links' },
  { key: 'lag', label: 'Lag', title: 'Show follower lag / synced status' }
]

/** Display-only toggles; the stored topology, routing and grading never change. */
export function ReplicationViewControls() {
  const view = useReplicationView()
  return (
    <div
      role="group"
      aria-label="Replication view"
      className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full border border-nss-border bg-nss-panel/95 p-1 shadow backdrop-blur"
    >
      {OPTIONS.map(({ key, label, title }) => {
        const on = view[key as keyof ReplicationViewState] === true
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            title={title}
            onClick={() => view.toggle(key)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              on ? 'bg-nss-info/15 text-nss-info' : 'text-nss-muted hover:text-nss-text'
            }`}
          >
            {on ? '✓ ' : ''}
            {label}
          </button>
        )
      })}
    </div>
  )
}
