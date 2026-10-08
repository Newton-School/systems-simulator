import { create } from 'zustand'
import type { TopologyJSON } from '../../../../engine/core/types'
import { resolveEdgeModel } from '../../../../engine/analysis/environmentProfile'
import { createSession, type SessionState } from '../../../../shared/commands/session'
import useStore from '@renderer/store/useStore'
import { serializeCanvasToTopology } from '@renderer/utils/canvasTopologySerializer'

/**
 * Terminal session state lives outside the component so scrollback, history
 * and the mode stack survive the bottom panel closing and reopening.
 */

export const SCROLLBACK_LIMIT = 2000

export interface TerminalEntry {
  id: number
  /** Prompt + command echo, or an output line (ANSI SGR allowed). */
  text: string
  kind: 'input' | 'output'
}

export interface TerminalWatch {
  line: string
  intervalMs: number
  /** Id of the first entry of the block the watch rewrites. */
  blockId: number
}

interface TerminalStoreState {
  entries: TerminalEntry[]
  session: SessionState
  watch: TerminalWatch | null
  nextId: number
  append(lines: string[], kind?: TerminalEntry['kind']): number
  /** Replace every entry from `blockId` on with `lines` (watch refresh). */
  replaceFrom(blockId: number, lines: string[]): void
  clear(): void
  setSession(session: SessionState): void
  setWatch(watch: TerminalWatch | null): void
}

export const useTerminalStore = create<TerminalStoreState>((set, get) => ({
  entries: [],
  session: createSession(),
  watch: null,
  nextId: 1,
  append: (lines, kind = 'output') => {
    const first = get().nextId
    set((state) => {
      const added = lines.map((text, index) => ({ id: state.nextId + index, text, kind }))
      return {
        entries: [...state.entries, ...added].slice(-SCROLLBACK_LIMIT),
        nextId: state.nextId + lines.length
      }
    })
    return first
  },
  replaceFrom: (blockId, lines) =>
    set((state) => {
      const kept = state.entries.filter((entry) => entry.id < blockId)
      const added = lines.map((text, index) => ({
        id: blockId + index,
        text,
        kind: 'output' as const
      }))
      return {
        entries: [...kept, ...added],
        nextId: Math.max(state.nextId, blockId + lines.length)
      }
    }),
  clear: () => set({ entries: [] }),
  setSession: (session) => set({ session }),
  setWatch: (watch) => set({ watch })
}))

// ─── Saved baseline for `show config diff` ───────────────────────────────────

let baseline: TopologyJSON | null = null
let tracking = false

function captureBaseline(): void {
  const state = useStore.getState()
  baseline = serializeCanvasToTopology(
    { nodes: state.nodes, edges: state.edges, scenario: state.scenario },
    {
      lenient: true,
      connectorMode:
        resolveEdgeModel(state.environmentProfile, state.activeQuestion) === 'connector'
    }
  ).topology
}

/**
 * Remember the topology whenever a topology is loaded (the graph is replaced
 * with a fresh undo history) or saved (`isUnsaved` turns false). Idempotent;
 * call once at app start.
 */
export function trackSavedTopologyBaseline(): () => void {
  if (tracking) return () => {}
  tracking = true
  if (!useStore.getState().isUnsaved) captureBaseline()
  const unsubscribe = useStore.subscribe((state, previous) => {
    const becameSaved = !state.isUnsaved && previous.isUnsaved
    // The scenario is set right after the graph on a load, so capture once both are in.
    // An untouched undo history means the graph is exactly what was loaded
    // (setGraph resetHistory); edits always push an undo entry.
    const historyReset =
      state.graphHistory.past.length === 0 &&
      state.graphHistory.future.length === 0 &&
      (state.nodes !== previous.nodes || state.edges !== previous.edges)
    if (becameSaved) captureBaseline()
    else if (historyReset) setTimeout(captureBaseline, 0)
  })
  return () => {
    unsubscribe()
    tracking = false
  }
}

export function getSavedTopologyBaseline(): TopologyJSON | null {
  return baseline
}
