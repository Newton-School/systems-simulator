import { describe, expect, it } from 'vitest'
import { filterPaletteCommands, type PaletteCommand } from './commandPaletteModel'

const cmd = (id: string, title: string, group = 'General', keywords?: string): PaletteCommand => ({
  id,
  title,
  group,
  keywords,
  run: () => {}
})

const commands = [
  cmd('run', 'Run simulation', 'Run'),
  cmd('save', 'Save design', 'File'),
  cmd('add-cache', 'Add Distributed Cache', 'Add component', 'redis memcached'),
  cmd('theme', 'Toggle theme', 'View', 'dark light')
]

describe('filterPaletteCommands', () => {
  it('keeps the given order for an empty query', () => {
    expect(filterPaletteCommands(commands, '  ').map((c) => c.id)).toEqual([
      'run',
      'save',
      'add-cache',
      'theme'
    ])
  })

  it('requires every word to match, in any order', () => {
    expect(filterPaletteCommands(commands, 'cache add').map((c) => c.id)).toEqual(['add-cache'])
    expect(filterPaletteCommands(commands, 'cache save')).toEqual([])
  })

  it('finds a command by its keywords or group', () => {
    expect(filterPaletteCommands(commands, 'redis').map((c) => c.id)).toEqual(['add-cache'])
    expect(filterPaletteCommands(commands, 'file').map((c) => c.id)).toEqual(['save'])
  })

  it('ranks a title match above a keyword match', () => {
    const list = [cmd('a', 'Open settings', 'App', 'theme'), cmd('b', 'Toggle theme', 'View')]
    expect(filterPaletteCommands(list, 'theme').map((c) => c.id)).toEqual(['b', 'a'])
  })
})
