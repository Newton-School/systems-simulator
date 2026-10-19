/** Glyph bodies in a 64x64 viewBox; stroke and colour come from the wrapping <svg>. */
export interface GlyphProps {
  /** Accent used for the soft fill. */
  fill: string
}

const SOFT = 0.16
const STRONG = 0.32

export const Client = ({ fill }: GlyphProps) => (
  <>
    <rect x="7" y="11" width="50" height="33" rx="4" fill={fill} fillOpacity={SOFT} />
    <rect
      x="12"
      y="16"
      width="40"
      height="23"
      rx="1.5"
      fill={fill}
      fillOpacity={STRONG}
      stroke="none"
    />
    <path d="M32 44v9M21 53h22" />
  </>
)

export const Cdn = ({ fill }: GlyphProps) => (
  <>
    <path
      d="M19 49a12 12 0 0 1-2-23.8A16 16 0 0 1 47.6 27.5 10.8 10.8 0 0 1 46 49Z"
      fill={fill}
      fillOpacity={SOFT}
    />
    <circle cx="32" cy="37" r="8.5" fill={fill} fillOpacity={STRONG} />
    <ellipse cx="32" cy="37" rx="3.6" ry="8.5" />
    <path d="M23.5 37h17" />
  </>
)

export const Gateway = ({ fill }: GlyphProps) => (
  <>
    <path d="M32 6 55 19v26L32 58 9 45V19Z" fill={fill} fillOpacity={SOFT} />
    <path d="M21 26h22m-5-5 5 5-5 5M43 39H21m5-5-5 5 5 5" />
  </>
)

export const LoadBalancer = ({ fill }: GlyphProps) => (
  <>
    <circle cx="32" cy="32" r="26" fill={fill} fillOpacity={SOFT} />
    <path d="M14 32h12M26 32l13-12M26 32h13M26 32l13 12" />
    <circle cx="43" cy="19" r="3.2" fill={fill} fillOpacity={STRONG} />
    <circle cx="43" cy="32" r="3.2" fill={fill} fillOpacity={STRONG} />
    <circle cx="43" cy="45" r="3.2" fill={fill} fillOpacity={STRONG} />
  </>
)

export const Server = ({ fill }: GlyphProps) => (
  <>
    <rect x="9" y="10" width="46" height="18" rx="3.5" fill={fill} fillOpacity={SOFT} />
    <rect x="9" y="36" width="46" height="18" rx="3.5" fill={fill} fillOpacity={SOFT} />
    <circle cx="19" cy="19" r="2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="45" r="2" fill="currentColor" stroke="none" />
    <path d="M30 19h17M30 45h17" />
  </>
)

export const Auth = ({ fill }: GlyphProps) => (
  <>
    <path
      d="M32 5 54 13v17c0 14-9.5 24-22 29C19.500 54 10 44 10 30V13Z"
      fill={fill}
      fillOpacity={SOFT}
    />
    <rect x="23" y="29" width="18" height="14" rx="2.5" fill={fill} fillOpacity={STRONG} />
    <path d="M27 29v-4.500a5 5 0 0 1 10 0V29" />
  </>
)

export const Queue = ({ fill }: GlyphProps) => (
  <>
    <rect x="14" y="19" width="38" height="26" rx="4" fill={fill} fillOpacity={SOFT} />
    <rect x="19" y="25" width="7" height="14" rx="1.5" fill={fill} fillOpacity={STRONG} />
    <rect x="29" y="25" width="7" height="14" rx="1.5" fill={fill} fillOpacity={STRONG} />
    <rect x="39" y="25" width="7" height="14" rx="1.5" fill={fill} fillOpacity={STRONG} />
    <path d="M3 32h8m-3-3 3 3-3 3M55 32h6m-3-3 3 3-3 3" />
  </>
)

