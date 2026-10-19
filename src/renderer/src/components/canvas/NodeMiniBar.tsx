import { NodeToolbar, Position } from 'reactflow'
import { Copy, Trash2 } from 'lucide-react'
import useStore from '@renderer/store/useStore'
import { builderPolicyAdmissionBlock } from '@renderer/utils/builderPolicyContext'
import { useFlowStore } from './hooks/useFlowStore'
import { duplicateSelectedNode } from './utils/duplicateNode'

const BUTTON_CLASS =
  'flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-nss-text transition-colors hover:bg-nss-surface disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Simple shell's floating actions above a single selected node: the two things you do to a
 * node most (copy it, remove it) without opening the inspector or the canvas menu.
 */
export function NodeMiniBar({
  onDelete,
  disabled
}: {
  onDelete: () => void
  disabled: boolean
}): React.JSX.Element | null {
  const { nodes, edges, setGraph } = useFlowStore()
  const selected = nodes.filter((node) => node.selected)
  if (selected.length !== 1) return null
  const node = selected[0]

  const duplicate = (): void => {
    const copy = duplicateSelectedNode(nodes, edges)
    if (!copy) return
    // A duplicated created node is a new definition, so the builder policy applies to it.
    const policyBlock = builderPolicyAdmissionBlock(useStore.getState(), copy.nodes)
    if (policyBlock) {
      useStore.getState().setBuilderPolicyNotice(`Duplicate blocked: ${policyBlock}`)
      return
    }
    setGraph(
      [...nodes.map((existing) => ({ ...existing, selected: false })), ...copy.nodes],
      edges.map((edge) => ({ ...edge, selected: false }))
    )
  }

  return (
    <NodeToolbar nodeId={node.id} isVisible position={Position.Top} offset={10}>
      <div
        role="toolbar"
        aria-label="Node actions"
        data-testid="node-mini-bar"
        className="flex items-center gap-0.5 rounded-lg border border-nss-border bg-nss-panel p-0.5 shadow-lg"
      >
        <button type="button" disabled={disabled} onClick={duplicate} className={BUTTON_CLASS}>
          <Copy size={14} /> Duplicate
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onDelete}
          className={`${BUTTON_CLASS} text-nss-danger`}
        >
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </NodeToolbar>
  )
}
