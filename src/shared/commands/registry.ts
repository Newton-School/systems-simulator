import type { ArgSpec, CommandDefinition, CommandScope, TerminalMode } from './types'

/**
 * Command registry shared by the in-app terminal and `sim shell`. Command
 * names may span several words (`show topology`); resolution picks the longest
 * name or alias that prefixes the input, among the commands available in the
 * current mode (and, for per-type idioms, for the selected node).
 */

export interface ResolvedCommand {
  command: CommandDefinition
  /** The words that matched the name. */
  matched: string[]
  /** Tokens after the name. */
  argTokens: string[]
}

export interface CompletionResult {
  /** Full replacement candidates for the token being completed. */
  candidates: string[]
  /** Longest common prefix of the candidates (what Tab inserts). */
  commonPrefix: string
  /** Index of the token being completed. */
  tokenIndex: number
}

export interface CompletionSources {
  nodeIds(): string[]
  edgeIds(): string[]
  fieldKeys(): string[]
  edgeFieldKeys(): string[]
  interfaceIndexes(): string[]
  requestIds(): string[]
}

function words(name: string): string[] {
  return name.toLowerCase().split(/\s+/).filter(Boolean)
}

function namesOf(command: CommandDefinition): string[][] {
  return [command.name, ...(command.aliases ?? [])].map(words)
}

function startsWithWords(tokens: readonly string[], name: readonly string[]): boolean {
  if (name.length > tokens.length) return false
  return name.every((word, index) => tokens[index].toLowerCase() === word)
}

function commonPrefix(values: string[]): string {
  if (values.length === 0) return ''
  let prefix = values[0]
  for (const value of values.slice(1)) {
    let index = 0
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) index++
    prefix = prefix.slice(0, index)
  }
  return prefix
}

export class CommandRegistry {
  private readonly commands: CommandDefinition[] = []

  register(command: CommandDefinition): void {
    const duplicate = this.commands.find(
      (existing) =>
        existing.name === command.name &&
        existing.modes.some((mode) => command.modes.includes(mode)) &&
        existing.appliesTo === undefined &&
        command.appliesTo === undefined
    )
    if (duplicate) {
      throw new Error(`Command '${command.name}' is already registered for one of its modes.`)
    }
    this.commands.push(command)
  }

  registerAll(commands: readonly CommandDefinition[]): void {
    for (const command of commands) this.register(command)
  }

  all(): readonly CommandDefinition[] {
    return this.commands
  }

  /** Commands usable right now: in this mode, and applying to the selected node. */
  available(mode: TerminalMode, scope?: CommandScope): CommandDefinition[] {
    return this.commands.filter(
      (command) =>
        command.modes.includes(mode) &&
        (!command.appliesTo || (scope !== undefined && command.appliesTo(scope)))
    )
  }

  /** Longest-name match among the available commands. */
  resolve(
    tokens: readonly string[],
    mode: TerminalMode,
    scope?: CommandScope
  ): ResolvedCommand | null {
    let best: ResolvedCommand | null = null
    for (const command of this.available(mode, scope)) {
      for (const name of namesOf(command)) {
        if (!startsWithWords(tokens, name)) continue
        if (!best || name.length > best.matched.length) {
          best = { command, matched: name, argTokens: tokens.slice(name.length) }
        }
      }
    }
    return best
  }

  /** Modes of the longest-matching command names (for "not available here" hints). */
  modesFor(tokens: readonly string[]): TerminalMode[] {
    let longest = 0
    const modes = new Set<TerminalMode>()
    for (const command of this.commands) {
      for (const name of namesOf(command)) {
        if (!startsWithWords(tokens, name) || name.length < longest) continue
        if (name.length > longest) {
          longest = name.length
          modes.clear()
        }
        for (const mode of command.modes) modes.add(mode)
      }
    }
    return [...modes]
  }

  /**
   * Completions for the last token of `line` (or a new token when the line
   * ends in whitespace): command words first, then the argument at that slot.
   */
  completionsFor(
    line: string,
    mode: TerminalMode,
    scope: CommandScope | undefined,
    sources: CompletionSources
  ): CompletionResult {
    const endsWithSpace = line.length === 0 || /\s$/.test(line)
    const tokens = line.trim().length === 0 ? [] : line.trim().split(/\s+/)
    const done = endsWithSpace ? tokens : tokens.slice(0, -1)
    const partial = endsWithSpace ? '' : (tokens[tokens.length - 1] ?? '')
    const tokenIndex = done.length
    const partialLower = partial.toLowerCase()
    const available = this.available(mode, scope)

    const wordCandidates = new Set<string>()
    for (const command of available) {
      for (const name of namesOf(command)) {
        if (name.length <= done.length) continue
        if (!startsWithWords(done, name.slice(0, done.length))) continue
        const next = name[done.length]
        if (next.startsWith(partialLower)) wordCandidates.add(next)
      }
    }

    const argCandidates = new Set<string>()
    const resolved = this.resolve(done, mode, scope)
    if (resolved) {
      const positional = resolved.argTokens.filter((token) => !token.startsWith('--'))
      const spec: ArgSpec | undefined = resolved.command.args?.[positional.length]
      for (const value of argValues(spec, sources)) {
        if (value.toLowerCase().startsWith(partialLower)) argCandidates.add(value)
      }
    }

    const candidates = [...wordCandidates, ...argCandidates].sort()
    return { candidates, commonPrefix: commonPrefix(candidates), tokenIndex }
  }
}

function argValues(spec: ArgSpec | undefined, sources: CompletionSources): string[] {
  if (!spec) return []
  switch (spec.kind) {
    case 'node':
      return sources.nodeIds()
    case 'edge':
      return sources.edgeIds()
    case 'field':
      return sources.fieldKeys()
    case 'edge-field':
      return sources.edgeFieldKeys()
    case 'interface':
      return sources.interfaceIndexes()
    case 'request':
      return sources.requestIds()
    case 'enum':
      return [...(spec.values ?? [])]
  }
}
