import type { Palette } from '../ansi'
import type { SimulationOutput, TimeSeriesSnapshot } from '../../engine/analysis/output'
import type { TopologyJSON } from '../../engine/core/types'

// ─── Modes ────────────────────────────────────────────────────────────────────

/**
 * Terminal context modes (Packet Tracer style). Each has its own prompt and
 * command set:
 *   sim          `sim>`                              topology-level commands
 *   node         `node(api)>`                        inspect one node
 *   node-config  `node(api)(config)#`                change that node's config
 *   port-config  `node(api)(config-port:1)#`         change one of its connections
 *   runtime      `sim(runtime)#`                     control a running simulation
 */
export type TerminalMode = 'sim' | 'node' | 'node-config' | 'port-config' | 'runtime'

export const TERMINAL_MODES: readonly TerminalMode[] = [
  'sim',
  'node',
  'node-config',
  'port-config',
  'runtime'
]

/** One level of the mode stack. */
export interface TerminalFrame {
  mode: TerminalMode
  /** Set in node / node-config / port-config. */
  nodeId?: string
  /** 1-based index into the node's interface table (port-config only). */
  portIndex?: number
  /** The edge that port index resolved to when the mode was entered. */
  edgeId?: string
}

/** Current frame plus the stack below it; `exit` pops one level, `end` empties it. */
export interface TerminalContext extends TerminalFrame {
  history: TerminalFrame[]
}

// ─── Runtime data the commands read ──────────────────────────────────────────

export type SimulationRunStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error'

/** Simulated ms per wall ms, or 'max' (as fast as possible). */
export type TerminalPlaybackSpeed = number | 'max'

export interface SimulationStateView {
  status: SimulationRunStatus
  progress: number
  eventsProcessed: number
  playbackSpeed: TerminalPlaybackSpeed
  stopped: boolean
  error: string | null
  /** Latest live snapshot (while running / paused). */
  snapshot: TimeSeriesSnapshot | null
  /** Final output once the run completed. */
  results: SimulationOutput | null
  /** The topology the current / last run used. */
  runTopology: TopologyJSON | null
}

/**
 * Simulation control surface. In the app this is backed by `useSimulation`
 * (the same worker messages the playback controls send); the sim cli backs it
 * with a synchronous `runSimulation`, so the live controls are absent there.
 */
export interface SimulationAccess {
  state(): SimulationStateView
  /** Start a run of the current topology. Returns an error message, or null when it started. */
  run(): string | null
  pause?(): void
  resume?(): void
  step?(count: number): void
  stop?(): void
  setSpeed?(speed: TerminalPlaybackSpeed): void
}

// ─── Config access (app only) ─────────────────────────────────────────────────

/** One editable field, as the properties panel defines it. */
export interface ConfigFieldView {
  /** Data path, e.g. `sim.processing.timeout`. */
  path: string
  /** Terminal key, e.g. `timeout` (kebab-case of the last path segment, made unique). */
  key: string
  label: string
  section: string
  type: 'input' | 'slider' | 'select' | 'boolean'
  unit?: string
  options?: readonly string[]
  min?: number
  max?: number
  /** Value as the panel displays it (after any display transform). */
  displayValue: unknown
  /** False for list editors the terminal cannot express (routing rules, request mix, ...). */
  editable: boolean
  optional: boolean
}

export type ConfigWriteResult =
  | { ok: true; message?: string; undoable: boolean }
  | { ok: false; reason: string }

export interface NodeConfigAccess {
  fields(nodeId: string): ConfigFieldView[]
  /** Parse `rawValue` like the panel input would and write it. */
  set(nodeId: string, key: string, rawValue: string): ConfigWriteResult
  /** Clear the field back to its default (the panel's "Clear"). */
  reset(nodeId: string, key: string): ConfigWriteResult
}

/** Connection (edge) fields the edge inspector exposes and the engine reads. */
export interface EdgeFieldView {
  key: string
  label: string
  unit?: string
  options?: readonly string[]
  /** Authored value on the canvas (undefined = default). */
  authored: unknown
}

export interface EdgeConfigAccess {
  fields(edgeId: string): EdgeFieldView[]
  set(edgeId: string, key: string, rawValue: string): ConfigWriteResult
  reset(edgeId: string, key: string): ConfigWriteResult
}

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface TopologyResult {
  topology: TopologyJSON | null
  errors: string[]
}

export interface ValidationView {
  valid: boolean
  errors: Array<{ path?: string; message: string }>
  warnings: string[]
}

/**
 * Everything a command may touch. The same command code runs in the app
 * (store-backed deps) and in `sim shell` (file-backed deps); optional members
 * are absent where the host cannot support them and commands say so.
 */
export interface CommandDeps {
  palette: Palette
  /** Where the commands are running; used only for wording ("in the app", "in sim shell"). */
  host: 'app' | 'cli'
  /** The current topology as the engine would see it. */
  topology(): TopologyResult
  validate(topology: TopologyJSON): ValidationView
  /** Topology as last loaded / saved, for `show config diff`. */
  savedTopology?(): TopologyJSON | null
  sim?: SimulationAccess
  config?: NodeConfigAccess
  edges?: EdgeConfigAccess
  undo?(): boolean
  redo?(): boolean
  /** Highlight a node on the canvas (app only). */
  focusNode?(nodeId: string): void
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface ParsedArgs {
  /** Non-flag tokens after the command name. */
  positionals: string[]
  /** `--name value` pairs; a flag with no value is `true`. */
  flags: Record<string, string | true>
  /** Every token after the command name, untouched. */
  raw: string[]
}

export interface CommandResult {
  lines?: string[]
  /** Replace the context (mode transitions). */
  context?: TerminalContext
  /** Clear the scrollback. */
  clear?: boolean
  /** Start re-running `line` every `intervalMs` (app terminal only). */
  watch?: { line: string; intervalMs: number }
}

export type ArgKind = 'node' | 'edge' | 'field' | 'edge-field' | 'interface' | 'request' | 'enum'

export interface ArgSpec {
  name: string
  kind: ArgKind
  optional?: boolean
  values?: readonly string[]
}

export interface CommandScope {
  ctx: TerminalContext
  deps: CommandDeps
  /** Commands entered this session, oldest first. */
  history: readonly string[]
  /** Help text for the current mode (used by `help`). */
  helpFor(ctx: TerminalContext, prefix?: string[]): string[]
}

export interface CommandDefinition {
  /** Space-separated words, e.g. `show topology`. */
  name: string
  aliases?: string[]
  modes: readonly TerminalMode[]
  summary: string
  /** Argument synopsis for help, e.g. `<nodeId> [--last N]`. */
  usage?: string
  args?: ArgSpec[]
  /** Per-type idiom label shown in help (e.g. `psql`). */
  idiom?: string
  /** Only offered when this returns true (per-type idioms). */
  appliesTo?(scope: CommandScope): boolean
  execute(scope: CommandScope, args: ParsedArgs): CommandResult
}

/** A command failed in an expected way; the message is shown in red. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandError'
  }
}
