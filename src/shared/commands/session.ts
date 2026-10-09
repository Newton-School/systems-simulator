import { ROOT_CONTEXT, promptFor, pruneMissingNode } from './context'
import { nodeInterfaces } from './data'
import { applyFilters, parseArgs, parseLine } from './parser'
import { CommandRegistry, type CompletionResult } from './registry'
import { BASE_COMMANDS } from './commands/base'
import { CONFIG_COMMANDS } from './commands/config'
import { DIAGNOSE_COMMANDS } from './commands/diagnose'
import { NODE_COMMANDS } from './commands/node'
import { PER_TYPE_COMMANDS } from './commands/perType'
import { RUNTIME_COMMANDS } from './commands/runtime'
import { TOPOLOGY_COMMANDS } from './commands/topology'
import { TRACE_COMMANDS } from './commands/trace'
import {
  CommandError,
  type CommandDeps,
  type CommandResult,
  type CommandScope,
  type TerminalContext,
  type TerminalMode
} from './types'

/** Every command, registered once; both the app terminal and `sim shell` use this. */
export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registry.registerAll(BASE_COMMANDS)
  registry.registerAll(TOPOLOGY_COMMANDS)
  registry.registerAll(NODE_COMMANDS)
  registry.registerAll(CONFIG_COMMANDS)
  registry.registerAll(RUNTIME_COMMANDS)
  registry.registerAll(TRACE_COMMANDS)
  registry.registerAll(DIAGNOSE_COMMANDS)
  registry.registerAll(PER_TYPE_COMMANDS)
  return registry
}

export interface SessionState {
  ctx: TerminalContext
  /** Entered lines, oldest first. */
  history: string[]
}

export const HISTORY_LIMIT = 500

export function createSession(): SessionState {
  return { ctx: ROOT_CONTEXT, history: [] }
}

export interface LineOutcome {
  state: SessionState
  lines: string[]
  clear: boolean
  watch?: { line: string; intervalMs: number }
  /** True when the command failed (the message is in `lines`). */
  failed: boolean
}

const MODE_NAMES: Record<TerminalMode, string> = {
  sim: 'sim>',
  node: 'node(<id>)>',
  'node-config': 'node(<id>)(config)#',
  'port-config': 'node(<id>)(config-port:N)#',
  runtime: 'sim(runtime)#'
}

const MODE_HOW_TO_ENTER: Record<TerminalMode, string> = {
  sim: "'end' returns to sim>",
  node: "'select <nodeId>' enters it",
  'node-config': "'select <nodeId>' then 'configure terminal'",
  'port-config': "'configure terminal' then 'interface port <N>'",
  runtime: "'runtime' or 'run' enters it"
}

export class TerminalSession {
  readonly registry: CommandRegistry
  state: SessionState

  constructor(
    private readonly deps: CommandDeps,
    options: { registry?: CommandRegistry; state?: SessionState } = {}
  ) {
    this.registry = options.registry ?? createDefaultRegistry()
    this.state = options.state ?? createSession()
  }

  prompt(): string {
    return promptFor(this.state.ctx)
  }

  private scope(ctx: TerminalContext = this.state.ctx): CommandScope {
    return {
      ctx,
      deps: this.deps,
      history: this.state.history,
      helpFor: (helpCtx, prefix) => this.helpLines(helpCtx, prefix)
    }
  }

  /** Re-check the context against the topology (a selected node may have been deleted). */
  reconcile(): void {
    const { topology } = this.deps.topology()
    if (!topology) return
    const ids = new Set(topology.nodes.map((node) => node.id))
    this.state = { ...this.state, ctx: pruneMissingNode(this.state.ctx, (id) => ids.has(id)) }
  }

  setContext(ctx: TerminalContext): void {
    this.state = { ...this.state, ctx }
  }

  /** Run one input line; records history unless `record` is false (watch refreshes). */
  run(line: string, options: { record?: boolean } = {}): LineOutcome {
    const trimmed = line.trim()
    const c = this.deps.palette
    if (trimmed.length === 0) return { state: this.state, lines: [], clear: false, failed: false }
    if (options.record !== false) {
      const history = [...this.state.history, trimmed].slice(-HISTORY_LIMIT)
      this.state = { ...this.state, history }
    }
    this.reconcile()
    try {
      const parsed = parseLine(trimmed)
      if (parsed.help) {
        return this.finish({ lines: this.helpLines(this.state.ctx, parsed.tokens) }, parsed.filters)
      }
      const scope = this.scope()
      const resolved = this.registry.resolve(parsed.tokens, this.state.ctx.mode, scope)
      if (!resolved) throw new CommandError(this.unknownMessage(parsed.tokens))
      const result = resolved.command.execute(scope, parseArgs(resolved.argTokens))
      return this.finish(result, parsed.filters)
    } catch (error) {
      const message =
        error instanceof CommandError
          ? error.message
          : `Internal error: ${error instanceof Error ? error.message : String(error)}`
      return {
        state: this.state,
        lines: [`${c.red}${message}${c.reset}`],
        clear: false,
        failed: true
      }
    }
  }