export const Database = ({ fill }: GlyphProps) => (
  <>
    <path d="M12 14v36c0 4 9 7 20 7s20-3 20-7V14" fill={fill} fillOpacity={SOFT} />
    <path d="M12 27c0 4 9 7 20 7s20-3 20-7M12 40c0 4 9 7 20 7s20-3 20-7" />
    <ellipse cx="32" cy="14" rx="20" ry="7" fill={fill} fillOpacity={STRONG} />
  </>
)

export const Cache = ({ fill }: GlyphProps) => (
  <>
    <rect x="14" y="14" width="36" height="36" rx="5" fill={fill} fillOpacity={SOFT} />
    <path d="M24 6v8M32 6v8M40 6v8M24 50v8M32 50v8M40 50v8M6 24h8M6 32h8M6 40h8M50 24h8M50 32h8M50 40h8" />
    <path d="M34 19 25 33h7l-2 12 9-14h-7Z" fill={fill} fillOpacity={STRONG} />
  </>
)

/** Inner mark drawn on a shape, in a ~24px box centred on (32, 32). */
export interface SymbolOverlay {
  paths?: string[]
  dots?: Array<[number, number]>
  circles?: Array<[number, number, number]>
  /** Short label (e.g. "ID", "#") instead of a drawn mark. */
  text?: string
}

export type SymbolShape =
  | 'box'
  | 'hex'
  | 'circle'
  | 'cylinder'
  | 'shield'
  | 'cloud'
  | 'pipe'
  | 'chip'
  | 'bucket'
  | 'bell'
  | 'warehouse'

/** How each shape moves/scales the overlay so it sits in the shape's open area. */
const OVERLAY_TRANSFORM: Record<SymbolShape, string> = {
  box: '',
  hex: '',
  circle: '',
  cylinder: 'translate(32 41) scale(.85) translate(-32 -32)',
  shield: 'translate(32 31) scale(.9) translate(-32 -32)',
  cloud: 'translate(32 37) scale(.8) translate(-32 -32)',
  pipe: 'translate(32 32) scale(.8) translate(-32 -32)',
  chip: 'translate(32 32) scale(.75) translate(-32 -32)',
  bucket: 'translate(32 40) scale(.8) translate(-32 -32)',
  bell: 'translate(32 34) scale(.6) translate(-32 -32)',
  warehouse: 'translate(32 40) scale(.55) translate(-32 -32)'
}

const ShapeBody = ({ shape, fill }: { shape: SymbolShape; fill: string }) => {
  switch (shape) {
    case 'box':
      return <rect x="10" y="10" width="44" height="44" rx="9" fill={fill} fillOpacity={SOFT} />
    case 'hex':
      return <path d="M32 6 55 19v26L32 58 9 45V19Z" fill={fill} fillOpacity={SOFT} />
    case 'circle':
      return <circle cx="32" cy="32" r="26" fill={fill} fillOpacity={SOFT} />
    case 'cylinder':
      return (
        <>
          <path d="M12 14v36c0 4 9 7 20 7s20-3 20-7V14" fill={fill} fillOpacity={SOFT} />
          <ellipse cx="32" cy="14" rx="20" ry="7" fill={fill} fillOpacity={STRONG} />
        </>
      )
    case 'shield':
      return (
        <path
          d="M32 5 54 13v17c0 14-9.5 24-22 29C19.5 54 10 44 10 30V13Z"
          fill={fill}
          fillOpacity={SOFT}
        />
      )
    case 'cloud':
      return (
        <path
          d="M19 49a12 12 0 0 1-2-23.8A16 16 0 0 1 47.6 27.5 10.8 10.8 0 0 1 46 49Z"
          fill={fill}
          fillOpacity={SOFT}
        />
      )
    case 'pipe':
      return (
        <>
          <rect x="14" y="19" width="38" height="26" rx="4" fill={fill} fillOpacity={SOFT} />
          <path d="M3 32h8m-3-3 3 3-3 3M55 32h6m-3-3 3 3-3 3" />
        </>
      )
    case 'chip':
      return (
        <>
          <rect x="14" y="14" width="36" height="36" rx="5" fill={fill} fillOpacity={SOFT} />
          <path d="M24 6v8M32 6v8M40 6v8M24 50v8M32 50v8M40 50v8M6 24h8M6 32h8M6 40h8M50 24h8M50 32h8M50 40h8" />
        </>
      )
    case 'bucket':
      return (
        <>
          <path d="M12 18l5 36c.5 3 8 5 15 5s14.5-2 15-5l5-36" fill={fill} fillOpacity={SOFT} />
          <ellipse cx="32" cy="18" rx="20" ry="6" fill={fill} fillOpacity={STRONG} />
        </>
      )
    case 'bell':
      return (
        <path
          d="M32 7a3 3 0 0 1 3 3 14 14 0 0 1 11 14v11l5 7H13l5-7V24A14 14 0 0 1 29 10a3 3 0 0 1 3-3ZM26 48a6 6 0 0 0 12 0"
          fill={fill}
          fillOpacity={SOFT}
        />
      )
    case 'warehouse':
      return (
        <>
          <path d="M6 26 32 8l26 18v30H6Z" fill={fill} fillOpacity={SOFT} />
          <path d="M20 56V40h24v16M20 48h24" />
        </>
      )
  }
}

