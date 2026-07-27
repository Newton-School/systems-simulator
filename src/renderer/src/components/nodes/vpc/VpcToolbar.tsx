import { memo } from 'react'
import { NodeToolbar, Position } from 'reactflow'
import { Ungroup, CheckCircle2 } from 'lucide-react'

interface VpcToolbarProps {
  isVisible: boolean
  isUngrouped: boolean
  hasChildren: boolean
  onUngroup: (e: React.MouseEvent) => void
}

export const VpcToolbar = memo(
  ({ isVisible, isUngrouped, hasChildren, onUngroup }: VpcToolbarProps) => {
    if (!hasChildren && !isUngrouped) return null

    return (
      <NodeToolbar isVisible={isVisible} position={Position.Top} offset={8}>
        <button
          onClick={onUngroup}
          disabled={isUngrouped}
          className={`
            pointer-events-auto
            flex items-center gap-1.5 px-2 py-1 rounded shadow-md text-[10px] font-bold uppercase tracking-wider transition-colors border
            ${
              isUngrouped
                ? 'bg-nss-surface border-nss-border text-nss-muted cursor-default'
                : 'bg-[rgb(var(--nss-danger))]/10 border-[rgb(var(--nss-danger))]/50 text-[rgb(var(--nss-danger))] hover:bg-[rgb(var(--nss-danger))] hover:text-white cursor-pointer'
            }
          `}
        >
          {isUngrouped ? <CheckCircle2 size={12} /> : <Ungroup size={12} />}
          <span>{isUngrouped ? 'Done' : 'Ungroup'}</span>
        </button>
      </NodeToolbar>
    )
  }
)

VpcToolbar.displayName = 'VpcToolbar'
