import { describe, expect, it } from 'vitest'
import { CliUsageError, enumValue, parseCommandArgs, positiveIntValue } from './args'
import { shouldColor, visibleLength } from './ansi'

describe('parseCommandArgs', () => {
  const spec = { booleans: ['json'], strings: ['output'] } as const

  it('splits positionals, booleans and valued flags in any order', () => {
    const parsed = parseCommandArgs(['--json', 'a.json', '--output', 'out.json', 'b.json'], spec)
    expect(parsed.positionals).toEqual(['a.json', 'b.json'])
    expect(parsed.flags).toEqual({ help: false, json: true })
    expect(parsed.values).toEqual({ output: 'out.json' })
  })

  it('accepts --flag=value and -h', () => {
    const parsed = parseCommandArgs(['--output=x.json', '-h'], spec)
    expect(parsed.values.output).toBe('x.json')
    expect(parsed.flags.help).toBe(true)
  })

  it('rejects unknown flags and missing values as usage errors', () => {
    expect(() => parseCommandArgs(['--nope'], spec)).toThrow(CliUsageError)
    expect(() => parseCommandArgs(['--nope'], spec)).toThrow("Unknown option '--nope'.")
    expect(() => parseCommandArgs(['--output'], spec)).toThrow(CliUsageError)
    expect(() => parseCommandArgs(['--output', '--json'], spec)).toThrow(
      '--output requires a value.'
    )
  })
})

describe('flag value helpers', () => {
  it('parses positive integers', () => {
    expect(positiveIntValue(undefined, 'n')).toBeUndefined()
    expect(positiveIntValue('30', 'n')).toBe(30)
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      expect(() => positiveIntValue(bad, 'n')).toThrow('--n must be a positive integer.')
    }
  })

  it('parses enums', () => {
    expect(enumValue('a', 'm', ['a', 'b'])).toBe('a')
    expect(() => enumValue('c', 'm', ['a', 'b'])).toThrow('--m must be one of: a, b.')
  })
})

describe('shouldColor', () => {
  it('follows the TTY, NO_COLOR, FORCE_COLOR and TERM=dumb', () => {
    expect(shouldColor({ isTTY: true }, {})).toBe(true)
    expect(shouldColor({ isTTY: false }, {})).toBe(false)
    expect(shouldColor({ isTTY: true }, { NO_COLOR: '1' })).toBe(false)
    expect(shouldColor({ isTTY: false }, { FORCE_COLOR: '1' })).toBe(true)
    expect(shouldColor({ isTTY: false }, { FORCE_COLOR: '0' })).toBe(false)
    expect(shouldColor({ isTTY: true }, { TERM: 'dumb' })).toBe(false)
  })

  it('measures visible width without escape codes', () => {
    expect(visibleLength('\u001b[31mred\u001b[0m')).toBe(3)
  })
})
