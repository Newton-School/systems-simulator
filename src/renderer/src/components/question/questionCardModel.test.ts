import { describe, expect, it } from 'vitest'
import { summarizeQuestionBrief } from './questionCardModel'

const question = (text: string, description?: string, targets: string[] = []) => ({
  title: 'URL shortener',
  description,
  prompt: {
    text,
    functionalRequirements: [],
    nonFunctionalRequirements: targets.map((t) => ({ description: t })),
    scale: {}
  }
})

describe('summarizeQuestionBrief', () => {
  it('takes the first non-heading paragraph as plain text', () => {
    const brief = summarizeQuestionBrief(
      question('## Goal\n\nHandle **5k req/s** with `99.9%` uptime.\n\nSecond paragraph.') as never
    )
    expect(brief.summary).toBe('Handle 5k req/s with 99.9% uptime.')
  })

  it('strips markdown from a single paragraph', () => {
    const brief = summarizeQuestionBrief(
      question('Handle **5k req/s** with [99.9%](http://x) `uptime`.') as never
    )
    expect(brief.summary).toBe('Handle 5k req/s with 99.9% uptime.')
  })

  it('cuts long text at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(80)
    const { summary } = summarizeQuestionBrief(question(long) as never)
    expect(summary.length).toBeLessThanOrEqual(161)
    expect(summary.endsWith('…')).toBe(true)
    expect(summary).not.toMatch(/wor…$/)
  })

  it('falls back to the description and keeps at most three targets', () => {
    const brief = summarizeQuestionBrief(
      question('', 'A scenario.', ['a', 'b', ' ', 'c', 'd']) as never
    )
    expect(brief.summary).toBe('A scenario.')
    expect(brief.targets).toEqual(['a', 'b', 'c'])
  })
})
