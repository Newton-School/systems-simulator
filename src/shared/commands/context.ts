import type { TerminalContext, TerminalFrame, TerminalMode } from './types'

/**
 * Terminal mode state machine. Transitions are stack based: entering a mode
 * pushes the current frame, `exit` / `back` pops one level and `end` returns to
 * the `sim>` root. Every function is pure and returns a new context.
 */

export const ROOT_CONTEXT: TerminalContext = { mode: 'sim', history: [] }

/** Which modes may be entered from which. */
const ALLOWED_ENTRIES: Record<TerminalMode, readonly TerminalMode[]> = {
  sim: [],
  node: ['sim', 'runtime', 'node'],
  'node-config': ['node'],
  'port-config': ['node-config'],
  runtime: ['sim']
}

function frameOf(ctx: TerminalContext): TerminalFrame {
  const frame: TerminalFrame = { mode: ctx.mode }
  if (ctx.nodeId !== undefined) frame.nodeId = ctx.nodeId
  if (ctx.portIndex !== undefined) frame.portIndex = ctx.portIndex
  if (ctx.edgeId !== undefined) frame.edgeId = ctx.edgeId
  return frame
}

function contextFrom(frame: TerminalFrame, history: TerminalFrame[]): TerminalContext {
  return { ...frame, history }
}

export function canEnter(ctx: TerminalContext, mode: TerminalMode): boolean {
  return ALLOWED_ENTRIES[mode].includes(ctx.mode)
}

/** Push `frame` on top of the current context. Throws on an illegal transition. */
export function enterMode(ctx: TerminalContext, frame: TerminalFrame): TerminalContext {
  if (!canEnter(ctx, frame.mode)) {
    throw new Error(`Cannot enter ${frame.mode} mode from ${ctx.mode} mode.`)
  }
  if (frame.mode !== 'sim' && frame.mode !== 'runtime' && !frame.nodeId) {
    throw new Error(`${frame.mode} mode needs a node.`)
  }
  if (frame.mode === 'port-config' && (frame.portIndex === undefined || !frame.edgeId)) {
    throw new Error('port-config mode needs a port.')
  }
  // Selecting another node from node mode replaces the node frame rather than
  // stacking node(a) > node(b) > node(c).
  if (frame.mode === 'node' && ctx.mode === 'node') {
    return contextFrom(frame, ctx.history)
  }
  return contextFrom(frame, [...ctx.history, frameOf(ctx)])
}

/** Pop one level; the root stays the root. */
export function exitMode(ctx: TerminalContext): TerminalContext {
  if (ctx.history.length === 0) return ctx.mode === 'sim' ? ctx : ROOT_CONTEXT
  const previous = ctx.history[ctx.history.length - 1]
  return contextFrom(previous, ctx.history.slice(0, -1))
}

/** Back to `sim>`. */
export function endMode(): TerminalContext {
  return ROOT_CONTEXT
}

export function isInMode(ctx: TerminalContext, mode: TerminalMode): boolean {
  return ctx.mode === mode || ctx.history.some((frame) => frame.mode === mode)
}

/**
 * Drop runtime frames (the run ended): `sim(runtime)#` pops back to what was
 * below it, and a node context entered from runtime keeps its place but exits
 * to `sim>` instead of a runtime mode that no longer applies.
 */
export function leaveRuntime(ctx: TerminalContext): TerminalContext {
  if (!isInMode(ctx, 'runtime')) return ctx
  const history = ctx.history.filter((frame) => frame.mode !== 'runtime')
  if (ctx.mode === 'runtime') {
    if (history.length === 0) return ROOT_CONTEXT
    return contextFrom(history[history.length - 1], history.slice(0, -1))
  }
  return { ...ctx, history }
}

/** `sim(runtime)#` from wherever the user is (auto-enter on run start). */
export function enterRuntime(ctx: TerminalContext): TerminalContext {
  if (isInMode(ctx, 'runtime')) return ctx
  if (ctx.mode === 'sim') return enterMode(ctx, { mode: 'runtime' })
  // From a node / config context: leave it on the stack so `exit` returns there.
  return contextFrom({ mode: 'runtime' }, [...ctx.history, frameOf(ctx)])
}

/** If the selected node no longer exists, fall back to the root. */
export function pruneMissingNode(
  ctx: TerminalContext,
  nodeExists: (id: string) => boolean
): TerminalContext {
  const frames = [...ctx.history, frameOf(ctx)]
  if (frames.every((frame) => !frame.nodeId || nodeExists(frame.nodeId))) return ctx
  const firstMissing = frames.findIndex((frame) => frame.nodeId && !nodeExists(frame.nodeId))
  const kept = frames.slice(0, firstMissing)
  if (kept.length === 0) return ROOT_CONTEXT
  return contextFrom(kept[kept.length - 1], kept.slice(0, -1))
}

export function promptFor(ctx: TerminalContext): string {
  switch (ctx.mode) {
    case 'sim':
      return 'sim>'
    case 'runtime':
      return 'sim(runtime)#'
    case 'node':
      return `node(${ctx.nodeId})>`
    case 'node-config':
      return `node(${ctx.nodeId})(config)#`
    case 'port-config':
      return `node(${ctx.nodeId})(config-port:${ctx.portIndex})#`
  }
}
