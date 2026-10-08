// Minimal ANSI palette that switches itself off when the target stream is not a
// terminal (pipes, files, CI logs) or when NO_COLOR is set. FORCE_COLOR forces it on.

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

export function shouldColor(
  stream: { isTTY?: boolean },
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') {
    return true
  }
  if (env.TERM === 'dumb') return false
  return stream.isTTY === true
}

/** Visible width of a string that may contain SGR escape codes. */
export function visibleLength(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '').length
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
