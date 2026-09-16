// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_ENVIRONMENT_PROFILE,
  AUTHOR_ENVIRONMENT_PROFILE,
  PRACTICE_ENVIRONMENT_PROFILE
} from '../../../../../engine/analysis/environmentProfile'
import useStore from '@renderer/store/useStore'
import { SettingsButton } from './SettingsButton'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SettingsButton mode visibility', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    container = null
    root = null
  })

  function renderForMode(environmentProfile: typeof AUTHOR_ENVIRONMENT_PROFILE) {
    useStore.setState({ environmentProfile })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<SettingsButton />))
    return container
  }

  it('shows settings in Author mode', () => {
    const view = renderForMode(AUTHOR_ENVIRONMENT_PROFILE)
    expect(view.querySelector('button[title="Settings (Cmd/Ctrl+,)"]')).not.toBeNull()
  })

  it('hides settings in Practice mode', () => {
    const view = renderForMode(PRACTICE_ENVIRONMENT_PROFILE)
    expect(view.querySelector('button')).toBeNull()
  })

  it('hides settings in Assignment mode', () => {
    const view = renderForMode(ASSIGNMENT_ENVIRONMENT_PROFILE)
    expect(view.querySelector('button')).toBeNull()
  })
})