export const ShapedGlyph = ({
  shape,
  overlay,
  fill
}: {
  shape: SymbolShape
  overlay?: SymbolOverlay
  fill: string
}) => (
  <>
    <ShapeBody shape={shape} fill={fill} />
    {overlay ? (
      <g transform={OVERLAY_TRANSFORM[shape] || undefined}>
        {overlay.paths?.map((d) => (
          <path key={d} d={d} />
        ))}
        {overlay.circles?.map(([cx, cy, r]) => (
          <circle key={`${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} />
        ))}
        {overlay.dots?.map(([cx, cy]) => (
          <circle
            key={`d${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="2.6"
            fill={fill}
            fillOpacity={STRONG + 0.3}
          />
        ))}
        {overlay.text ? (
          <text
            x="32"
            y="38"
            textAnchor="middle"
            fontSize="16"
            fontWeight="700"
            fill="currentColor"
            stroke="none"
          >
            {overlay.text}
          </text>
        ) : null}
      </g>
    ) : null}
  </>
)

/** Group boxes (cloud-provider style): a dashed or solid frame with a small mark inside. */
export const Region = ({ fill }: GlyphProps) => (
  <>
    <rect
      x="6"
      y="10"
      width="52"
      height="44"
      rx="8"
      strokeDasharray="5 4"
      fill={fill}
      fillOpacity={SOFT}
    />
    <path
      d="M22 42a7 7 0 0 1-1-13.9A10 10 0 0 1 40 29a6.500 6.500 0 0 1-1 13Z"
      fill={fill}
      fillOpacity={STRONG}
    />
  </>
)

export const Zone = ({ fill }: GlyphProps) => (
  <>
    <rect
      x="6"
      y="10"
      width="52"
      height="44"
      rx="8"
      strokeDasharray="5 4"
      fill={fill}
      fillOpacity={SOFT}
    />
    <rect x="20" y="20" width="24" height="9" rx="2" fill={fill} fillOpacity={STRONG} />
    <rect x="20" y="33" width="24" height="9" rx="2" fill={fill} fillOpacity={STRONG} />
    <path d="M25 24.500h.01M25 37.500h.01" />
  </>
)

export const Subnet = ({ fill }: GlyphProps) => (
  <>
    <rect x="6" y="10" width="52" height="44" rx="8" fill={fill} fillOpacity={SOFT} />
    <path
      d="M21 22h8v8h-8ZM35 22h8v8h-8ZM21 34h8v8h-8ZM35 34h8v8h-8Z"
      fill={fill}
      fillOpacity={STRONG}
    />
  </>
)
