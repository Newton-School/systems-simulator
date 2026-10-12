import { useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck, TriangleAlert } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { useTopologySerializer } from '@renderer/hooks/useTopologySerializer'
import {
  detectAntiPatterns,
  type AntiPatternWarning
} from '../../../../engine/analysis/antiPatterns'
import { AntiPatternPanel } from '../simulation/AntiPatternPanel'

/**
 * Header chip for static design checks (anti-pattern detection). Like the cost
 * chip it recomputes on every canvas edit and needs no run. Hidden in graded
 * ASSIGNMENT mode so it never hands a student the answer to a design question.
 */
export function DesignChecksChip(): React.JSX.Element | null {
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const mode = useStore((s) => s.environmentProfile.mode)
  const selectGraphElements = useStore((s) => s.selectGraphElements)
  const { serialize } = useTopologySerializer()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const warnings = useMemo<AntiPatternWarning[]>(() => {
    try {
      const topology = serialize().topology
      return topology ? detectAntiPatterns(topology) : []
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, serialize])

  const labelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of nodes) {
      const label = (node.data as { label?: unknown } | undefined)?.label
      map.set(node.id, typeof label === 'string' && label.length > 0 ? label : node.id)
    }
    return map
  }, [nodes])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (mode === 'ASSIGNMENT') return null

  const hasNodes = nodes.length > 0
  const criticalCount = warnings.filter((w) => w.severity === 'critical').length
  const count = warnings.length
  const tone =
    criticalCount > 0
      ? 'border-nss-danger/40 text-nss-danger'
      : count > 0
        ? 'border-nss-warning/40 text-nss-warning'
        : 'border-nss-border text-nss-muted'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasNodes}
        title="Design checks: architectural anti-patterns in this topology"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-md border bg-nss-surface px-2 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-nss-muted disabled:cursor-default disabled:opacity-50 ${tone}`}
      >
        {count > 0 ? <TriangleAlert size={13} /> : <ShieldCheck size={13} />}
        {count > 0 ? `${count} design ${count === 1 ? 'check' : 'checks'}` : 'Design OK'}
      </button>

      {open && hasNodes && (
        <div className="absolute left-0 top-full z-50 mt-1 w-96 overflow-hidden rounded-md border border-nss-border bg-nss-panel shadow-lg">
          <div className="flex items-baseline justify-between border-b border-nss-border px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-nss-muted">
              Design checks
            </span>
            <span className="text-[10px] text-nss-muted">static, no run needed</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
            <AntiPatternPanel
              warnings={warnings}
              labelFor={(id) => labelById.get(id) ?? id}
              onSelectNode={(nodeId) => selectGraphElements({ nodeId })}
            />
          </div>
        </div>
      )}
    </div>
  )
}
