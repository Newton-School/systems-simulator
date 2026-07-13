import { describe, expect, it } from 'vitest'
import { parseEmbeddedIframeQuestion } from './EmbeddedIframeQuestion'

describe('parseEmbeddedIframeQuestion', () => {
  it('parses a valid embedded-iframe question payload', () => {
    const result = parseEmbeddedIframeQuestion(
      JSON.stringify({
        type: 'embedded-iframe',
        url: 'https://example.com/embed',
        title: 'Assignment',
        prompt: 'Inspect the embedded app.'
      })
    )

    expect(result.error).toBeNull()
    expect(result.question).toMatchObject({
      type: 'embedded-iframe',
      url: 'https://example.com/embed',
      title: 'Assignment',
      prompt: 'Inspect the embedded app.',
      allowedOrigins: ['https://example.com']
    })
  })

  it('rejects embedded-iframe payloads with invalid urls', () => {
    const result = parseEmbeddedIframeQuestion(
      JSON.stringify({
        type: 'embedded-iframe',
        url: '/relative/path'
      })
    )

    expect(result.question).toBeNull()
    expect(result.error).toContain('valid absolute URL')
  })
})
