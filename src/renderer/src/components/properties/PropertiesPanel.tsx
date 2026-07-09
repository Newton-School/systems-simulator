import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Settings } from 'lucide-react'
import type { FieldPath } from '@renderer/config/fieldConfig'
import type { AnyNodeData } from '@renderer/types/ui'
import { useNodeMetrics } from '@renderer/hooks/useNodeMetrics'
import useStore from '../../store/useStore'
import { PropertiesHeader } from './PropertiesHeader'
import { PropertiesForm } from './PropertiesForm'
import { NodeMetricsDetail } from './NodeMetricsDetail'

const EmptyState = () => (
  <div className="h-full bg-nss-panel border-l border-nss-border flex flex-col items-center justify-center text-nss-muted gap-2">
    <Settings size={24} className="opacity-20" />
    <p className="text-xs font-medium uppercase tracking-wide">No Selection</p>
  </div>
)

function setPathValue(target: AnyNodeData, path: FieldPath, value: unknown): Partial<AnyNodeData> {
  const segments = path.split('.')
  const [root, ...rest] = segments

  if (rest.length === 0) {
    return { [root]: value } as Partial<AnyNodeData>
  }

  const currentRootValue = (target as unknown as Record<string, unknown>)[root]
  const clonedRoot = Array.isArray(currentRootValue)
    ? [...currentRootValue]
    : currentRootValue && typeof currentRootValue === 'object'
      ? { ...(currentRootValue as Record<string, unknown>) }
      : {}

  let cursor: unknown = clonedRoot
  let sourceCursor: unknown = currentRootValue

  for (let index = 0; index < rest.length - 1; index++) {
    const segment = rest[index]
    const nextSegment = rest[index + 1]
    const sourceValue =
      Array.isArray(sourceCursor) && Number.isInteger(Number(segment))
        ? sourceCursor[Number(segment)]
        : sourceCursor && typeof sourceCursor === 'object'
          ? (sourceCursor as Record<string, unknown>)[segment]
          : undefined

    const nextValue = Array.isArray(sourceValue)
      ? [...sourceValue]
      : sourceValue && typeof sourceValue === 'object'
        ? { ...(sourceValue as Record<string, unknown>) }
        : Number.isInteger(Number(nextSegment))
          ? []
          : {}

    if (Array.isArray(cursor)) {
      cursor[Number(segment)] = nextValue
    } else {
      ;(cursor as Record<string, unknown>)[segment] = nextValue
    }

    cursor = nextValue
    sourceCursor = sourceValue
  }

  const lastSegment = rest[rest.length - 1]
  if (Array.isArray(cursor) && Number.isInteger(Number(lastSegment))) {
    cursor[Number(lastSegment)] = value
  } else {
    ;(cursor as Record<string, unknown>)[lastSegment] = value
  }

  return { [root]: clonedRoot } as Partial<AnyNodeData>
}

type PanelTab = 'metrics' | 'config'

export const PropertiesPanel = () => {
  const nodes = useStore((state) => state.nodes)
  const updateNodeData = useStore((state) => state.updateNodeData)

  const selectedNode = nodes.find((node) => node.selected)
  const metrics = useNodeMetrics(selectedNode?.id ?? '')
  const [tab, setTab] = useState<PanelTab>('metrics')

  // Selecting a node fresh after a run should open on its results, not
  // whatever tab was left over from the last node - config is where you go
  // on purpose, not by default, once there's something to show.
  useEffect(() => {
    setTab(metrics.hasRuntime ? 'metrics' : 'config')
  }, [selectedNode?.id, metrics.hasRuntime])

  if (!selectedNode) return <EmptyState />

  const data = selectedNode.data as AnyNodeData

  const handleUpdate = (path: FieldPath, value: unknown) => {
    updateNodeData(selectedNode.id, setPathValue(data, path, value))
  }

  return (
    <div className="h-full w-full bg-nss-panel border-l border-nss-border flex flex-col text-nss-text font-sans shadow-xl">
      <PropertiesHeader data={data} />

      {metrics.hasRuntime && (
        <div className="flex gap-1 border-b border-nss-border px-3 pt-3">
          {(['metrics', 'config'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              className={clsx(
                'rounded-t px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                tab === option
                  ? 'bg-nss-surface text-nss-text border border-b-0 border-nss-border'
                  : 'text-nss-muted hover:text-nss-text'
              )}
            >
              {option === 'metrics' ? 'Results' : 'Config'}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 bg-nss-panel">
        {metrics.hasRuntime && tab === 'metrics' ? (
          <NodeMetricsDetail metrics={metrics} />
        ) : (
          <PropertiesForm nodeId={selectedNode.id} data={data} onUpdate={handleUpdate} />
        )}
      </div>
    </div>
  )
}