  private finish(result: CommandResult, filters: string[][]): LineOutcome {
    if (result.context) this.state = { ...this.state, ctx: result.context }
    const lines =
      filters.length > 0 ? applyFilters(result.lines ?? [], filters) : (result.lines ?? [])
    return {
      state: this.state,
      lines,
      clear: result.clear === true,
      watch: result.watch,
      failed: false
    }
  }

  private unknownMessage(tokens: string[]): string {
    const typed = tokens.join(' ')
    const modes = this.registry.modesFor(tokens).filter((mode) => mode !== this.state.ctx.mode)
    if (modes.length > 0) {
      const mode = modes[0]
      return `'${typed}' is not available in ${promptFor(this.state.ctx)} - it belongs to ${MODE_NAMES[mode]} (${MODE_HOW_TO_ENTER[mode]}).`
    }
    const first = tokens[0]?.toLowerCase() ?? ''
    const family = this.registry
      .available(this.state.ctx.mode, this.scope())
      .filter((command) => command.name.split(' ')[0] === first)
    if (family.length > 0) {
      return `Incomplete or unknown: '${typed}'. Try: ${family.map((command) => command.name).join(', ')}.`
    }
    return `Unknown command '${typed}'. Type 'help' (or '?') for the commands in this mode.`
  }

  /** Mode-appropriate help, optionally narrowed to commands starting with `prefix`. */
  helpLines(ctx: TerminalContext, prefix: string[] = []): string[] {
    const c = this.deps.palette
    const scope = this.scope(ctx)
    const wanted = prefix.map((token) => token.toLowerCase())
    const commands = this.registry.available(ctx.mode, scope).filter((command) => {
      const names = [command.name, ...(command.aliases ?? [])].map((name) =>
        name.toLowerCase().split(/\s+/)
      )
      return names.some((words) =>
        wanted.every((token, index) => (words[index] ?? '').startsWith(token))
      )
    })
    if (commands.length === 0) {
      return [`No commands match '${prefix.join(' ')}' in ${promptFor(ctx)}.`]
    }
    const generic = commands.filter((command) => !command.idiom)
    const idioms = commands.filter((command) => command.idiom)
    const width = Math.min(
      34,
      Math.max(...commands.map((command) => this.synopsis(command.name, command.usage).length))
    )
    const render = (list: typeof commands): string[] =>
      list.map((command) => {
        const synopsis = this.synopsis(command.name, command.usage)
        const aliases = command.aliases?.length
          ? ` ${c.dim}(${command.aliases.join(', ')})${c.reset}`
          : ''
        return `  ${c.cyan}${synopsis.padEnd(width)}${c.reset}  ${command.summary}${aliases}`
      })
    const lines = [
      `${c.bold}${promptFor(ctx)}${c.reset} ${c.dim}commands${c.reset}`,
      ...render(generic)
    ]
    const groups = new Map<string, typeof commands>()
    for (const command of idioms)
      groups.set(command.idiom!, [...(groups.get(command.idiom!) ?? []), command])
    for (const [label, list] of groups) {
      lines.push(
        '',
        `${c.bold}${label}${c.reset} ${c.dim}idiom for this node type${c.reset}`,
        ...render(list)
      )
    }
    if (prefix.length === 0) {
      lines.push(
        '',
        `${c.dim}Pipes: <command> | grep [-v] [-i] <text> | head [N] | tail [N] | count. Tab completes; Up/Down recall history.${c.reset}`
      )
    }
    return lines
  }

  private synopsis(name: string, usage?: string): string {
    return usage ? `${name} ${usage}` : name
  }

  /** Tab completion for the partial input line. */
  complete(line: string): CompletionResult {
    const { topology } = this.deps.topology()
    const ctx = this.state.ctx
    const scope = this.scope()
    return this.registry.completionsFor(line, ctx.mode, scope, {
      nodeIds: () => topology?.nodes.map((node) => node.id) ?? [],
      edgeIds: () => topology?.edges.map((edge) => edge.id) ?? [],
      fieldKeys: () =>
        ctx.nodeId && this.deps.config
          ? this.deps.config
              .fields(ctx.nodeId)
              .filter((field) => field.editable)
              .map((field) => field.key)
          : [],
      edgeFieldKeys: () =>
        ctx.edgeId && this.deps.edges
          ? this.deps.edges.fields(ctx.edgeId).map((field) => field.key)
          : [],
      interfaceIndexes: () =>
        topology && ctx.nodeId
          ? nodeInterfaces(topology, ctx.nodeId).map((entry) => String(entry.index))
          : [],
      requestIds: () => {
        const results = this.deps.sim?.state().results
        if (!results) return []
        const ids = new Set<string>()
        for (const trace of results.traces) ids.add(trace.requestId)
        for (const outcome of results.requestOutcomes) {
          if (outcome.status !== 'success') ids.add(outcome.requestId)
          if (ids.size > 200) break
        }
        return [...ids]
      }
    })
  }
}
