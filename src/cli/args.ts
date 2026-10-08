import { parseArgs } from 'node:util'

/** A bad invocation (unknown flag, missing value, missing file argument). Exit 1. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

export interface CommandArgSpec {
  /** Boolean switches, e.g. `json` for `--json`. */
  booleans?: readonly string[]
  /** Flags that take a value, e.g. `output` for `--output <file>`. */
  strings?: readonly string[]
}

export interface ParsedCommandArgs {
  positionals: string[]
  flags: Record<string, boolean>
  values: Record<string, string | undefined>
}

/**
 * Strict per-subcommand argument parsing: unknown flags and flags missing their
 * value are usage errors (never silently ignored). `--help`/`-h` is always
 * accepted and surfaces as `flags.help`.
 */
export function parseCommandArgs(argv: readonly string[], spec: CommandArgSpec): ParsedCommandArgs {
  const options: Record<string, { type: 'boolean' | 'string'; short?: string }> = {
    help: { type: 'boolean', short: 'h' }
  }
  for (const name of spec.booleans ?? []) options[name] = { type: 'boolean' }
  for (const name of spec.strings ?? []) options[name] = { type: 'string' }

  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true })
  } catch (err) {
    throw new CliUsageError(cleanParseError((err as Error).message))
  }

  const flags: Record<string, boolean> = {}
  const values: Record<string, string | undefined> = {}
  for (const [name, option] of Object.entries(options)) {
    const value = parsed.values[name]
    if (option.type === 'boolean') {
      flags[name] = value === true
    } else {
      if (typeof value === 'string' && value.startsWith('--')) {
        throw new CliUsageError(`--${name} requires a value.`)
      }
      values[name] = typeof value === 'string' ? value : undefined
    }
  }
  return { positionals: parsed.positionals, flags, values }
}

function cleanParseError(message: string): string {
  // "Option '--output <value>' argument missing" / "... argument is ambiguous" both
  // mean a valued flag was given no value.
  const missing = /Option '--([\w-]+)[^']*' argument (missing|is ambiguous)/.exec(message)
  if (missing) return `--${missing[1]} requires a value.`
  // Otherwise keep the first sentence ("Unknown option '--foo'.").
  const first = message.split(/\.\s|\n/)[0].trim()
  return first.endsWith('.') ? first : `${first}.`
}

/** Parse an optional positive integer flag value. */
export function positiveIntValue(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliUsageError(`--${flagName} must be a positive integer.`)
  }
  return parsed
}

/** Parse an optional enum flag value. */
export function enumValue<T extends string>(
  value: string | undefined,
  flagName: string,
  allowed: readonly T[]
): T | undefined {
  if (value === undefined) return undefined
  if (!(allowed as readonly string[]).includes(value)) {
    throw new CliUsageError(`--${flagName} must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}
