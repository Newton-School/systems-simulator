import { NodeSymbol } from './symbols/NodeSymbol'

export const CLUSTER_GLYPH_WIDTH = 156
export const CLUSTER_GLYPH_HEIGHT = 120

/**
 * A replication group drawn as one cluster: a dashed plate holding the leader
 * above its followers, joined by dashed links. Display only.
 */
export function ClusterGlyph({
  templateId,
  followerCount
}: {
  templateId: string | undefined
  followerCount: number
}) {
  const shown = Math.min(Math.max(followerCount, 1), 3)
  const extra = followerCount - shown
  return (
    <div className="relative" style={{ width: CLUSTER_GLYPH_WIDTH, height: CLUSTER_GLYPH_HEIGHT }}>
      <div className="absolute inset-0 rounded-2xl border-2 border-nss-info/50 bg-nss-info/10 shadow-sm" />
      <svg
        className="pointer-events-none absolute inset-0 text-nss-info/60"
        width={CLUSTER_GLYPH_WIDTH}
        height={CLUSTER_GLYPH_HEIGHT}
        aria-hidden="true"
      >
        {Array.from({ length: shown }, (_, index) => {
          const x = ((index + 1) * CLUSTER_GLYPH_WIDTH) / (shown + 1)
          return (
            <line
              key={index}
              x1={CLUSTER_GLYPH_WIDTH / 2}
              y1={56}
              x2={x}
              y2={74}
              stroke="currentColor"
              strokeWidth={1.25}
              strokeDasharray="3 3"
            />
          )
        })}
      </svg>
      <div className="absolute left-1/2 top-2 -translate-x-1/2">
        <NodeSymbol templateId={templateId} size={52} />
      </div>
      {Array.from({ length: shown }, (_, index) => (
        <div
          key={index}
          className="absolute bottom-2 -translate-x-1/2"
          style={{ left: `${((index + 1) * 100) / (shown + 1)}%` }}
        >
          <NodeSymbol templateId={templateId} size={38} />
        </div>
      ))}
      {extra > 0 && (
        <span className="absolute bottom-1 right-2 text-[9px] font-semibold text-nss-info">
          +{extra}
        </span>
      )}
    </div>
  )
}
