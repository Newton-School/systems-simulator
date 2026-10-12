import { padEndVisible, padStartVisible, visibleLength, type Palette } from '../ansi'

/** Plain-text table with ANSI-aware column widths. Numeric-looking columns right-align. */
export function table(
  headers: string[],
  rows: string[][],
  c: Palette,
  options: { align?: Array<'left' | 'right'>; indent?: string } = {}
): string[] {
  const indent = options.indent ?? ''
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => visibleLength(row[column] ?? '')))
  )
  const align = options.align ?? headers.map(() => 'left' as const)
  const pad = (text: string, column: number): string =>
    align[column] === 'right'
      ? padStartVisible(text, widths[column])
      : padEndVisible(text, widths[column])
  const lines = [
    `${indent}${c.bold}${headers.map((header, column) => pad(header, column)).join('  ')}${c.reset}`,
    `${indent}${c.dim}${widths.map((width) => '-'.repeat(width)).join('  ')}${c.reset}`
  ]
  for (const row of rows) {
    lines.push(
      `${indent}${headers.map((_, column) => pad(row[column] ?? '', column)).join('  ')}`.trimEnd()
    )
  }
  return lines
}

/** `key  value` pairs with the keys padded to one width. */
export function keyValues(pairs: Array<[string, string]>, c: Palette, indent = '  '): string[] {
  const width = Math.max(0, ...pairs.map(([key]) => key.length))
  return pairs.map(([key, value]) => `${indent}${c.dim}${key.padEnd(width)}${c.reset}  ${value}`)
}

export function heading(text: string, c: Palette, detail?: string): string {
  return `${c.bold}${text}${c.reset}${detail ? ` ${c.dim}${detail}${c.reset}` : ''}`
}

export function note(text: string, c: Palette): string {
  return `${c.dim}${text}${c.reset}`
}

export function warn(text: string, c: Palette): string {
  return `${c.yellow}${text}${c.reset}`
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'N/A'
  if (ms < 1) return `${ms.toFixed(3)}ms`
  if (ms < 1000) return `${ms.toFixed(1)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function fmtPct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return 'N/A'
  return `${(ratio * 100).toFixed(digits)}%`
}

export function fmtRps(rps: number | null | undefined): string {
  if (rps === null || rps === undefined || !Number.isFinite(rps)) return 'N/A'
  return rps >= 100 ? `${Math.round(rps)}/s` : `${rps.toFixed(1)}/s`
}

export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A'
  if (!Number.isFinite(value)) return value > 0 ? 'unbounded' : 'N/A'
  return Math.round(value).toLocaleString('en-US')
}

/** Simulated time in seconds from a microsecond string or ms number. */
export function fmtSimMs(ms: number): string {
  return `${(ms / 1000).toFixed(3)}s`
}

/** Status glyph used across status tables: ● ok, ◐ busy, ◉ saturated, ✗ failed. */
export function statusGlyph(status: string | undefined, c: Palette): string {
  switch (status) {
    case 'failed':
      return `${c.red}✗ failed${c.reset}`
    case 'saturated':
      return `${c.magenta}◉ saturated${c.reset}`
    case 'busy':
      return `${c.yellow}◐ busy${c.reset}`
    case 'idle':
      return `${c.green}● idle${c.reset}`
    default:
      return `${c.dim}- ${status ?? 'n/a'}${c.reset}`
  }
}

/** Colour a utilization ratio: green below 70%, yellow below 85%, red at or above. */
export function utilization(ratio: number | null | undefined, c: Palette): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return 'N/A'
  const text = fmtPct(ratio)
  if (ratio >= 0.85) return `${c.red}${text}${c.reset}`
  if (ratio >= 0.7) return `${c.yellow}${text}${c.reset}`
  return `${c.green}${text}${c.reset}`
}

/** Colour an error-rate ratio: green at 0, yellow below 1%, red above. */
export function errorRate(ratio: number | null | undefined, c: Palette): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return 'N/A'
  const text = fmtPct(ratio, 2)
  if (ratio === 0) return `${c.green}${text}${c.reset}`
  if (ratio < 0.01) return `${c.yellow}${text}${c.reset}`
  return `${c.red}${text}${c.reset}`
}

/** Render any config value compactly. */
export function fmtValue(value: unknown): string {
  if (value === undefined) return '(default)'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(+value.toFixed(6))
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`
  return JSON.stringify(value)
}
