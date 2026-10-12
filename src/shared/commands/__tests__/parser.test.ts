import { describe, expect, it } from 'vitest'
import { applyFilters, parseArgs, parseLine, tokenize } from '../parser'
import { CommandRegistry } from '../registry'
import type { CommandDefinition } from '../types'

describe('line parser', () => {
  it('tokenizes with quotes and detects inline help', () => {
    expect(tokenize(`set label "API v2" x`)).toEqual(['set', 'label', 'API v2', 'x'])
    expect(parseLine('show ?')).toMatchObject({ tokens: ['show'], help: true })
    expect(parseLine('show?')).toMatchObject({ tokens: ['show'], help: true })
    expect(parseLine('?')).toMatchObject({ tokens: [], help: true })
    expect(() => tokenize('set "open')).toThrow(/Unclosed/)
  })

  it('splits pipes outside quotes and applies filters', () => {
    const parsed = parseLine(`show events | grep -i "Rejected" | head 2`)
    expect(parsed.tokens).toEqual(['show', 'events'])
    expect(parsed.filters).toEqual([
      ['grep', '-i', 'Rejected'],
      ['head', '2']
    ])
    const lines = ['a rejected', 'b ok', '\x1b[31mc REJECTED\x1b[0m', 'd rejected']
    expect(applyFilters(lines, parsed.filters)).toEqual(['a rejected', '\x1b[31mc REJECTED\x1b[0m'])
    expect(applyFilters(lines, [['grep', '-v', 'rejected']])).toEqual([
      'b ok',
      '\x1b[31mc REJECTED\x1b[0m'
    ])
    expect(applyFilters(lines, [['tail', '1']])).toEqual(['d rejected'])
    expect(applyFilters(lines, [['count']])).toEqual(['4'])
    expect(() => applyFilters(lines, [['sort']])).toThrow(/Unknown filter/)
  })

  it('parses flags with and without values', () => {
    expect(parseArgs(['--last', '5', 'x', '--json', '--node=api'])).toEqual({
      positionals: ['x'],
      flags: { last: '5', json: true, node: 'api' },
      raw: ['--last', '5', 'x', '--json', '--node=api']
    })
  })
})

describe('command registry', () => {
  const command = (
    name: string,
    modes: CommandDefinition['modes'],
    extra: Partial<CommandDefinition> = {}
  ): CommandDefinition => ({
    name,
    modes,
    summary: name,
    execute: () => ({ lines: [name] }),
    ...extra
  })

  it('resolves the longest multi-word name available in the mode', () => {
    const registry = new CommandRegistry()
    registry.registerAll([
      command('show', ['port-config']),
      command('show config', ['node']),
      command('show config running', ['sim'], { aliases: ['show running-config'] }),
      command('show topology', ['sim'])
    ])
    expect(registry.resolve(['show', 'config', 'running', 'api'], 'sim')?.command.name).toBe(
      'show config running'
    )
    expect(registry.resolve(['SHOW', 'running-config'], 'sim')?.argTokens).toEqual([])
    expect(registry.resolve(['show', 'config'], 'node')?.command.name).toBe('show config')
    expect(registry.resolve(['show', 'topology'], 'node')).toBeNull()
    expect(registry.modesFor(['show', 'topology'])).toEqual(['sim'])
  })

  it('refuses duplicate names in overlapping modes', () => {
    const registry = new CommandRegistry()
    registry.register(command('run', ['sim']))
    expect(() => registry.register(command('run', ['sim', 'runtime']))).toThrow(
      /already registered/
    )
    registry.register(command('run', ['runtime', 'node'].slice(1) as CommandDefinition['modes']))
  })

  it('completes command words and node arguments', () => {
    const registry = new CommandRegistry()
    registry.registerAll([
      command('show topology', ['sim']),
      command('show throughput', ['sim']),
      command('select', ['sim'], { args: [{ name: 'nodeId', kind: 'node' }] })
    ])
    const sources = {
      nodeIds: () => ['api', 'api-2', 'db'],
      edgeIds: () => [],
      fieldKeys: () => [],
      edgeFieldKeys: () => [],
      interfaceIndexes: () => [],
      requestIds: () => []
    }
    expect(registry.completionsFor('sh', 'sim', undefined, sources).candidates).toEqual(['show'])
    const show = registry.completionsFor('show t', 'sim', undefined, sources)
    expect(show.candidates).toEqual(['throughput', 'topology'])
    expect(show.commonPrefix).toBe('t')
    const node = registry.completionsFor('select ap', 'sim', undefined, sources)
    expect(node).toMatchObject({ candidates: ['api', 'api-2'], commonPrefix: 'api', tokenIndex: 1 })
  })
})
