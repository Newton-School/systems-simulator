// The palette and width helpers live in src/shared/ansi.ts (shared with the
// in-app terminal). This module adds the stream-dependent part: the palette
// switches itself off when the target stream is not a terminal (pipes, files,
// CI logs) or when NO_COLOR is set. FORCE_COLOR forces it on.

export {
  palette,
  padEndVisible,
  padStartVisible,
  stripAnsi,
  truncate,
  visibleLength,
  type Palette
} from '../shared/ansi'

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
