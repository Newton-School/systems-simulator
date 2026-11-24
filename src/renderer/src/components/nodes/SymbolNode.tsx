import { Maximize2 } from 'lucide-react'
import React, { memo, useCallback, useState } from 'react'
import type { NodeProps } from 'reactflow'
import UniversalHandle from '@renderer/components/ui/UniversalHandle'
import { InlineEditableLabel } from '@renderer/components/properties/InlineEditable'
import { NodeSettingsMenu } from '@renderer/components/nodes/NodeSettingsMenu'
import { useFlowStore } from '@renderer/components/canvas/hooks/useFlowStore'
import { useClassroomNodeView } from '@renderer/hooks/useClassroom'
import type { StandardNodeData } from '@renderer/types/ui'
import { NODE_OFFSETS, NODE_POSITIONS } from './nodeConstants'
import { NodeSymbol } from './symbols/NodeSymbol'
import { NodeFailureBadge } from './NodeFailureBadge'
import { ReplicationRoleBadge } from './ReplicationRoleBadge'
import { getReplicationRolePresentation } from './replicationRolePresentation'
import { ClusterGlyph, CLUSTER_GLYPH_HEIGHT, CLUSTER_GLYPH_WIDTH } from './ClusterGlyph'
import { ClusterSummaryChips } from './ClusterSummaryChips'
import { useReplicationView } from '@renderer/components/canvas/replicationViewStore'

const SYMBOL_SIZE = 72

/**
 * Architecture-diagram rendering of a node: the component's symbol and its name,
 * and nothing else. No metrics, lens, or health chrome.
 */
const SymbolNode = ({ id, data, selected }: NodeProps<StandardNodeData>) => {
  const { updateNodeData } = useFlowStore()
  const classroomView = useClassroomNodeView(data)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const replicationRole = getReplicationRolePresentation(data)
  const clusterCollapsed = useReplicationView((state) => state.clusterCollapsed)
  const followerIds = String(data.sim?.replicaMembers ?? '')
    .split(',')
    .map((member) => member.trim())
    .filter((member) => member && member !== id)
  const isCollapsedCluster =
    clusterCollapsed && replicationRole?.label === 'LEADER' && followerIds.length > 0

  const handleLabelChange = useCallback(
    (label: string) => updateNodeData(id, { label }),
    [id, updateNodeData]
  )
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsMenuOpen(true)
  }, [])
  const closeMenu = useCallback(() => setIsMenuOpen(false), [])
  const toggleMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsMenuOpen((open) => !open)
  }, [])

  return (
    <div
      onContextMenu={handleContextMenu}
      className="group relative flex w-32 flex-col items-center gap-1.5"
    >
      <div
        className={`relative flex items-center justify-center rounded-xl p-1 transition-shadow duration-150 ${
          selected ? 'ring-2 ring-nss-primary' : 'hover:ring-1 hover:ring-nss-border'
        }`}
        style={
          isCollapsedCluster
            ? { width: CLUSTER_GLYPH_WIDTH + 8, height: CLUSTER_GLYPH_HEIGHT + 8 }
            : { width: SYMBOL_SIZE + 8, height: SYMBOL_SIZE + 8 }
        }
      >
        <div className={(data.sim?.nodeErrorRate ?? 0) >= 1 ? 'opacity-45 grayscale' : undefined}>
          {isCollapsedCluster ? (
            <div className="relative">
              <ClusterGlyph templateId={data.templateId} followerCount={followerIds.length} />
              <button
                type="button"
                title="Expand cluster"
                aria-label="Expand cluster"
                onClick={(event) => {
                  event.stopPropagation()
                  useReplicationView.getState().toggle('clusterCollapsed')
                }}
                className="nodrag nopan absolute -right-2 -top-2 z-50 inline-flex h-5 items-center gap-1 rounded-full border border-nss-info/50 bg-nss-panel px-1.5 text-[9px] font-semibold text-nss-info shadow hover:bg-nss-info/10"
              >
                <Maximize2 size={9} aria-hidden="true" /> Expand
              </button>
            </div>
          ) : (
            <NodeSymbol templateId={data.templateId} size={SYMBOL_SIZE} />
          )}
        </div>
        <NodeFailureBadge
          errorRate={data.sim?.nodeErrorRate}
          className="-top-2 left-1/2 -translate-x-1/2"
        />
        {NODE_POSITIONS.map((pos) => (
          <React.Fragment key={pos}>
            {NODE_OFFSETS.map((offset, i) => (
              <UniversalHandle
                key={`${pos}-${i}`}
                id={`${pos}-${i}`}
                position={pos}
                offset={offset}
              />
            ))}
          </React.Fragment>
        ))}

        {/* Right-click opens the menu; its kebab trigger stays hidden. */}
        <div className="absolute right-0 top-0 z-50 [&_button[title=Settings]]:hidden">
          <NodeSettingsMenu
            nodeId={id}
            isOpen={isMenuOpen}
            onClose={closeMenu}
            onToggle={toggleMenu}
          />
        </div>
      </div>

      {replicationRole && (
        <div className="pointer-events-none z-40 -mt-2 flex min-h-4 max-w-[11rem] justify-center">
          <ReplicationRoleBadge data={data} nodeId={id} />
        </div>
      )}

      {isCollapsedCluster && <ClusterSummaryChips leaderId={id} followerIds={followerIds} />}

      <InlineEditableLabel
        value={classroomView?.label ?? (data.label || 'Service')}
        onSave={handleLabelChange}
        wrapLines={2}
        textClassName="w-full text-center text-xs font-semibold"
        inputClassName="w-full text-center text-xs font-semibold"
      />
    </div>
  )
}

export default memo(SymbolNode)
