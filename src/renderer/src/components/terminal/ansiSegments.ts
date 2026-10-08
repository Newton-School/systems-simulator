/**
 * Turn a line with ANSI SGR codes (the subset the shared palette emits: bold,
 * dim, red, green, yellow, magenta, cyan, reset) into styled segments. Unknown
 * codes are ignored; other escape sequences are stripped.
 */

export type AnsiColor = 'red' | 'green' | 'yellow' | 'magenta' | 'cyan'

export interface AnsiSegment {
  text: string
  bold: boolean
  dim: boolean
  color: AnsiColor | null
}

const COLOR_BY_CODE: Record<number, AnsiColor> = {
  31: 'red',
  32: 'green',
  33: 'yellow',
  35: 'magenta',
  36: 'cyan'
}

// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\x1b\[([0-9;]*)([A-Za-z])/g

export function parseAnsi(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let bold = false
  let dim = false
  let color: AnsiColor | null = null
  let cursor = 0
  const push = (text: string): void => {
    if (text.length === 0) return
    const last = segments[segments.length - 1]
    if (last && last.bold === bold && last.dim === dim && last.color === color) {
      last.text += text
    } else {
      segments.push({ text, bold, dim, color })
    }
  }
  for (const match of line.matchAll(ESCAPE_PATTERN)) {
    push(line.slice(cursor, match.index))
    cursor = (match.index ?? 0) + match[0].length
    if (match[2] !== 'm') continue
    const codes = match[1] === '' ? [0] : match[1].split(';').map(Number)
    for (const code of codes) {
      if (code === 0) {
        bold = false
        dim = false
        color = null
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 22) {
        bold = false
        dim = false
      } else if (code === 39) color = null
      else if (COLOR_BY_CODE[code]) color = COLOR_BY_CODE[code]
    }
  }
  push(line.slice(cursor))
  return segments
}
