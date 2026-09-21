import { describe, expect, it } from 'vitest'
import { buildQuestionTextHtml } from './questionTextHtml'

describe('buildQuestionTextHtml', () => {
  it('escapes authored HTML instead of treating it as markup', () => {
    const html = buildQuestionTextHtml({
      text: '<script>alert("unsafe")</script> Build A & B.',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    })

    expect(html).toBe(
      '<p>&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt; Build A &amp; B.</p>'
    )
    expect(html).not.toContain('<script>')
  })

  it('preserves paragraphs and intentional line breaks consistently', () => {
    const html = buildQuestionTextHtml({
      text: 'First line\nSecond line\n\nNext paragraph',
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      scale: {}
    })

    expect(html).toBe('<p>First line<br>Second line</p>\n<p>Next paragraph</p>')
  })
})
