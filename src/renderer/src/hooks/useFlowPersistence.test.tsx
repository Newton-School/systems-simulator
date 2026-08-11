// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import useStore from '@renderer/store/useStore'
import { DEFAULT_SCENARIO_STATE } from '@renderer/types/ui'
import { useFlowPersistence } from './useFlowPersistence'

const fileService = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn()
}))

vi.mock('../services/FileService', () => ({
  FileService: fileService
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ canSave = true, canOpen = true }: { canSave?: boolean; canOpen?: boolean }) {
  useFlowPersistence(async () => true, { canSave, canOpen })
  return null
}

describe('useFlowPersistence keyboard shortcuts', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    fileService.save.mockReset()
    fileService.load.mockReset()
    fileService.save.mockResolvedValue({ name: 'scenario.json' })
    fileService.load.mockResolvedValue(null)
    useStore.setState({
      nodes: [],
      edges: [],
      fileName: null,
      isUnsaved: false,
      scenario: DEFAULT_SCENARIO_STATE
    })
  })

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    container = null
    root = null
  })

  function renderHarness(props: { canSave?: boolean; canOpen?: boolean } = {}) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(<Harness {...props} />)
    })
  }

  it('does not trigger save when saving is disabled', () => {
    renderHarness({ canSave: false })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })

    expect(fileService.save).not.toHaveBeenCalled()
  })

  it('does not trigger open when opening is disabled', () => {
    renderHarness({ canOpen: false })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }))
    })

    expect(fileService.load).not.toHaveBeenCalled()
  })

  it('still triggers save when saving is allowed', () => {
    renderHarness({ canSave: true })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })

    expect(fileService.save).toHaveBeenCalledTimes(1)
  })
})
