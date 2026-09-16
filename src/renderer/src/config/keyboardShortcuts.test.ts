// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  formatShortcutKey,
  isEditableShortcutTarget,
  KEYBOARD_SHORTCUT_GROUPS
} from './keyboardShortcuts'

describe('keyboard shortcut catalogue', () => {
  it('keeps every shortcut id unique and every shortcut mapped', () => {
    const shortcuts = KEYBOARD_SHORTCUT_GROUPS.flatMap((group) => group.shortcuts)
    const ids = shortcuts.map((shortcut) => shortcut.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(shortcuts.every((shortcut) => shortcut.keys.length > 0)).toBe(true)
    expect(shortcuts.every((shortcut) => shortcut.keys.every((keys) => keys.length > 0))).toBe(true)
  })

  it('covers canvas selection, library navigation, inspectors, lenses, and settings', () => {
    const ids = new Set(
      KEYBOARD_SHORTCUT_GROUPS.flatMap((group) => group.shortcuts.map((shortcut) => shortcut.id))
    )

    for (const id of [
      'select-all',
      'focus-library-search',
      'switch-left-tab',
      'toggle-node-config',
      'toggle-results',
      'toggle-run-inspector',
      'choose-lens',
      'open-settings'
    ]) {
      expect(ids.has(id), `missing shortcut ${id}`).toBe(true)
    }
  })

  it('formats primary keys for Apple and non-Apple platforms', () => {
    expect(formatShortcutKey('Mod', true)).toBe('⌘')
    expect(formatShortcutKey('Mod', false)).toBe('Ctrl')
    expect(formatShortcutKey('Alt', true)).toBe('⌥')
  })

  it('recognizes form controls and nested contenteditable targets', () => {
    const input = document.createElement('input')
    const editable = document.createElement('div')
    const child = document.createElement('span')
    editable.setAttribute('contenteditable', 'true')
    editable.appendChild(child)

    expect(isEditableShortcutTarget(input)).toBe(true)
    expect(isEditableShortcutTarget(child)).toBe(true)
    expect(isEditableShortcutTarget(document.createElement('button'))).toBe(false)
  })
})
