// Minimal ANSI SGR palette and width helpers shared by the sim cli and the
// in-app terminal. Environment-free: deciding whether a stream gets colour
// (TTY, NO_COLOR, FORCE_COLOR) is the caller's job (see src/cli/ansi.ts).

export interface Palette {
  enabled: boolean
  bold: string
  dim: string
  red: string
  green: string
  yellow: string
  magenta: string
  cyan: string
  reset: string
}

const ON: Palette = {
  enabled: true,
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
}

const OFF: Palette = {
  enabled: false,
  bold: '',
  dim: '',
  red: '',
  green: '',
  yellow: '',
  magenta: '',
  cyan: '',
  reset: ''
}

export function palette(enabled: boolean): Palette {
  return enabled ? ON : OFF
}

// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\x1b\[[0-9;]*m/g

/** Remove SGR escape codes. */
export function stripAnsi(text: string): string {
  return text.replace(SGR_PATTERN, '')
}

/** Visible width of a string that may contain SGR escape codes. */
export function visibleLength(text: string): number {
  return stripAnsi(text).length
}

export function padEndVisible(text: string, width: number): string {
  const gap = width - visibleLength(text)
  return gap > 0 ? text + ' '.repeat(gap) : text
}

export function padStartVisible(text: string, width: number): string {
  const gap = width - visibleLength(text)
  return gap > 0 ? ' '.repeat(gap) + text : text
}

export function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return text.slice(0, width)
  return `${text.slice(0, width - 1)}~`
}
