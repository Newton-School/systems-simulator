// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebFileService } from './FileService.web'

type MutableWindow = typeof window & {
  showSaveFilePicker?: unknown
}

afterEach(() => {
  delete (window as MutableWindow).showSaveFilePicker
  vi.restoreAllMocks()
})

describe('WebFileService.save', () => {
  it('falls back to a download when the save picker throws a non-abort error', async () => {
    // The API exists but is blocked (e.g. cross-origin iframe / disallowed).
    ;(window as MutableWindow).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('Not allowed', 'SecurityError')
    })

    const clicks: Array<{ download: string }> = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          clicks.push({ download: (el as HTMLAnchorElement).download })
        })
      }
      return el
    })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn()
    })

    const result = await WebFileService.save(
      '{"id":"quickcart-flash-sale"}',
      'quickcart-flash-sale.question.json',
      {
        saveAsNewFile: true
      }
    )

    expect(result).toEqual({ name: 'quickcart-flash-sale.question.json' })
    expect(clicks).toEqual([{ download: 'quickcart-flash-sale.question.json' }])
  })

  it('returns null without downloading when the user cancels the picker', async () => {
    ;(window as MutableWindow).showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('Aborted', 'AbortError')
    })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await WebFileService.save('{}', 'x.json', { saveAsNewFile: true })

    expect(result).toBeNull()
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
