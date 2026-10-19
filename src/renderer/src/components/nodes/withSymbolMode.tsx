import { memo, type ComponentType } from 'react'
import type { NodeProps } from 'reactflow'
import useStore from '@renderer/store/useStore'
import SymbolNode from './SymbolNode'
import { hasNodeSymbol } from './symbols/symbolRegistry'

/**
 * Renders a node as its architecture symbol when the user's node style is "symbol"
 * and the component has one; otherwise falls through to the detailed card. Kept as a
 * wrapper so the card components' hooks never run for symbol nodes.
 */
export function withSymbolMode<P extends NodeProps>(Card: ComponentType<P>) {
  const Wrapped = (props: P) => {
    const symbolMode = useStore((s) => s.displaySettings.nodeDisplayStyle === 'symbol')
    const templateId = (props.data as { templateId?: string }).templateId
    if (symbolMode && hasNodeSymbol(templateId)) {
      return <SymbolNode {...(props as unknown as NodeProps)} />
    }
    return <Card {...props} />
  }
  Wrapped.displayName = `withSymbolMode(${Card.displayName ?? Card.name ?? 'Node'})`
  return memo(Wrapped)
}
