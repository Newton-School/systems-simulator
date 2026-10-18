import { ShapedGlyph } from './glyphs'
import { SYMBOL_BY_TEMPLATE } from './symbolRegistry'

/** Architecture-diagram symbol for a palette template (64x64 viewBox, single accent colour). */
interface NodeSymbolProps {
  templateId: string | undefined
  size?: number
  className?: string
}

export const NodeSymbol = ({ templateId, size = 72, className }: NodeSymbolProps) => {
  const def = templateId ? SYMBOL_BY_TEMPLATE[templateId] : undefined
  if (!def) return null
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke={def.color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      style={{ color: def.color, overflow: 'visible' }}
    >
      {def.glyph ? (
        <def.glyph fill={def.color} />
      ) : (
        <ShapedGlyph shape={def.shape} overlay={def.overlay} fill={def.color} />
      )}
    </svg>
  )
}
