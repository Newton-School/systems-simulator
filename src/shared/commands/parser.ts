import { stripAnsi } from '../ansi'
import { CommandError, type ParsedArgs } from './types'

/**
 * A simple line parser (not a shell): whitespace-separated tokens, single or
 * double quotes group words, a trailing `?` asks for inline help, and `|` pipes
 * the output through a small set of line filters (grep, head, tail, count).
 */

export interface ParsedLine {
  /** Tokens of the command part (before the first `|`). */
  tokens: string[]
  /** `show ?` / `show?`: list what can follow the tokens instead of running. */
  help: boolean
  /** Filter stages after the command, each already tokenized. */
  filters: string[][]
}

/** Split on whitespace, keeping quoted groups together (quotes removed). */
export function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let inToken = false
  for (const ch of input) {
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
      continue
    }
    current += ch
    inToken = true
  }
  if (quote) throw new CommandError(`Unclosed ${quote} quote.`)
  if (inToken) tokens.push(current)
  return tokens
}

/** Split at `|` characters that are not inside quotes. */
function splitPipes(line: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '|') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

export function parseLine(line: string): ParsedLine {
  const [command, ...filterParts] = splitPipes(line)
  const tokens = tokenize(command)
  let help = false
  const last = tokens[tokens.length - 1]
  if (last === '?') {
    tokens.pop()
    help = true
  } else if (last !== undefined && last.length > 1 && last.endsWith('?')) {
    tokens[tokens.length - 1] = last.slice(0, -1)
    help = true
  }
  const filters = filterParts.map((part) => tokenize(part))
  if (filters.some((stage) => stage.length === 0)) {
    throw new CommandError(
      'Empty pipe stage. Filters: grep [-v] [-i] <text>, head [N], tail [N], count.'
    )
  }
  return { tokens, help, filters }
}

/** `--name value` / `--flag` / positionals. A flag takes the next token unless it is another flag. */
export function parseArgs(tokens: readonly string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | true> = {}
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.startsWith('--') && token.length > 2) {
      const [name, inline] = token.slice(2).split('=', 2)
      if (inline !== undefined) {
        flags[name] = inline
        continue
      }
      const next = tokens[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next
        index++
      } else {
        flags[name] = true
      }
      continue
    }
    positionals.push(token)
  }
  return { positionals, flags, raw: [...tokens] }
}

export const FILTER_NAMES = ['grep', 'head', 'tail', 'count'] as const

function countArg(stage: string[], fallback: number): number {
  const raw = stage[1] === '-n' ? stage[2] : stage[1]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    throw new CommandError(`${stage[0]}: expected a line count, got '${raw}'.`)
  }
  return value
}

/** Apply pipe filters to output lines. Matching ignores colour codes. */
export function applyFilters(lines: string[], filters: string[][]): string[] {
  let current = lines
  for (const stage of filters) {
    const [name, ...rest] = stage
    switch (name) {
      case 'grep': {
        let invert = false
        let ignoreCase = false
        const words: string[] = []
        for (const token of rest) {
          if (token === '-v') invert = true
          else if (token === '-i') ignoreCase = true
          else if (token === '-vi' || token === '-iv') {
            invert = true
            ignoreCase = true
          } else words.push(token)
        }
        if (words.length === 0) throw new CommandError('grep: missing pattern.')
        const needle = ignoreCase ? words.join(' ').toLowerCase() : words.join(' ')
        current = current.filter((line) => {
          const plain = ignoreCase ? stripAnsi(line).toLowerCase() : stripAnsi(line)
          return plain.includes(needle) !== invert
        })
        break
      }
      case 'head':
        current = current.slice(0, countArg(stage, 10))
        break
      case 'tail': {
        const n = countArg(stage, 10)
        current = n === 0 ? [] : current.slice(-n)
        break
      }
      case 'count':
      case 'wc':
        current = [String(current.length)]
        break
      default:
        throw new CommandError(
          `Unknown filter '${name}'. Filters: grep [-v] [-i] <text>, head [N], tail [N], count.`
        )
    }
  }
  return current
}
