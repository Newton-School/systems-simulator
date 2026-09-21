// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { LessonFrameEditor } from './LessonFrameEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

function renderEditor(): HTMLDivElement {
  function Harness() {
    const [title, setTitle] = useState('')
    return <LessonFrameEditor title={title} onTitleChange={setTitle} />
  }

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
  return container
}

function enter(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('LessonFrameEditor', () => {
  it('shows an honest fallback before the required title is entered', () => {
    const view = renderEditor()

    expect(view.querySelector('input')?.getAttribute('placeholder')).toBe(
      'e.g. Design a URL shortener'
    )
    expect(view.textContent).toContain('untitled-question')
    expect(view.textContent).toContain('Add a title to complete question identity.')
  })

  it('derives the package ID as the controlled title changes', () => {
    const view = renderEditor()
    const input = view.querySelector('input') as HTMLInputElement

    enter(input, 'Design a URL Shortener')

    expect(input.value).toBe('Design a URL Shortener')
    expect(view.querySelector('output')?.textContent).toContain('design-a-url-shortener')
    expect(view.textContent).toContain('This title will appear to learners.')
  })
})
