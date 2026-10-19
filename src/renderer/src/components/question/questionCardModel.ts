import type { QuestionPackage } from '../../../../engine/analysis/question'

export interface QuestionCardBrief {
  title: string
  /** The first paragraph of the problem, plain text, cut to a glance-sized length. */
  summary: string
  /** The few targets worth keeping in view while building (non-functional requirements). */
  targets: string[]
}

const SUMMARY_MAX_CHARS = 160
const MAX_TARGETS = 3

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/, '')}…`
}

/** The question reduced to what the on-canvas card shows: title, one sentence, a few targets. */
export function summarizeQuestionBrief(
  question: Pick<QuestionPackage, 'title' | 'description' | 'prompt'>
): QuestionCardBrief {
  // Skip heading-only paragraphs so "## Goal" doesn't become the whole summary.
  const paragraphs = question.prompt.text.split(/\n\s*\n/)
  const firstParagraph = paragraphs.find((paragraph) => !/^\s*#{1,6}\s/.test(paragraph)) ?? ''
  const summary = stripMarkdown(firstParagraph) || stripMarkdown(question.description ?? '')
  return {
    title: question.title,
    summary: truncateAtWord(summary, SUMMARY_MAX_CHARS),
    targets: question.prompt.nonFunctionalRequirements
      .map((target) => target.description.trim())
      .filter((description) => description.length > 0)
      .slice(0, MAX_TARGETS)
  }
}
