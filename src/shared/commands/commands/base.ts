import { endMode, exitMode } from '../context'
import { CommandError, TERMINAL_MODES, type CommandDefinition } from '../types'

const ALL_MODES = TERMINAL_MODES

const MIN_WATCH_MS = 500

function parseInterval(raw: string | true | undefined): number {
  if (raw === undefined || raw === true) return 2000
  const match = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(raw)
  if (!match) throw new CommandError(`--interval: expected e.g. 2s or 500ms, got '${raw}'.`)
  const value = Number(match[1]) * (match[2] === 'ms' ? 1 : 1000)
  if (value < MIN_WATCH_MS) throw new CommandError(`--interval must be at least ${MIN_WATCH_MS}ms.`)
  return value
}

/** Commands available in every mode. */
export const BASE_COMMANDS: CommandDefinition[] = [
  {
    name: 'help',
    aliases: ['?'],
    modes: ALL_MODES,
    summary: 'List the commands available in this mode (or `<command> ?` for one family)',
    usage: '[command]',
    execute: (scope, args) => ({ lines: scope.helpFor(scope.ctx, args.positionals) })
  },
  {
    name: 'exit',
    aliases: ['back'],
    modes: ALL_MODES,
    summary: 'Leave this mode (one level up)',
    execute: (scope) => {
      if (scope.ctx.mode === 'sim' && scope.ctx.history.length === 0) {
        return { lines: ['Already at the root (sim>).'] }
      }
      return { context: exitMode(scope.ctx) }
    }
  },
  {
    name: 'end',
    modes: ALL_MODES,
    summary: 'Return to the sim> root',
    execute: () => ({ context: endMode() })
  },
  {
    name: 'clear',
    aliases: ['cls'],
    modes: ALL_MODES,
    summary: 'Clear the terminal output',
    execute: () => ({ clear: true })
  },
  {
    name: 'history',
    modes: ALL_MODES,
    summary: 'Show the commands entered this session',
    execute: (scope) => ({
      lines:
        scope.history.length === 0
          ? ['(no history yet)']
          : scope.history.map((line, index) => `${String(index + 1).padStart(4)}  ${line}`)
    })
  },
  {
    name: 'watch',
    modes: ALL_MODES,
    summary: 'Re-run a show command every interval, updating in place (Ctrl+C stops)',
    usage: '<command...> [--interval 2s]',
    execute: (scope, args) => {
      if (scope.deps.host !== 'app') {
        throw new CommandError(
          'watch is available in the app terminal; in a shell use `sim run --live`.'
        )
      }
      const tokens = args.raw.filter((token, index, all) => {
        if (token === '--interval') return false
        return all[index - 1] !== '--interval'
      })
      if (tokens.length === 0)
        throw new CommandError('watch: which command? e.g. watch show status')
      if (tokens[0] === 'watch') throw new CommandError('watch cannot watch itself.')
      return { watch: { line: tokens.join(' '), intervalMs: parseInterval(args.flags.interval) } }
    }
  }
]
